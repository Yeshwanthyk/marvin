import type {
  ActorUiPolicy,
  ProjectRuntimeBundle,
  SessionActorDescriptor,
} from "@yeshwanthyk/runtime-effect/project-bundle.js";
import {
  createSessionActor,
  type SessionActor,
  type SessionActorHydrateReason,
  type SessionActorStatus,
} from "./session-actor.js";

export interface ActorLifecyclePolicy {
  readonly maxWarm: number;
  readonly maxStreaming: number;
  readonly idleTtlMs: number;
  readonly neverEvictStreaming: true;
}

export const defaultActorLifecyclePolicy: ActorLifecyclePolicy = {
  maxWarm: 8,
  maxStreaming: 4,
  idleTtlMs: 10 * 60 * 1000,
  neverEvictStreaming: true,
};

export type RegistryHydrateResult =
  | { readonly type: "hydrated"; readonly actor: SessionActor }
  | {
      readonly type: "stream-limit-reached";
      readonly actor: SessionActor;
      readonly maxStreaming: number;
    };

export interface SessionActorRegistry {
  get(laneId: string): SessionActor | null;
  create(descriptor: SessionActorDescriptor): SessionActor;
  getOrCreate(descriptor: SessionActorDescriptor): SessionActor;
  hydrate(laneId: string, reason: SessionActorHydrateReason): Promise<RegistryHydrateResult>;
  list(): ReadonlyArray<SessionActor>;
  remove(laneId: string): Promise<void>;
}

export interface SessionActorRegistryOptions {
  readonly getBundle: (descriptor: SessionActorDescriptor) => Promise<ProjectRuntimeBundle>;
  readonly getUiPolicy?: (descriptor: SessionActorDescriptor, focused: boolean) => ActorUiPolicy;
  readonly policy?: Partial<ActorLifecyclePolicy>;
  readonly now?: () => number;
  readonly createActor?: (
    descriptor: SessionActorDescriptor,
    onStatusChange: (actor: SessionActor, status: SessionActorStatus) => void,
  ) => SessionActor;
}

interface ActorMeta {
  readonly actor: SessionActor;
  lastViewedAt: number;
  lastActivityAt: number;
}

export const createSessionActorRegistry = (
  options: SessionActorRegistryOptions,
): SessionActorRegistry => {
  const policy: ActorLifecyclePolicy = {
    ...defaultActorLifecyclePolicy,
    ...options.policy,
    neverEvictStreaming: true,
  };
  const now = options.now ?? Date.now;
  const actors = new Map<string, ActorMeta>();

  const touch = (laneId: string, activity: boolean) => {
    const meta = actors.get(laneId);
    if (meta === undefined) return;
    const timestamp = now();
    meta.lastViewedAt = timestamp;
    if (activity) meta.lastActivityAt = timestamp;
  };

  const statusChanged = (actor: SessionActor, status: SessionActorStatus) => {
    if (status === "warm" || status === "streaming") {
      touch(actor.laneId, true);
    }
  };

  const create = (descriptor: SessionActorDescriptor): SessionActor => {
    const existing = actors.get(descriptor.laneId);
    if (existing !== undefined) return existing.actor;

    const timestamp = now();
    const actor = options.createActor
      ? options.createActor(descriptor, statusChanged)
      : createSessionActor({
        descriptor,
        getBundle: options.getBundle,
        getUiPolicy: options.getUiPolicy,
        onStatusChange: statusChanged,
      });
    actors.set(descriptor.laneId, {
      actor,
      lastViewedAt: timestamp,
      lastActivityAt: timestamp,
    });
    void enforceWarmLimit();
    return actor;
  };

  const streamingCount = (): number =>
    Array.from(actors.values()).filter((meta) => meta.actor.status() === "streaming").length;

  const warmCandidates = (): ActorMeta[] =>
    Array.from(actors.values())
      .filter((meta) => {
        const status = meta.actor.status();
        if (status !== "warm") return false;
        if (policy.neverEvictStreaming && meta.actor.status() === "streaming") return false;
        return now() - meta.lastViewedAt >= policy.idleTtlMs || warmCount() > policy.maxWarm;
      })
      .sort((left, right) => {
        const viewedDelta = left.lastViewedAt - right.lastViewedAt;
        if (viewedDelta !== 0) return viewedDelta;
        return left.lastActivityAt - right.lastActivityAt;
      });

  const warmCount = (): number =>
    Array.from(actors.values()).filter((meta) => {
      const status = meta.actor.status();
      return status === "warm" || status === "streaming";
    }).length;

  const enforceWarmLimit = async () => {
    for (const meta of warmCandidates()) {
      if (warmCount() <= policy.maxWarm) return;
      await meta.actor.suspend();
    }
  };

  return {
    get(laneId) {
      return actors.get(laneId)?.actor ?? null;
    },
    create,
    getOrCreate(descriptor) {
      return actors.get(descriptor.laneId)?.actor ?? create(descriptor);
    },
    async hydrate(laneId, reason) {
      const meta = actors.get(laneId);
      if (meta === undefined) {
        throw new Error(`Unknown session actor lane: ${laneId}`);
      }
      meta.lastViewedAt = now();
      const actor = meta.actor;
      if (reason === "background-prompt" && actor.status() !== "streaming" && streamingCount() >= policy.maxStreaming) {
        return {
          type: "stream-limit-reached",
          actor,
          maxStreaming: policy.maxStreaming,
        };
      }
      await actor.hydrate(reason);
      await enforceWarmLimit();
      return { type: "hydrated", actor };
    },
    list() {
      return Array.from(actors.values()).map((meta) => meta.actor);
    },
    async remove(laneId) {
      const meta = actors.get(laneId);
      if (meta === undefined) return;
      actors.delete(laneId);
      await meta.actor.close();
    },
  };
};

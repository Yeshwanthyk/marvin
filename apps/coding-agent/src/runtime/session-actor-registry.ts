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

export type RegistryStreamAdmission =
  | { readonly type: "accepted" }
  | { readonly type: "stream-limit-reached"; readonly maxStreaming: number };

export interface SweepIdleOptions {
  readonly excludeLaneId?: string | null;
  readonly excludeLaneIds?: readonly string[];
}

export interface SessionActorRegistry {
  get(laneId: string): SessionActor | null;
  canStartStream(laneId: string): RegistryStreamAdmission;
  create(descriptor: SessionActorDescriptor): SessionActor;
  getOrCreate(descriptor: SessionActorDescriptor): SessionActor;
  hydrate(laneId: string, reason: SessionActorHydrateReason, options?: SweepIdleOptions): Promise<RegistryHydrateResult>;
  sweepIdle(options?: SweepIdleOptions): Promise<void>;
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
    return actor;
  };

  const streamAdmissionCount = (): number =>
    Array.from(actors.values()).filter((meta) => {
      const status = meta.actor.status();
      return status === "streaming" || status === "hydrating";
    }).length;

  const canStartStream = (laneId: string): RegistryStreamAdmission => {
    const actor = actors.get(laneId)?.actor;
    const status = actor?.status();
    if (status === "streaming" || status === "hydrating") return { type: "accepted" };
    if (streamAdmissionCount() >= policy.maxStreaming) {
      return { type: "stream-limit-reached", maxStreaming: policy.maxStreaming };
    }
    return { type: "accepted" };
  };

  const isIdleExpired = (meta: ActorMeta): boolean =>
    now() - meta.lastViewedAt >= policy.idleTtlMs;

  const isExcluded = (laneId: string, options?: SweepIdleOptions): boolean =>
    laneId === options?.excludeLaneId || options?.excludeLaneIds?.includes(laneId) === true;

  const warmCandidates = (options?: SweepIdleOptions): ActorMeta[] =>
    Array.from(actors.values())
      .filter((meta) => {
        if (isExcluded(meta.actor.laneId, options)) return false;
        const status = meta.actor.status();
        if (status !== "warm") return false;
        return isIdleExpired(meta) || warmCount() > policy.maxWarm;
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

  const enforceWarmLimit = async (options?: SweepIdleOptions) => {
    for (const meta of warmCandidates(options)) {
      if (!isIdleExpired(meta) && warmCount() <= policy.maxWarm) return;
      await meta.actor.suspend();
    }
  };

  return {
    get(laneId) {
      return actors.get(laneId)?.actor ?? null;
    },
    canStartStream,
    create,
    getOrCreate(descriptor) {
      const existing = actors.get(descriptor.laneId)?.actor;
      if (existing !== undefined) {
        existing.updateDescriptor(descriptor);
        return existing;
      }
      return create(descriptor);
    },
    async hydrate(laneId, reason, options) {
      const meta = actors.get(laneId);
      if (meta === undefined) {
        throw new Error(`Unknown session actor lane: ${laneId}`);
      }
      meta.lastViewedAt = now();
      const actor = meta.actor;
      const admission = canStartStream(laneId);
      if (reason === "background-prompt" && admission.type === "stream-limit-reached") {
        return {
          type: "stream-limit-reached",
          actor,
          maxStreaming: admission.maxStreaming,
        };
      }
      await actor.hydrate(reason);
      await enforceWarmLimit(options);
      return { type: "hydrated", actor };
    },
    async sweepIdle(options) {
      await enforceWarmLimit(options);
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

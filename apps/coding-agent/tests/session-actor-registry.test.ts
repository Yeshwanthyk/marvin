import { describe, expect, it } from "bun:test";
import { Agent, type AgentEvent, type AgentTransport } from "@yeshwanthyk/agent-core";
import type {
  ProjectRuntimeBundle,
  SessionActorDescriptor,
  ScopedSessionActorServices,
} from "@yeshwanthyk/runtime-effect/project-bundle.js";
import { HookedTransport, HookRunner } from "@yeshwanthyk/runtime-effect/hooks/index.js";
import { SessionManager } from "@yeshwanthyk/runtime-effect/session-manager.js";
import { Effect, Stream } from "effect";
import {
  createSessionActorRegistry,
} from "../src/runtime/session-actor-registry.js";
import type {
  SessionActor,
  SessionActorStatus,
} from "../src/runtime/session-actor.js";

const descriptor = (laneId: string): SessionActorDescriptor => ({
  laneId,
  projectId: "project",
  cwd: "/tmp/project",
  sessionId: null,
  sessionPath: null,
});

const createFakeActor = (
  input: SessionActorDescriptor,
  onStatusChange: (actor: SessionActor, status: SessionActorStatus) => void,
  initialStatus: SessionActorStatus = "cold",
): SessionActor => {
  let status = initialStatus;
  const setStatus = (next: SessionActorStatus, actor: SessionActor) => {
    status = next;
    onStatusChange(actor, next);
  };
  const actor: SessionActor = {
    laneId: input.laneId,
    projectId: input.projectId,
    cwd: input.cwd,
    descriptor: () => input,
    status: () => status,
    services: () => null,
    projection: {
      subscribe: (_handler: (event: AgentEvent) => void) => () => {},
      applyEvent: (_event: AgentEvent) => {},
      lastEventAt: () => 0,
      unread: () => false,
      clearUnread: () => {},
    },
    hydrate: async () => {
      if (status !== "streaming") setStatus("warm", actor);
      return createFakeServices();
    },
    bindView: () => {},
    unbindView: () => {},
    submit: async () => {},
    steer: () => {},
    suspend: async () => {
      if (status !== "streaming") setStatus("suspended", actor);
    },
    close: async () => {
      setStatus("closed", actor);
    },
  };
  return actor;
};

const fakeTransport: AgentTransport = {
  run: async function* () {},
  continue: async function* () {},
};

const createFakeServices = (): ScopedSessionActorServices => {
  const sessionManager = new SessionManager("/tmp/marvin-test", "/tmp/project");
  const hookRunner = new HookRunner([], "/tmp/project", "/tmp/marvin-test", sessionManager);
  const hookedTransport = new HookedTransport(fakeTransport, hookRunner);
  const agent = new Agent({ transport: hookedTransport });
  const promptQueue = {
    enqueue: () => Effect.void,
    enqueueMany: () => Effect.void,
    trackImmediate: () => Effect.void,
    take: Effect.never,
    takeForProcessing: Effect.never,
    takeAll: Effect.succeed([]),
    acknowledgeHead: () => Effect.void,
    drainToScript: Effect.succeed(null),
    clear: Effect.void,
    pendingSnapshot: Effect.succeed([]),
    countsSnapshot: Effect.succeed({ steer: 0, followUp: 0, total: 0 }),
    snapshot: Effect.succeed({ pending: [], counts: { steer: 0, followUp: 0, total: 0 } }),
    stateStream: Stream.empty,
    restore: () => Effect.void,
    restoreFromScript: () => Effect.void,
  };
  return {
    agent,
    createAgent: () => agent,
    sessionManager,
    promptQueue,
    sessionOrchestrator: {
      queue: promptQueue,
      submitPrompt: () => Effect.void,
      submitPromptAndWait: () => Effect.void,
      snapshot: promptQueue.snapshot,
      drainToScript: Effect.succeed(null),
    },
    hookRunner,
    hookContext: {
      configure: () => Effect.void,
      configured: () => Effect.succeed(true),
    },
    hookedTransport,
    tools: [],
    close: async () => {},
  };
};

const unusedBundle = async (): Promise<ProjectRuntimeBundle> => {
  throw new Error("bundle should not be requested by fake actors");
};

describe("SessionActorRegistry", () => {
  it("suspends least-recent idle warm actors over maxWarm", async () => {
    let clock = 0;
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      now: () => clock,
      policy: { maxWarm: 2, idleTtlMs: 0 },
      createActor: (input, onStatusChange) => createFakeActor(input, onStatusChange),
    });

    const first = registry.create(descriptor("lane-1"));
    const second = registry.create(descriptor("lane-2"));
    const third = registry.create(descriptor("lane-3"));

    clock = 1;
    await first.hydrate("focus");
    clock = 2;
    await second.hydrate("focus");
    clock = 3;
    await third.hydrate("focus");
    await registry.hydrate("lane-3", "focus");

    expect(first.status()).toBe("suspended");
    expect(second.status()).toBe("warm");
    expect(third.status()).toBe("warm");
  });

  it("never suspends streaming actors and rejects new background streams over maxStreaming", async () => {
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      policy: { maxWarm: 1, maxStreaming: 1, idleTtlMs: 0 },
      createActor: (input, onStatusChange) =>
        createFakeActor(
          input,
          onStatusChange,
          input.laneId === "streaming" ? "streaming" : "cold",
        ),
    });

    const streaming = registry.create(descriptor("streaming"));
    const pending = registry.create(descriptor("pending"));
    const result = await registry.hydrate("pending", "background-prompt");

    expect(result.type).toBe("stream-limit-reached");
    expect(streaming.status()).toBe("streaming");
    expect(pending.status()).toBe("cold");
  });
});

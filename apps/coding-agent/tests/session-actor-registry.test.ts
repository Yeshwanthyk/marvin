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
  let currentDescriptor = input;
  let status = initialStatus;
  const setStatus = (next: SessionActorStatus, actor: SessionActor) => {
    status = next;
    onStatusChange(actor, next);
  };
  const actor: SessionActor = {
    laneId: input.laneId,
    projectId: input.projectId,
    cwd: input.cwd,
    descriptor: () => currentDescriptor,
    status: () => status,
    services: () => null,
    projection: {
      messages: () => [],
      toolBlocks: () => [],
      contextTokens: () => 0,
      isResponding: () => false,
      activityState: () => "idle",
      retryStatus: () => null,
      subscribe: (_handler: (event: AgentEvent) => void) => () => {},
      applyEvent: (_event: AgentEvent) => {},
      restoreLoadedSession: () => {},
      lastEventAt: () => 0,
      unread: () => false,
      clearUnread: () => {},
    },
    hydrate: async () => {
      if (status !== "streaming") setStatus("warm", actor);
      return createFakeServices();
    },
    updateDescriptor: (descriptor) => {
      currentDescriptor = descriptor;
    },
    bindView: () => {},
    unbindView: () => {},
    refreshUiPolicy: () => {},
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
      policy: { maxWarm: 2, idleTtlMs: 60_000 },
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

  it("suspends idle warm actors on an explicit TTL sweep", async () => {
    let clock = 0;
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      now: () => clock,
      policy: { maxWarm: 8, idleTtlMs: 10 },
      createActor: (input, onStatusChange) => createFakeActor(input, onStatusChange),
    });

    const actor = registry.create(descriptor("idle"));
    await actor.hydrate("focus");
    clock = 11;
    await registry.sweepIdle();

    expect(actor.status()).toBe("suspended");
  });

  it("does not suspend the excluded lane during an explicit TTL sweep", async () => {
    let clock = 0;
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      now: () => clock,
      policy: { maxWarm: 8, idleTtlMs: 10 },
      createActor: (input, onStatusChange) => createFakeActor(input, onStatusChange),
    });

    const focused = registry.create(descriptor("focused"));
    const idle = registry.create(descriptor("idle"));
    await focused.hydrate("focus");
    await idle.hydrate("focus");
    clock = 11;
    await registry.sweepIdle({ excludeLaneId: "focused" });

    expect(focused.status()).toBe("warm");
    expect(idle.status()).toBe("suspended");
  });

  it("does not suspend any excluded lanes during a focus switch sweep", async () => {
    let clock = 0;
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      now: () => clock,
      policy: { maxWarm: 8, idleTtlMs: 10 },
      createActor: (input, onStatusChange) => createFakeActor(input, onStatusChange),
    });

    const bound = registry.create(descriptor("old-bound"));
    const selected = registry.create(descriptor("new-selected"));
    const idle = registry.create(descriptor("idle"));
    await bound.hydrate("focus");
    await selected.hydrate("focus");
    await idle.hydrate("focus");
    clock = 11;
    await registry.sweepIdle({ excludeLaneIds: ["old-bound", "new-selected"] });

    expect(bound.status()).toBe("warm");
    expect(selected.status()).toBe("warm");
    expect(idle.status()).toBe("suspended");
  });

  it("does not suspend focus-switch lanes during hydrate warm-limit enforcement", async () => {
    let clock = 0;
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      now: () => clock,
      policy: { maxWarm: 1, idleTtlMs: 60_000 },
      createActor: (input, onStatusChange) => createFakeActor(input, onStatusChange),
    });

    const bound = registry.create(descriptor("old-bound"));
    const selected = registry.create(descriptor("new-selected"));
    const idle = registry.create(descriptor("idle"));
    clock = 1;
    await bound.hydrate("focus");
    clock = 2;
    await selected.hydrate("focus");
    clock = 3;
    await idle.hydrate("focus");

    await registry.hydrate("new-selected", "focus", { excludeLaneIds: ["old-bound", "new-selected"] });

    expect(bound.status()).toBe("warm");
    expect(selected.status()).toBe("warm");
    expect(idle.status()).toBe("suspended");
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

  it("reports stream admission before starting another prompt over maxStreaming", () => {
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      policy: { maxStreaming: 1 },
      createActor: (input, onStatusChange) =>
        createFakeActor(
          input,
          onStatusChange,
          input.laneId === "streaming" ? "streaming" : "warm",
        ),
    });

    registry.create(descriptor("streaming"));
    registry.create(descriptor("pending"));

    expect(registry.canStartStream("streaming")).toEqual({ type: "accepted" });
    expect(registry.canStartStream("pending")).toEqual({ type: "stream-limit-reached", maxStreaming: 1 });
  });

  it("counts hydrating actors against stream admission", () => {
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      policy: { maxStreaming: 1 },
      createActor: (input, onStatusChange) =>
        createFakeActor(
          input,
          onStatusChange,
          input.laneId === "hydrating" ? "hydrating" : "warm",
        ),
    });

    registry.create(descriptor("hydrating"));
    registry.create(descriptor("pending"));

    expect(registry.canStartStream("hydrating")).toEqual({ type: "accepted" });
    expect(registry.canStartStream("pending")).toEqual({ type: "stream-limit-reached", maxStreaming: 1 });
  });

  it("refreshes an existing actor descriptor on getOrCreate", () => {
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      createActor: (input, onStatusChange) => createFakeActor(input, onStatusChange),
    });

    const actor = registry.getOrCreate(descriptor("lane-a"));
    const updated = {
      ...descriptor("lane-a"),
      sessionId: "session-a",
      sessionPath: "/tmp/session-a.jsonl",
      initialTitle: "filled lane",
    };

    expect(registry.getOrCreate(updated)).toBe(actor);
    expect(actor.descriptor()).toEqual(updated);
  });

  it("rehydrates suspended actors when they are focused again", async () => {
    const registry = createSessionActorRegistry({
      getBundle: unusedBundle,
      createActor: (input, onStatusChange) =>
        createFakeActor(input, onStatusChange, "suspended"),
    });

    registry.create(descriptor("suspended"));
    const result = await registry.hydrate("suspended", "focus");

    expect(result.type).toBe("hydrated");
    expect(registry.get("suspended")?.status()).toBe("warm");
  });
});

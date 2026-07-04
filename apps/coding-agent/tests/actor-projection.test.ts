import { describe, expect, it } from "bun:test";
import type { AgentEvent, AppMessage } from "@yeshwanthyk/agent-core";
import type {
  ProjectRuntimeBundle,
  ScopedSessionActorServices,
  SessionActorDescriptor,
} from "@yeshwanthyk/runtime-effect/project-bundle.js";
import type {
  PromptQueueItem,
  PromptQueueService,
  PromptQueueSnapshot,
} from "@yeshwanthyk/runtime-effect/session/prompt-queue.js";
import { Effect, Stream } from "effect";
import { createSessionActor } from "../src/runtime/session-actor.js";

interface FakeAgent {
  readonly state: {
    messages: AppMessage[];
    isStreaming: boolean;
    pendingToolCalls: Set<string>;
  };
  subscribe(handler: (event: AgentEvent) => void): () => void;
  emit(event: AgentEvent): void;
  replaceMessages(messages: AppMessage[]): void;
  continue(): Promise<void>;
  abort(): void;
}

const descriptor = (laneId: string): SessionActorDescriptor => ({
  laneId,
  projectId: "project",
  cwd: "/tmp/project",
  sessionId: null,
  sessionPath: null,
});

const createFakeAgent = (): FakeAgent => {
  const listeners = new Set<(event: AgentEvent) => void>();
  return {
    state: {
      messages: [],
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    replaceMessages(messages) {
      this.state.messages = messages.slice();
    },
    continue: async () => {},
    abort: () => {},
  };
};

const queueCounts = (items: ReadonlyArray<PromptQueueItem>): PromptQueueSnapshot["counts"] => {
  let steer = 0;
  let followUp = 0;
  for (const item of items) {
    if (item.mode === "steer") steer += 1;
    else followUp += 1;
  }
  return { steer, followUp };
};

const createFakePromptQueue = (): PromptQueueService => {
  let pending: PromptQueueItem[] = [];
  const listeners = new Set<(snapshot: PromptQueueSnapshot) => void>();
  const snapshot = (): PromptQueueSnapshot => ({ pending: pending.slice(), counts: queueCounts(pending) });
  const publish = () => {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  };
  const removeHead = (item?: PromptQueueItem) => {
    if (pending.length === 0) return;
    if (item === undefined || (pending[0]?.text === item.text && pending[0]?.mode === item.mode)) {
      pending = pending.slice(1);
    }
  };

  return {
    enqueue: (item) => Effect.sync(() => {
      pending = [...pending, item];
      publish();
    }),
    enqueueMany: (items) => Effect.sync(() => {
      pending = [...pending, ...Array.from(items)];
      publish();
    }),
    trackImmediate: (item) => Effect.sync(() => {
      pending = [...pending, item];
      publish();
    }),
    take: Effect.never,
    takeForProcessing: Effect.never,
    takeAll: Effect.sync(() => {
      const items = pending;
      pending = [];
      publish();
      return items;
    }),
    acknowledgeHead: (item) => Effect.sync(() => {
      removeHead(item);
      publish();
    }),
    drainToScript: Effect.succeed(null),
    clear: Effect.sync(() => {
      pending = [];
      publish();
    }),
    pendingSnapshot: Effect.sync(() => pending.slice()),
    countsSnapshot: Effect.sync(() => queueCounts(pending)),
    snapshot: Effect.sync(snapshot),
    stateStream: Stream.async<PromptQueueSnapshot>((emit) => {
      const listener = (next: PromptQueueSnapshot) => {
        emit.single(next);
      };
      listeners.add(listener);
      listener(snapshot());
      return Effect.sync(() => {
        listeners.delete(listener);
      });
    }),
    restore: (items) => Effect.sync(() => {
      pending = Array.from(items);
      publish();
    }),
    restoreFromScript: () => Effect.void,
  };
};

const createFakeServices = () => {
  const agent = createFakeAgent();
  const appended: AppMessage[] = [];
  const promptQueue = createFakePromptQueue();
  let closeCount = 0;
  const services = {
    agent,
    sessionManager: {
      sessionId: "session",
      appendMessage: (message: AppMessage) => {
        appended.push(message);
      },
    },
    promptQueue,
    sessionOrchestrator: {
      queue: promptQueue,
      submitPrompt: () => Effect.void,
      drainToScript: Effect.succeed(null),
    },
    hookRunner: undefined,
    close: async () => {
      closeCount++;
    },
  } as unknown as ScopedSessionActorServices;

  return {
    agent,
    appended,
    promptQueue,
    services,
    closeCount: () => closeCount,
  };
};

const createBundle = (
  servicesByLane: Map<string, ReturnType<typeof createFakeServices>>,
): ProjectRuntimeBundle =>
  ({
    projectId: "project",
    cwd: "/tmp/project",
    config: { configDir: "/tmp/marvin-test" },
    cycleModels: [],
    toolByName: new Map(),
    createActorServices: async (input: SessionActorDescriptor) => {
      const fake = servicesByLane.get(input.laneId);
      if (fake === undefined) throw new Error(`missing fake services for ${input.laneId}`);
      return fake.services;
    },
    close: async () => {},
  }) as unknown as ProjectRuntimeBundle;

const assistantLifecycle = (text: string): AgentEvent[] => [
  { type: "agent_start" } as AgentEvent,
  {
    type: "message_start",
    message: { role: "assistant", content: [] },
  } as unknown as AgentEvent,
  {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: { input: 10, output: 5, cacheRead: 0, totalTokens: 15 },
    },
  } as unknown as AgentEvent,
  { type: "agent_end", messages: [] } as unknown as AgentEvent,
];

const waitFor = async (condition: () => boolean) => {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
};

describe("SessionActor projection", () => {
  it("keeps actor event projections independent", async () => {
    const fakeA = createFakeServices();
    const fakeB = createFakeServices();
    const servicesByLane = new Map([
      ["lane-a", fakeA],
      ["lane-b", fakeB],
    ]);
    const bundle = createBundle(servicesByLane);
    const actorA = createSessionActor({ descriptor: descriptor("lane-a"), getBundle: async () => bundle });
    const actorB = createSessionActor({ descriptor: descriptor("lane-b"), getBundle: async () => bundle });

    await actorA.hydrate("focus");
    await actorB.hydrate("focus");

    for (const event of assistantLifecycle("from a")) fakeA.agent.emit(event);
    for (const event of assistantLifecycle("from b")) fakeB.agent.emit(event);

    expect(actorA.projection.messages()).toHaveLength(1);
    expect(actorB.projection.messages()).toHaveLength(1);
    expect(actorA.projection.messages()[0]).toMatchObject({ role: "assistant", content: "from a" });
    expect(actorB.projection.messages()[0]).toMatchObject({ role: "assistant", content: "from b" });
    expect(actorA.projection.contextTokens()).toBe(15);
    expect(actorB.projection.contextTokens()).toBe(15);
  });

  it("marks unread only while unfocused and clears explicitly", async () => {
    const fake = createFakeServices();
    const bundle = createBundle(new Map([["lane-hidden", fake]]));
    const actor = createSessionActor({ descriptor: descriptor("lane-hidden"), getBundle: async () => bundle });

    await actor.hydrate("background-prompt");
    fake.agent.emit({ type: "agent_start" } as AgentEvent);

    expect(actor.projection.unread()).toBe(true);
    expect(actor.projection.isResponding()).toBe(true);
    expect(actor.projection.lastEventAt()).toBeGreaterThan(0);

    actor.projection.clearUnread();
    expect(actor.projection.unread()).toBe(false);

    actor.bindView({ isFocused: () => true });
    fake.agent.emit({ type: "agent_end", messages: [] } as unknown as AgentEvent);
    expect(actor.projection.unread()).toBe(false);
    expect(actor.projection.isResponding()).toBe(false);
  });

  it("mirrors runtime prompt queue counts and acknowledges matching user starts", async () => {
    const fake = createFakeServices();
    const bundle = createBundle(new Map([["lane-queue", fake]]));
    const actor = createSessionActor({ descriptor: descriptor("lane-queue"), getBundle: async () => bundle });

    await actor.hydrate("background-prompt");
    await Effect.runPromise(fake.promptQueue.enqueue({ text: "queued followup", mode: "followUp" }));
    await waitFor(() => actor.projection.queueCounts().followUp === 1);

    fake.agent.emit({
      type: "message_start",
      message: { role: "user", content: "queued followup" },
    } as unknown as AgentEvent);

    await waitFor(() => actor.projection.queueCounts().followUp === 0);
    const snapshot = await Effect.runPromise(fake.promptQueue.snapshot);
    expect(snapshot).toEqual({ pending: [], counts: { steer: 0, followUp: 0 } });
    expect(actor.projection.messages()[0]).toMatchObject({ role: "user", content: "queued followup" });
  });

  it("unsubscribes on suspend", async () => {
    const fake = createFakeServices();
    const bundle = createBundle(new Map([["lane-suspend", fake]]));
    const actor = createSessionActor({ descriptor: descriptor("lane-suspend"), getBundle: async () => bundle });

    await actor.hydrate("focus");
    for (const event of assistantLifecycle("before suspend")) fake.agent.emit(event);
    expect(actor.projection.messages()).toHaveLength(1);

    await actor.suspend();
    expect(fake.closeCount()).toBe(1);

    for (const event of assistantLifecycle("after suspend")) fake.agent.emit(event);

    expect(actor.projection.messages()).toHaveLength(1);
    expect(actor.projection.messages()[0]).toMatchObject({ role: "assistant", content: "before suspend" });
  });
});

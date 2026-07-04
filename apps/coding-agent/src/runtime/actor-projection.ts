import type { AgentEvent, AppMessage } from "@yeshwanthyk/agent-core";
import type { KnownProvider } from "@yeshwanthyk/ai";
import type { ScopedSessionActorServices } from "@yeshwanthyk/runtime-effect/project-bundle.js";
import type {
  PromptQueueItem,
  PromptQueueSnapshot,
  QueueCounts,
} from "@yeshwanthyk/runtime-effect/session/prompt-queue.js";
import { Effect, Fiber, Stream } from "effect";
import { createSignal, type Accessor } from "solid-js";
import {
  createAgentEventHandler,
  type AgentEventHandler,
  type EventHandlerContext,
} from "../agent-events.js";
import { sessionMessagesToView, type ToolProjectionMeta } from "../domain/messaging/projection.js";
import type { ActivityState, ToolBlock, UIMessage } from "../types.js";
import { createAppStore } from "../ui/state/app-store.js";

const HIDDEN_STREAM_THROTTLE_MS = 500;
const EMPTY_QUEUE_COUNTS: QueueCounts = { steer: 0, followUp: 0 };

export interface SessionActorProjectionStore {
  readonly messages: Accessor<UIMessage[]>;
  readonly toolBlocks: Accessor<ToolBlock[]>;
  readonly contextTokens: Accessor<number>;
  readonly isResponding: Accessor<boolean>;
  readonly activityState: Accessor<ActivityState>;
  readonly retryStatus: Accessor<string | null>;
  readonly queueCounts: Accessor<QueueCounts>;
  readonly lastEventAt: Accessor<number>;
  readonly unread: Accessor<boolean>;
  subscribe(handler: (event: AgentEvent) => void): () => void;
  applyEvent(event: AgentEvent): void;
  restoreLoadedSession(sessionId: string, messages: AppMessage[], toolByName: Map<string, ToolProjectionMeta>): void;
  clearUnread(): void;
}

export interface ActorProjectionOptions {
  readonly isFocused: () => boolean;
  readonly hiddenStreamThrottleMs?: number;
}

export interface ActorProjectionStore extends SessionActorProjectionStore {
  attach(services: ScopedSessionActorServices): void;
  detach(): void;
}

export const createActorProjectionStore = (
  options: ActorProjectionOptions,
): ActorProjectionStore => {
  const store = createAppStore({
    initialTheme: "default",
    initialModelId: "",
    initialThinking: "off",
    initialContextWindow: 0,
    initialProvider: "anthropic" satisfies KnownProvider,
  });
  const [lastEventAt, setLastEventAt] = createSignalAccessor(0);
  const [unread, setUnread] = createSignalAccessor(false);
  const [queueCounts, setQueueCounts] = createSignalAccessor<QueueCounts>(EMPTY_QUEUE_COUNTS);
  const listeners = new Set<(event: AgentEvent) => void>();
  const streamingMessageId: EventHandlerContext["streamingMessageId"] = { current: null };
  const retryState: EventHandlerContext["retryState"] = { attempt: 0, abortController: null };
  let handler: AgentEventHandler | null = null;
  let attachedServices: ScopedSessionActorServices | null = null;
  let promptQueueItems: ReadonlyArray<PromptQueueItem> = [];
  let queueFiber: ReturnType<typeof Effect.runFork> | null = null;
  let queueGeneration = 0;

  const syncQueueSnapshot = (snapshot: PromptQueueSnapshot) => {
    promptQueueItems = snapshot.pending;
    setQueueCounts(snapshot.counts);
  };

  const resetQueueSnapshot = () => {
    promptQueueItems = [];
    setQueueCounts(EMPTY_QUEUE_COUNTS);
  };

  const stopQueueStream = () => {
    queueGeneration += 1;
    if (queueFiber !== null) {
      Effect.runFork(Fiber.interrupt(queueFiber));
      queueFiber = null;
    }
  };

  const promptQueue: EventHandlerContext["promptQueue"] = {
    push: (_item) => {},
    shift: () => {
      const item = promptQueueItems[0];
      if (item !== undefined) {
        const pending = promptQueueItems.slice(1);
        syncQueueSnapshot({ pending, counts: countQueueItems(pending) });
        const services = attachedServices;
        if (services !== null) Effect.runFork(services.promptQueue.acknowledgeHead(item));
      }
      return item;
    },
    drainToScript: () => {
      const services = attachedServices;
      if (services === null) return null;
      const script = Effect.runSync(Effect.catchAll(services.sessionOrchestrator.drainToScript, () => Effect.succeed(null)));
      resetQueueSnapshot();
      return script;
    },
    clear: () => {
      const services = attachedServices;
      resetQueueSnapshot();
      if (services !== null) Effect.runFork(services.promptQueue.clear);
    },
    size: () => promptQueueItems.length,
    peekAll: () => [...promptQueueItems],
    peek: () => promptQueueItems[0],
    counts: () => queueCounts(),
  };

  const attach = (services: ScopedSessionActorServices) => {
    handler?.dispose();
    stopQueueStream();
    attachedServices = services;
    resetQueueSnapshot();
    const generation = queueGeneration;
    let observedQueueStream = false;
    const syncIfCurrent = (snapshot: PromptQueueSnapshot) => {
      if (generation === queueGeneration) syncQueueSnapshot(snapshot);
    };
    void Effect.runPromise(services.promptQueue.snapshot).then((snapshot) => {
      if (!observedQueueStream) syncIfCurrent(snapshot);
    }, () => {});
    queueFiber = Effect.runFork(
      Stream.runForEach(services.promptQueue.stateStream, (snapshot) =>
        Effect.sync(() => {
          observedQueueStream = true;
          syncIfCurrent(snapshot);
        }),
      ),
    );
    const eventContext: EventHandlerContext = {
      setMessages: store.messages.set,
      setToolBlocks: store.toolBlocks.set,
      setActivityState: store.activityState.set,
      setIsResponding: store.isResponding.set,
      setContextTokens: store.contextTokens.set,
      setCacheStats: store.cacheStats.set,
      setRetryStatus: store.retryStatus.set,
      setTurnCount: store.turnCount.set,
      promptQueue,
      sessionManager: services.sessionManager,
      streamingMessageId,
      retryConfig: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
      retryablePattern: /$a/,
      retryState,
      agent: {
        getMessages: () => services.agent.state.messages,
        replaceMessages: (messages: AppMessage[]) => services.agent.replaceMessages(messages),
        continue: services.agent.continue.bind(services.agent),
      },
      hookRunner: services.hookRunner,
      getContextWindow: () => store.displayContextWindow.value(),
      streamUpdateThrottleMs: () =>
        options.isFocused() ? null : (options.hiddenStreamThrottleMs ?? HIDDEN_STREAM_THROTTLE_MS),
    };
    handler = createAgentEventHandler(eventContext);
  };

  const detach = () => {
    handler?.dispose();
    handler = null;
    attachedServices = null;
    stopQueueStream();
    resetQueueSnapshot();
    streamingMessageId.current = null;
    retryState.abortController?.abort();
    retryState.abortController = null;
    retryState.attempt = 0;
  };

  return {
    messages: store.messages.value,
    toolBlocks: store.toolBlocks.value,
    contextTokens: store.contextTokens.value,
    isResponding: store.isResponding.value,
    activityState: store.activityState.value,
    retryStatus: store.retryStatus.value,
    queueCounts,
    lastEventAt,
    unread,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyEvent(event) {
      setLastEventAt(Date.now());
      if (!options.isFocused()) setUnread(true);
      if (event.type === "agent_start") store.isResponding.set(true);
      handler?.(event);
      for (const listener of listeners) {
        listener(event);
      }
    },
    restoreLoadedSession(sessionId, messages, toolByName) {
      const view = sessionMessagesToView(messages, {
        sessionId,
        toolByName,
        shellInjectionPrefix: "[Shell output]",
      });
      store.messages.set(() => view.messages);
      store.toolBlocks.set(() => []);
      store.contextTokens.set(view.contextTokens);
      store.cacheStats.set(null);
      store.retryStatus.set(null);
      store.isResponding.set(false);
      store.activityState.set("idle");
    },
    clearUnread() {
      setUnread(false);
    },
    attach,
    detach,
  };
};

const countQueueItems = (items: ReadonlyArray<PromptQueueItem>): QueueCounts => {
  let steer = 0;
  let followUp = 0;
  for (const item of items) {
    if (item.mode === "steer") steer += 1;
    else followUp += 1;
  }
  return { steer, followUp };
};

const createSignalAccessor = <T,>(initial: T): [Accessor<T>, (value: T) => void] => {
  const [value, setValue] = createSignal(initial);
  return [value, (next: T) => { setValue(() => next); }];
};

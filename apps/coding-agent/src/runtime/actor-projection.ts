import type { AgentEvent, AppMessage } from "@yeshwanthyk/agent-core";
import type { KnownProvider } from "@yeshwanthyk/ai";
import type { ScopedSessionActorServices } from "@yeshwanthyk/runtime-effect/project-bundle.js";
import { createPromptQueue } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js";
import { createSignal, type Accessor } from "solid-js";
import {
  createAgentEventHandler,
  type AgentEventHandler,
  type EventHandlerContext,
} from "../agent-events.js";
import type { ActivityState, ToolBlock, UIMessage } from "../types.js";
import { createAppStore } from "../ui/state/app-store.js";

const HIDDEN_STREAM_THROTTLE_MS = 500;

export interface SessionActorProjectionStore {
  readonly messages: Accessor<UIMessage[]>;
  readonly toolBlocks: Accessor<ToolBlock[]>;
  readonly contextTokens: Accessor<number>;
  readonly isResponding: Accessor<boolean>;
  readonly activityState: Accessor<ActivityState>;
  readonly retryStatus: Accessor<string | null>;
  readonly lastEventAt: Accessor<number>;
  readonly unread: Accessor<boolean>;
  subscribe(handler: (event: AgentEvent) => void): () => void;
  applyEvent(event: AgentEvent): void;
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
  const listeners = new Set<(event: AgentEvent) => void>();
  const streamingMessageId: EventHandlerContext["streamingMessageId"] = { current: null };
  const retryState: EventHandlerContext["retryState"] = { attempt: 0, abortController: null };
  let handler: AgentEventHandler | null = null;

  const attach = (services: ScopedSessionActorServices) => {
    handler?.dispose();
    const eventContext: EventHandlerContext = {
      setMessages: store.messages.set,
      setToolBlocks: store.toolBlocks.set,
      setActivityState: store.activityState.set,
      setIsResponding: store.isResponding.set,
      setContextTokens: store.contextTokens.set,
      setCacheStats: store.cacheStats.set,
      setRetryStatus: store.retryStatus.set,
      setTurnCount: store.turnCount.set,
      promptQueue: createPromptQueue(() => {}),
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
    clearUnread() {
      setUnread(false);
    },
    attach,
    detach,
  };
};

const createSignalAccessor = <T,>(initial: T): [Accessor<T>, (value: T) => void] => {
  const [value, setValue] = createSignal(initial);
  return [value, (next: T) => { setValue(() => next); }];
};

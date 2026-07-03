import type {
  ActorUiPolicy,
  ProjectRuntimeBundle,
  ScopedSessionActorServices,
  SessionActorDescriptor,
} from "@yeshwanthyk/runtime-effect/project-bundle.js";
import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js";
import { Effect } from "effect";
import {
  createActorProjectionStore,
  type SessionActorProjectionStore,
} from "./actor-projection.js";

export type SessionActorStatus =
  | "cold"
  | "hydrating"
  | "warm"
  | "streaming"
  | "suspended"
  | "closing"
  | "closed"
  | "errored";

export type SessionActorHydrateReason = "focus" | "background-prompt" | "rehydrate";

export interface SessionViewBinding {
  readonly isFocused: () => boolean;
}

export interface SessionActor {
  readonly laneId: string;
  readonly projectId: string;
  readonly cwd: string;
  readonly descriptor: () => SessionActorDescriptor;
  readonly status: () => SessionActorStatus;
  readonly services: () => ScopedSessionActorServices | null;
  readonly projection: SessionActorProjectionStore;
  hydrate(reason: SessionActorHydrateReason): Promise<ScopedSessionActorServices>;
  bindView(view: SessionViewBinding): void;
  unbindView(): void;
  refreshUiPolicy(focused: boolean): void;
  submit(text: string, mode: PromptDeliveryMode): Promise<void>;
  steer(text: string): void;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export interface SessionActorOptions {
  readonly descriptor: SessionActorDescriptor;
  readonly getBundle: (descriptor: SessionActorDescriptor) => Promise<ProjectRuntimeBundle>;
  readonly getUiPolicy?: (descriptor: SessionActorDescriptor, focused: boolean) => ActorUiPolicy;
  readonly onStatusChange?: (actor: SessionActor, status: SessionActorStatus) => void;
}

export const createSessionActor = (options: SessionActorOptions): SessionActor => {
  let descriptor = options.descriptor;
  let status: SessionActorStatus = "cold";
  let services: ScopedSessionActorServices | null = null;
  let unsubscribeAgent: (() => void) | null = null;
  let view: SessionViewBinding | null = null;
  const projection = createActorProjectionStore({
    isFocused: () => view?.isFocused() ?? false,
  });

  const setStatus = (next: SessionActorStatus) => {
    status = next;
    options.onStatusChange?.(actor, next);
  };

  const hydrate = async (_reason: SessionActorHydrateReason): Promise<ScopedSessionActorServices> => {
    if (services !== null) return services;
    if (status === "hydrating") {
      throw new Error(`Session actor ${descriptor.laneId} is already hydrating`);
    }
    setStatus("hydrating");
    try {
      const bundle = await options.getBundle(descriptor);
      const focused = view?.isFocused() ?? false;
      const nextServices = await bundle.createActorServices(descriptor, {
        ...(options.getUiPolicy?.(descriptor, focused) ?? {}),
        hasUI: focused,
      });
      projection.attach(nextServices);
      unsubscribeAgent = nextServices.agent.subscribe((event) => {
        projection.applyEvent(event);
        if (event.type === "agent_start") setStatus("streaming");
        if (event.type === "agent_end") setStatus("warm");
      });
      services = nextServices;
      setStatus(nextServices.agent.state.isStreaming ? "streaming" : "warm");
      return nextServices;
    } catch (error) {
      setStatus("errored");
      throw error;
    }
  };

  const refreshUiPolicy = (focused: boolean) => {
    const actorServices = services;
    if (actorServices === null) return;
    const policy = options.getUiPolicy?.(descriptor, focused);
    const notify = (message: string, variant: "info" | "warning" | "success" | "error" = "warning") =>
      policy?.notify?.("Hook needs focus", message, variant);
    actorServices.hookRunner.initialize({
      sendHandler: (text) => notify(`Hook tried to send while lane ${descriptor.laneId} was unfocused: ${text.slice(0, 80)}`),
      sendMessageHandler: (message) => {
        if (message.display) notify(`Hook message available in ${descriptor.cwd}`, "info");
      },
      sendUserMessageHandler: async (text) => notify(`Hook tried to enqueue while unfocused: ${text.slice(0, 80)}`),
      steerHandler: async (text) => notify(`Hook tried to steer while unfocused: ${text.slice(0, 80)}`),
      followUpHandler: async (text) => notify(`Hook tried to follow up while unfocused: ${text.slice(0, 80)}`),
      isIdleHandler: () => !actorServices.agent.state.isStreaming,
      appendEntryHandler: (customType, data) => actorServices.sessionManager.appendEntry(customType, data),
      getSessionId: () => actorServices.sessionManager.sessionId,
      getModel: () => actorServices.agent.state.model ?? null,
      ...(policy?.hookUIContext !== undefined ? { uiContext: policy.hookUIContext } : {}),
      ...(policy?.hookSessionContext !== undefined ? { sessionContext: policy.hookSessionContext } : {}),
      hasUI: focused,
    });
  };

  const suspend = async () => {
    if (services === null) {
      if (status !== "closed" && status !== "closing") setStatus("suspended");
      return;
    }
    const agent = services.agent;
    const snapshot = await Effect.runPromise(services.promptQueue.snapshot);
    if (agent.state.isStreaming || agent.state.pendingToolCalls.size > 0 || snapshot.pending.length > 0) {
      return;
    }
    unsubscribeAgent?.();
    unsubscribeAgent = null;
    projection.detach();
    await services.close();
    services = null;
    setStatus("suspended");
  };

  const close = async () => {
    if (status === "closed" || status === "closing") return;
    setStatus("closing");
    unsubscribeAgent?.();
    unsubscribeAgent = null;
    projection.detach();
    if (services !== null) {
      services.agent.abort();
      await services.close();
      services = null;
    }
    setStatus("closed");
  };

  const actor: SessionActor = {
    laneId: descriptor.laneId,
    projectId: descriptor.projectId,
    cwd: descriptor.cwd,
    descriptor: () => descriptor,
    status: () => status,
    services: () => services,
    projection,
    hydrate,
    bindView(nextView) {
      view = nextView;
      if (view.isFocused()) projection.clearUnread();
    },
    unbindView() {
      view = null;
      refreshUiPolicy(false);
    },
    refreshUiPolicy,
    async submit(text, mode) {
      const actorServices = await hydrate("background-prompt");
      await Effect.runPromise(actorServices.sessionOrchestrator.submitPrompt(text, { mode }));
    },
    steer(text) {
      if (services === null) return;
      void Effect.runPromise(services.sessionOrchestrator.submitPrompt(text, { mode: "steer" }));
    },
    suspend,
    close,
  };

  return actor;
};

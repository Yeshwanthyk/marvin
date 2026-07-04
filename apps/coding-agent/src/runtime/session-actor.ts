import type {
  ActorUiPolicy,
  ProjectRuntimeBundle,
  ScopedSessionActorServices,
  SessionActorDescriptor,
} from "@yeshwanthyk/runtime-effect/project-bundle.js";
import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js";
import type { ToolProjectionMeta } from "../domain/messaging/projection.js";
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
  updateDescriptor(descriptor: SessionActorDescriptor): void;
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

class SessionActorHydrationCancelledError extends Error {
  constructor(laneId: string) {
    super(`Session actor hydration cancelled for lane ${laneId}`);
    this.name = "SessionActorHydrationCancelledError";
  }
}

export const createSessionActor = (options: SessionActorOptions): SessionActor => {
  let descriptor = options.descriptor;
  let status: SessionActorStatus = "cold";
  let services: ScopedSessionActorServices | null = null;
  let hydratePromise: Promise<ScopedSessionActorServices> | null = null;
  let lifecycleTransition: Promise<void> | null = null;
  let lifecycleGeneration = 0;
  let unsubscribeAgent: (() => void) | null = null;
  let view: SessionViewBinding | null = null;
  const projection = createActorProjectionStore({
    isFocused: () => view?.isFocused() ?? false,
  });

  const setStatus = (next: SessionActorStatus) => {
    status = next;
    options.onStatusChange?.(actor, next);
  };

  const cancelHydration = (): Promise<ScopedSessionActorServices> | null => {
    const pending = hydratePromise;
    lifecycleGeneration += 1;
    hydratePromise = null;
    return pending;
  };

  const awaitCancelledHydration = async (pending: Promise<ScopedSessionActorServices> | null) => {
    if (pending === null) return;
    try {
      await pending;
    } catch {
      // The lifecycle caller only needs hydration cleanup to settle.
    }
  };

  const waitForLifecycleTransition = async () => {
    while (lifecycleTransition !== null) {
      const transition = lifecycleTransition;
      try {
        await transition;
      } catch {
        // The next hydrate will observe the actor's resulting status below.
      }
      await Promise.resolve();
    }
  };

  const runLifecycleTransition = (operation: () => Promise<void>): Promise<void> => {
    const previous = lifecycleTransition;
    const transition = (async () => {
      if (previous !== null) {
        try {
          await previous;
        } catch {
          // Later lifecycle operations should still get a chance to run.
        }
      }
      await operation();
    })();
    lifecycleTransition = transition;
    void transition.then(
      () => {
        if (lifecycleTransition === transition) lifecycleTransition = null;
      },
      () => {
        if (lifecycleTransition === transition) lifecycleTransition = null;
      },
    );
    return transition;
  };

  const projectionToolMeta = (bundle: ProjectRuntimeBundle): Map<string, ToolProjectionMeta> => {
    const result = new Map<string, ToolProjectionMeta>();
    for (const [name, entry] of bundle.toolByName.entries()) {
      result.set(name, {
        label: entry.label,
        source: entry.source,
        ...(entry.sourcePath !== undefined ? { sourcePath: entry.sourcePath } : {}),
      });
    }
    return result;
  };

  const hydrate = async (_reason: SessionActorHydrateReason): Promise<ScopedSessionActorServices> => {
    if (lifecycleTransition !== null) await waitForLifecycleTransition();
    if (services !== null) return services;
    if (hydratePromise !== null) return hydratePromise;
    if (status === "closing" || status === "closed") {
      throw new Error(`Cannot hydrate ${status} session actor ${descriptor.laneId}`);
    }
    const generation = lifecycleGeneration;
    const isCurrent = () =>
      lifecycleGeneration === generation && status !== "closing" && status !== "closed" && status !== "suspended";
    const running = (async () => {
      setStatus("hydrating");
      const bundle = await options.getBundle(descriptor);
      if (!isCurrent()) throw new SessionActorHydrationCancelledError(descriptor.laneId);
      const focused = view?.isFocused() ?? false;
      const nextServices = await bundle.createActorServices(descriptor, {
        ...(options.getUiPolicy?.(descriptor, focused) ?? {}),
        hasUI: focused,
      });
      if (!isCurrent()) {
        await nextServices.close();
        throw new SessionActorHydrationCancelledError(descriptor.laneId);
      }
      projection.attach(nextServices);
      if (descriptor.sessionPath !== null) {
        const loaded = nextServices.sessionManager.loadSession(descriptor.sessionPath);
        if (loaded !== null) {
          nextServices.agent.replaceMessages(loaded.messages);
          projection.restoreLoadedSession(loaded.metadata.id, loaded.messages, projectionToolMeta(bundle));
        }
      }
      unsubscribeAgent = nextServices.agent.subscribe((event) => {
        projection.applyEvent(event);
        if (event.type === "agent_start") setStatus("streaming");
        if (event.type === "agent_end") setStatus("warm");
      });
      services = nextServices;
      setStatus(nextServices.agent.state.isStreaming ? "streaming" : "warm");
      return nextServices;
    })();
    hydratePromise = running;
    try {
      return await running;
    } catch (error) {
      if (isCurrent() && !(error instanceof SessionActorHydrationCancelledError)) {
        setStatus("errored");
      }
      throw error;
    } finally {
      if (hydratePromise === running) hydratePromise = null;
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
    await runLifecycleTransition(async () => {
      if (services === null) {
        if (status !== "closed" && status !== "closing") {
          const pendingHydration = cancelHydration();
          setStatus("suspended");
          await awaitCancelledHydration(pendingHydration);
        }
        return;
      }
      const actorServices = services;
      const agent = actorServices.agent;
      const snapshot = await Effect.runPromise(actorServices.promptQueue.snapshot);
      if (agent.state.isStreaming || agent.state.pendingToolCalls.size > 0 || snapshot.pending.length > 0) {
        return;
      }
      const pendingHydration = cancelHydration();
      unsubscribeAgent?.();
      unsubscribeAgent = null;
      projection.detach();
      services = null;
      await actorServices.close();
      await awaitCancelledHydration(pendingHydration);
      setStatus("suspended");
    });
  };

  const close = async () => {
    await runLifecycleTransition(async () => {
      if (status === "closed" || status === "closing") return;
      const pendingHydration = cancelHydration();
      setStatus("closing");
      unsubscribeAgent?.();
      unsubscribeAgent = null;
      projection.detach();
      const actorServices = services;
      services = null;
      if (actorServices !== null) {
        actorServices.agent.abort();
        await actorServices.close();
      }
      await awaitCancelledHydration(pendingHydration);
      setStatus("closed");
    });
  };

  const actor: SessionActor = {
    laneId: descriptor.laneId,
    projectId: descriptor.projectId,
    cwd: descriptor.cwd,
    descriptor: () => descriptor,
    status: () => status,
    services: () => services,
    projection,
    updateDescriptor(nextDescriptor) {
      if (nextDescriptor.laneId !== descriptor.laneId) {
        throw new Error(`Cannot update session actor ${descriptor.laneId} with descriptor for ${nextDescriptor.laneId}`);
      }
      descriptor = nextDescriptor;
    },
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

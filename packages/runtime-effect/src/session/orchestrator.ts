import type { Agent, AppMessage, Attachment } from "@marvin-agents/agent-core";
import { Context, Deferred, Effect, Layer, Ref } from "effect";
import { randomUUID } from "node:crypto";
import type { PromptDeliveryMode, PromptQueueSnapshot, PromptQueueItem } from "./prompt-queue.js";
import { PromptQueueTag, type PromptQueueService } from "./prompt-queue.js";
import { ExecutionPlanBuilderTag, ExecutionPlanStepTag } from "./execution-plan.js";
import { AgentFactoryTag } from "../agent.js";
import { ConfigTag } from "../config.js";
import type { HookEffects } from "../hooks/effects.js";
import { HookEffectsTag } from "../hooks/effects.js";
import type { BeforeAgentStartResult } from "../hooks/types.js";
import { InstrumentationTag } from "../instrumentation.js";
import { SessionManagerTag } from "../session-manager.js";

export interface PromptSubmitOptions {
  readonly mode?: PromptDeliveryMode;
  readonly attachments?: Attachment[];
  readonly beforeStartResult?: BeforeAgentStartResult;
}

export interface SessionOrchestratorService {
  readonly queue: PromptQueueService;
  readonly submitPrompt: (text: string, options?: PromptSubmitOptions) => Effect.Effect<void, never, never>;
  readonly submitPromptAndWait: (
    text: string,
    options?: PromptSubmitOptions,
  ) => Effect.Effect<void, unknown, never>;
  readonly snapshot: Effect.Effect<PromptQueueSnapshot>;
  readonly drainToScript: Effect.Effect<string | null>;
}

export const SessionOrchestratorTag = Context.GenericTag<SessionOrchestratorService>("runtime-effect/SessionOrchestrator");

interface SessionState {
  readonly hasStarted: boolean;
}

const cloneMessages = (messages: AppMessage[]): AppMessage[] => {
  if (typeof structuredClone === "function") {
    return structuredClone(messages);
  }
  return JSON.parse(JSON.stringify(messages)) as AppMessage[];
};

const runPromiseEffect = <T>(thunk: () => Promise<T>): Effect.Effect<T, unknown> => Effect.tryPromise(thunk);

const runAgentPrompt = (agent: Agent, text: string, attachments?: Attachment[]) =>
  runPromiseEffect(() => agent.prompt(text, attachments));

const ensureSession = (
  stateRef: Ref.Ref<SessionState>,
  sessionManager: import("../session-manager.js").SessionManager,
  config: import("../config.js").LoadedAppConfig,
  hookEffects: HookEffects,
) =>
  Effect.flatMap(
    Ref.get(stateRef),
    (state) =>
      state.hasStarted
        ? Effect.succeed(undefined)
        : Effect.gen(function* () {
            sessionManager.startSession(config.provider, config.modelId, config.thinking);
            yield* hookEffects.emit({ type: "session.start", sessionId: sessionManager.sessionId });
            yield* Ref.set(stateRef, { hasStarted: true });
          }),
  );

export const SessionOrchestratorLayer = () =>
  Layer.scoped(
    SessionOrchestratorTag,
    Effect.gen(function* () {
      const queue = yield* PromptQueueTag;
      const { defaultPlan, build } = yield* ExecutionPlanBuilderTag;
      const agentFactory = yield* AgentFactoryTag;
      const { config } = yield* ConfigTag;
      const hookEffects = yield* HookEffectsTag;
      const { sessionManager } = yield* SessionManagerTag;
      const instrumentation = yield* InstrumentationTag;

      const agentRef = yield* Ref.make<Agent>(agentFactory.bootstrapAgent);
      const sessionStateRef = yield* Ref.make<SessionState>({
        hasStarted: sessionManager.sessionId !== null,
      });
      const completionWaitersRef = yield* Ref.make(
        new Map<string, Deferred.Deferred<void, unknown>>(),
      );

      const registerCompletion = Effect.gen(function* () {
        const deferred = yield* Deferred.make<void, unknown>();
        const id = randomUUID();
        yield* Ref.update(completionWaitersRef, (map) => {
          map.set(id, deferred);
          return map;
        });
        return { id, deferred };
      });

      const takeCompletion = (id?: string) =>
        id
          ? Ref.modify(completionWaitersRef, (map) => {
              if (!map.has(id)) {
                return [undefined, map] as const;
              }
              const deferred = map.get(id)!;
              map.delete(id);
              return [deferred, map] as const;
            })
          : Effect.succeed<Deferred.Deferred<void, unknown> | undefined>(undefined);

      const failPendingCompletions = (error: unknown) =>
        Effect.flatMap(
          Ref.modify(completionWaitersRef, (map) => {
            const waiters = Array.from(map.values());
            map.clear();
            return [waiters, map] as const;
          }),
          (waiters) =>
            Effect.forEach(waiters, (deferred) => Deferred.fail(deferred, error), {
              discard: true,
            }),
        );

      const enqueuePrompt = (text: string, options?: PromptSubmitOptions, completionId?: string) => {
        const payload: PromptQueueItem = {
          text,
          mode: options?.mode ?? "followUp",
        };
        if (options?.attachments !== undefined) {
          payload.attachments = options.attachments;
        }
        if (options?.beforeStartResult !== undefined) {
          payload.beforeStartResult = options.beforeStartResult;
        }
        if (completionId !== undefined) {
          payload.completionId = completionId;
        }
        return queue.enqueue(payload);
      };

      const loop = Effect.forever(
        Effect.flatMap(queue.take, (item) =>
          Effect.flatMap(takeCompletion(item.completionId), (completionDeferred) =>
            Effect.gen(function* () {
              const agent = yield* Ref.get(agentRef);
              yield* ensureSession(sessionStateRef, sessionManager, config, hookEffects);

              instrumentation.record({
                type: "tmux:log",
                level: "info",
                message: "prompt:process:start",
                details: { mode: item.mode, text: item.text.slice(0, 80) },
              });

              const beforeStartResult =
                item.beforeStartResult ?? (yield* hookEffects.emitBeforeAgentStart(item.text));
              if (beforeStartResult?.message) {
                sessionManager.appendMessage(beforeStartResult.message as unknown as AppMessage);
              }

              const chatMessageOutput: {
                parts: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
              } = {
                parts: [{ type: "text", text: item.text }],
              };
              for (const attachment of item.attachments ?? []) {
                if (attachment.type === "image") {
                  chatMessageOutput.parts.push({
                    type: "image",
                    data: attachment.content,
                    mimeType: attachment.mimeType,
                  });
                }
              }
              yield* hookEffects.emitChatMessage(
                { sessionId: sessionManager.sessionId, text: item.text },
                chatMessageOutput,
              );

              sessionManager.appendMessage({
                role: "user",
                content: chatMessageOutput.parts,
                attachments: item.attachments && item.attachments.length > 0 ? item.attachments : undefined,
                timestamp: Date.now(),
              });

              const plan = defaultPlan ?? build();
              const attempt = Effect.gen(function* () {
                const ctx = yield* ExecutionPlanStepTag;
                const snapshot = cloneMessages(agent.state.messages);
                agent.setModel(ctx.model);
                yield* runAgentPrompt(agent, item.text, item.attachments).pipe(
                  Effect.catchAll((error) =>
                    Effect.sync(() => agent.replaceMessages(snapshot)).pipe(Effect.flatMap(() => Effect.fail(error))),
                  ),
                );
              });

              yield* Effect.withExecutionPlan(attempt, plan.plan);

              instrumentation.record({
                type: "tmux:log",
                level: "info",
                message: "prompt:process:complete",
                details: { mode: item.mode },
              });

              if (completionDeferred) {
                yield* Deferred.succeed(completionDeferred, undefined);
              }
            }).pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  instrumentation.record({
                    type: "tmux:log",
                    level: "error",
                    message: "prompt:process:error",
                    details: { error: error instanceof Error ? error.message : String(error) },
                  });
                  if (completionDeferred) {
                    yield* Deferred.fail(completionDeferred, error);
                  }
                }),
              ),
            ),
          ),
        ),
      );
      yield* Effect.forkScoped(loop);

      return {
        queue,
        submitPrompt: (text: string, options?: PromptSubmitOptions) => enqueuePrompt(text, options),
        submitPromptAndWait: Effect.fn(function* (text: string, options?: PromptSubmitOptions) {
          const { id, deferred } = yield* registerCompletion;
          yield* enqueuePrompt(text, options, id);
          return yield* Deferred.await(deferred);
        }),
        snapshot: queue.snapshot,
        drainToScript: Effect.flatMap(queue.drainToScript, (script) =>
          Effect.zipRight(
            failPendingCompletions(new Error("prompt queue drained")),
            Effect.succeed(script),
          ),
        ),
      } satisfies SessionOrchestratorService;
    }),
  );

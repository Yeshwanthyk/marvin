import type { Agent, AppMessage, Attachment } from "@yeshwanthyk/agent-core";
import { Context, Deferred, Duration, Effect, Layer, Ref } from "effect";
import { randomUUID } from "node:crypto";
import type { PromptDeliveryMode, PromptQueueSnapshot, PromptQueueItem } from "./prompt-queue.js";
import { PromptQueueTag, type PromptQueueService } from "./prompt-queue.js";
import { ExecutionPlanBuilderTag, ExecutionPlanStepTag } from "./execution-plan.js";
import { AgentFactoryTag } from "../agent.js";
import { ConfigTag } from "../config.js";
import type { HookEffects } from "../hooks/effects.js";
import { HookEffectsTag } from "../hooks/effects.js";
import type { BeforeAgentStartResult, MessagePart } from "../hooks/types.js";
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

const runAgentPromptMessage = (agent: Agent, message: AppMessage) =>
  runPromiseEffect(() => agent.promptMessage(message));

const runAgentSteer = (agent: Agent, text: string) =>
  runPromiseEffect(() =>
    agent.steer({
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    }),
  );

const buildChatMessageParts = (text: string, attachments?: readonly Attachment[]): MessagePart[] => {
  const parts: MessagePart[] = [{ type: "text", text }];
  for (const attachment of attachments ?? []) {
    if (attachment.type === "image") {
      parts.push({
        type: "image",
        data: attachment.content,
        mimeType: attachment.mimeType,
      });
    }
  }
  return parts;
};

const buildUserMessage = (parts: MessagePart[], attachments?: readonly Attachment[]): AppMessage => {
  const message: AppMessage = {
    role: "user",
    content: parts,
    timestamp: Date.now(),
  };
  if (attachments !== undefined && attachments.length > 0) {
    return { ...message, attachments: [...attachments] };
  }
  return message;
};

const ensureSession = (
  stateRef: Ref.Ref<SessionState>,
  sessionManager: import("../session-manager.js").SessionManager,
  config: import("../config.js").LoadedAppConfig,
  hookEffects: HookEffects,
) =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    if (state.hasStarted && sessionManager.sessionId !== null) return;
    if (sessionManager.sessionId !== null) {
      yield* Ref.set(stateRef, { hasStarted: true });
      return;
    }
    sessionManager.startSession(config.provider, config.modelId, config.thinking);
    yield* hookEffects.emit({ type: "session.start", sessionId: sessionManager.sessionId });
    yield* Ref.set(stateRef, { hasStarted: true });
  });

export interface SessionOrchestratorOptions {
  readonly timeout?: number;
}

export const SessionOrchestratorLayer = (options?: SessionOrchestratorOptions) =>
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
      const isProcessingRef = yield* Ref.make(false);
      const immediateSteerItemsRef = yield* Ref.make<ReadonlyArray<PromptQueueItem>>([]);
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

      const takeCompletion = (id: string) =>
        Ref.modify(completionWaitersRef, (map) => {
          const deferred = map.get(id);
          if (deferred === undefined) {
            return [undefined, map] as const;
          }
          map.delete(id);
          return [deferred, map] as const;
        });

      const takeItemCompletion = (item: PromptQueueItem) =>
        item.completionId === undefined
          ? Effect.succeed<Deferred.Deferred<void, unknown> | undefined>(undefined)
          : takeCompletion(item.completionId);

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

      const createPromptItem = (text: string, options?: PromptSubmitOptions) => {
        const item: PromptQueueItem = {
          text,
          mode: options?.mode ?? "followUp",
        };
        if (options?.attachments !== undefined) {
          item.attachments = options.attachments;
        }
        if (options?.beforeStartResult !== undefined) {
          item.beforeStartResult = options.beforeStartResult;
        }
        return item;
      };

      const acknowledgeProcessedItems = (item: PromptQueueItem) =>
        Effect.gen(function* () {
          const immediateSteerItems = yield* Ref.modify(immediateSteerItemsRef, (items) => [items, []] as const);
          yield* queue.acknowledgeHead(item);
          yield* Effect.forEach(immediateSteerItems, (steerItem) => queue.acknowledgeHead(steerItem), {
            discard: true,
          });
        });

      const submitPromptItem = (item: PromptQueueItem) =>
        Effect.gen(function* () {
          const isProcessing = yield* Ref.get(isProcessingRef);
          if (item.mode !== "steer" || !isProcessing) {
            yield* queue.enqueue(item);
            return;
          }

          const agent = yield* Ref.get(agentRef);
          yield* queue.trackImmediate(item);
          yield* Ref.update(immediateSteerItemsRef, (items) => [...items, item]);
          yield* runAgentSteer(agent, item.text).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                instrumentation.record({
                  type: "tmux:log",
                  level: "error",
                  message: "prompt:steer:error",
                  details: { error: error instanceof Error ? error.message : String(error) },
                });
                if (item.completionId !== undefined) {
                  const deferred = yield* takeCompletion(item.completionId);
                  if (deferred) {
                    yield* Deferred.fail(deferred, error);
                  }
                }
              }),
            ),
          );
          if (item.completionId !== undefined) {
            const deferred = yield* takeCompletion(item.completionId);
            if (deferred) {
              yield* Deferred.succeed(deferred, undefined);
            }
          }
        });

      const submitPrompt = (text: string, options?: PromptSubmitOptions) =>
        submitPromptItem(createPromptItem(text, options));

      const loop = Effect.forever(
        Effect.flatMap(queue.takeForProcessing, (item) =>
          Effect.flatMap(takeItemCompletion(item), (completionDeferred) =>
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

              const chatMessageOutput = {
                parts: buildChatMessageParts(item.text, item.attachments),
              };
              yield* hookEffects.emitChatMessage(
                { sessionId: sessionManager.sessionId, text: item.text },
                chatMessageOutput,
              );

              const userMessage = buildUserMessage(chatMessageOutput.parts, item.attachments);
              sessionManager.appendMessage(userMessage);

              const plan = defaultPlan ?? build();
              yield* Ref.set(immediateSteerItemsRef, []);
              const attempt = Effect.gen(function* () {
                const ctx = yield* ExecutionPlanStepTag;
                const snapshot = cloneMessages(agent.state.messages);
                agent.setModel(ctx.model);
                if (ctx.thinking !== undefined) {
                  agent.setThinkingLevel(ctx.thinking);
                }
                yield* Ref.set(isProcessingRef, true);
                yield* runAgentPromptMessage(agent, userMessage).pipe(
                  Effect.catchAll((error) =>
                    Effect.sync(() => agent.replaceMessages(snapshot)).pipe(Effect.flatMap(() => Effect.fail(error))),
                  ),
                  Effect.ensuring(Ref.set(isProcessingRef, false)),
                );
              });

              const attemptMaybeWithTimeout = options?.timeout
                ? attempt.pipe(Effect.timeout(Duration.millis(options.timeout)))
                : attempt;

              yield* Effect.withExecutionPlan(attemptMaybeWithTimeout, plan.plan);

              instrumentation.record({
                type: "tmux:log",
                level: "info",
                message: "prompt:process:complete",
                details: { mode: item.mode },
              });

              if (completionDeferred) {
                yield* Deferred.succeed(completionDeferred, undefined);
              }
              yield* acknowledgeProcessedItems(item);
            }).pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  yield* Ref.set(isProcessingRef, false);
                  instrumentation.record({
                    type: "tmux:log",
                    level: "error",
                    message: "prompt:process:error",
                    details: { error: error instanceof Error ? error.message : String(error) },
                  });
                  if (completionDeferred) {
                    yield* Deferred.fail(completionDeferred, error);
                  }
                  yield* acknowledgeProcessedItems(item);
                }),
              ),
            ),
          ),
        ),
      );
      yield* Effect.forkScoped(loop);

      return {
        queue,
        submitPrompt: (text: string, options?: PromptSubmitOptions) => submitPrompt(text, options),
        submitPromptAndWait: Effect.fn(function* (text: string, options?: PromptSubmitOptions) {
          const { id, deferred } = yield* registerCompletion;
          yield* submitPromptItem({ ...createPromptItem(text, options), completionId: id });
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

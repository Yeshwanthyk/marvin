import type { Agent, AppMessage } from "@marvin-agents/agent-core";
import { Context, Effect, Layer, Ref } from "effect";
import type { PromptDeliveryMode, PromptQueueSnapshot } from "./prompt-queue.js";
import { PromptQueueTag, type PromptQueueService } from "./prompt-queue.js";
import { ExecutionPlanBuilderTag, ExecutionPlanStepTag } from "./execution-plan.js";
import { AgentFactoryTag } from "../agent.js";
import { ConfigTag } from "../config.js";
import type { HookEffects } from "../hooks/effects.js";
import { HookEffectsTag } from "../hooks/effects.js";
import { InstrumentationTag } from "../instrumentation.js";
import { SessionManagerTag } from "../session-manager.js";

export interface SessionOrchestratorService {
  readonly queue: PromptQueueService;
  readonly submitPrompt: (text: string, mode?: PromptDeliveryMode) => Effect.Effect<void>;
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

const runAgentPrompt = (agent: Agent, text: string) => runPromiseEffect(() => agent.prompt(text));

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

      const loop = Effect.forever(
        Effect.flatMap(queue.take, (item) =>
          Effect.gen(function* () {
            const agent = yield* Ref.get(agentRef);
            yield* ensureSession(sessionStateRef, sessionManager, config, hookEffects);

            instrumentation.record({
              type: "dmux:log",
              level: "info",
              message: "prompt:process:start",
              details: { mode: item.mode, text: item.text.slice(0, 80) },
            });

            const beforeStart = yield* hookEffects.emitBeforeAgentStart(item.text);
            if (beforeStart?.message) {
              sessionManager.appendMessage(beforeStart.message as unknown as AppMessage);
            }

            const chatMessageOutput: {
              parts: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
            } = {
              parts: [{ type: "text", text: item.text }],
            };
            yield* hookEffects.emitChatMessage(
              { sessionId: sessionManager.sessionId, text: item.text },
              chatMessageOutput,
            );

            sessionManager.appendMessage({
              role: "user",
              content: chatMessageOutput.parts,
              timestamp: Date.now(),
            });

            const plan = defaultPlan ?? build();
            const attempt = Effect.gen(function* () {
              const ctx = yield* ExecutionPlanStepTag;
              const snapshot = cloneMessages(agent.state.messages);
              agent.setModel(ctx.model);
              yield* runAgentPrompt(agent, item.text).pipe(
                Effect.catchAll((error) =>
                  Effect.sync(() => agent.replaceMessages(snapshot)).pipe(Effect.flatMap(() => Effect.fail(error))),
                ),
              );
            });

            yield* Effect.withExecutionPlan(attempt, plan.plan);

            instrumentation.record({
              type: "dmux:log",
              level: "info",
              message: "prompt:process:complete",
              details: { mode: item.mode },
            });
          }).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                instrumentation.record({
                  type: "dmux:log",
                  level: "error",
                  message: "prompt:process:error",
                  details: { error: error instanceof Error ? error.message : String(error) },
                });
              }),
            ),
          ),
        ),
      );
      yield* Effect.forkScoped(loop);

      return {
        queue,
        submitPrompt: (text: string, mode: PromptDeliveryMode = "followUp") =>
          queue.enqueue({ text, mode }),
        snapshot: queue.snapshot,
        drainToScript: queue.drainToScript,
      } satisfies SessionOrchestratorService;
    }),
  );

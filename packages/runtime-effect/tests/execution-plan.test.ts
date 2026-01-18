import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import * as Runtime from "effect/Runtime";
import { getModels, type Model, type Api, type KnownProvider } from "@marvin-agents/ai";
import type { LoadedAppConfig } from "../src/config.js";
import { ConfigTag } from "../src/config.js";
import { NoopInstrumentationLayer } from "../src/instrumentation.js";
import {
  ExecutionPlanBuilderLayer,
  ExecutionPlanBuilderTag,
  ExecutionPlanStepTag,
  classifyExecutionPlanError,
  isRetryableExecutionPlanError,
  type ExecutionPlanBuilderOptions,
  type PlanModelEntry,
} from "../src/session/execution-plan.js";

const anthropicModel = getModels("anthropic")[0]!;
const openaiModel = getModels("openai")[0]!;

const createTestConfig = (model: Model<Api>, provider: KnownProvider): LoadedAppConfig => ({
  provider,
  modelId: model.id,
  model,
  thinking: "off",
  theme: "marvin",
  systemPrompt: "System prompt",
  agentsConfig: { combined: "" },
  configDir: "/tmp/marvin-test",
  configPath: "/tmp/marvin-test/config.json",
  lsp: { enabled: false, autoInstall: false },
});

const TestConfigLayer = Layer.succeed(ConfigTag, { config: createTestConfig(anthropicModel, "anthropic") });

const runWithBuilder = async <A>(
  options: ExecutionPlanBuilderOptions | undefined,
  program: Effect.Effect<A>,
) => {
  const scoped = Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* Layer.toRuntime(
        Layer.provide(ExecutionPlanBuilderLayer(options), Layer.mergeAll(TestConfigLayer, NoopInstrumentationLayer)),
      );
      return yield* Effect.promise(() => Runtime.runPromise(runtime, program));
    }),
  );
  return await Effect.runPromise(scoped);
};

describe("ExecutionPlanBuilderLayer", () => {
  it("builds default plan from config", async () => {
    const steps = await runWithBuilder(
      undefined,
      Effect.gen(function* () {
        const builder = yield* ExecutionPlanBuilderTag;
        return builder.defaultPlan.steps;
      }),
    );

    expect(steps).toHaveLength(1);
    expect(steps[0]?.provider).toBe("anthropic");
    expect(steps[0]?.modelId).toBe(anthropicModel.id);
    expect(steps[0]?.attempts).toBe(3);
  });

  it("supports custom fallback cycle entries", async () => {
    const customCycle: PlanModelEntry[] = [
      { provider: "anthropic", model: anthropicModel },
      { provider: "openai", model: openaiModel },
    ];

    const result = await runWithBuilder(
      undefined,
      Effect.gen(function* () {
        const builder = yield* ExecutionPlanBuilderTag;
        return builder.build({ cycle: customCycle });
      }),
    );

    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]?.provider).toBe("openai");
    expect(result.steps[1]?.isFallback).toBe(true);
    expect(result.steps[1]?.attempts).toBe(2);
  });

  it("provides step context during execution", async () => {
    const customCycle: PlanModelEntry[] = [
      { provider: "anthropic", model: anthropicModel },
      { provider: "openai", model: openaiModel },
    ];

    const output = await runWithBuilder(
      undefined,
      Effect.gen(function* () {
        const builder = yield* ExecutionPlanBuilderTag;
        const { plan } = builder.build({ cycle: customCycle });
        const trace: string[] = [];

        const effect = Effect.gen(function* () {
          const step = yield* ExecutionPlanStepTag;
          trace.push(step.descriptor.id);
          if (step.descriptor.isFallback) {
            return step.descriptor.provider;
          }
          return yield* Effect.fail(new Error("force fallback"));
        });

        const value = yield* Effect.withExecutionPlan(effect, plan);
        return { value, trace };
      }),
    );

    expect(output.value).toBe("openai");
    expect(output.trace).toEqual([
      `primary-anthropic-${anthropicModel.id}`,
      `primary-anthropic-${anthropicModel.id}`,
      `fallback-openai-${openaiModel.id}`,
    ]);
  });
});

describe("Execution plan error classification", () => {
  it("classifies retryable errors", () => {
    expect(classifyExecutionPlanError(new Error("socket hang up"))).toBe("network");
    expect(isRetryableExecutionPlanError(new Error("socket hang up"))).toBe(true);

    expect(classifyExecutionPlanError(new Error("Rate limit exceeded"))).toBe("rateLimit");
    expect(isRetryableExecutionPlanError(new Error("Rate limit exceeded"))).toBe(true);
  });

  it("classifies non-retryable errors", () => {
    expect(classifyExecutionPlanError(new Error("Invalid API key"))).toBe("auth");
    expect(isRetryableExecutionPlanError(new Error("Invalid API key"))).toBe(false);

    expect(classifyExecutionPlanError("provider is down for maintenance")).toBe("providerOutage");
  });
});

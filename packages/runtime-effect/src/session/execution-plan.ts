import { Context, Duration, Effect, ExecutionPlan, Layer, Schedule } from "effect";
import type { ExecutionPlan as ExecutionPlanType } from "effect/ExecutionPlan";
import type { Api, Model, KnownProvider } from "@yeshwanthyk/ai";
import { ConfigTag } from "../config.js";
import { InstrumentationTag, type InstrumentationService } from "../instrumentation.js";

export interface PlanModelEntry {
  readonly provider: KnownProvider;
  readonly model: Model<Api>;
}

export interface ExecutionPlanAttempts {
  readonly primary: number;
  readonly fallback: number;
}

export const defaultAttempts: ExecutionPlanAttempts = {
  primary: 3,
  fallback: 2,
};

type ExecutionPlanSchedule = Schedule.Schedule<unknown, unknown, never>;

const defaultSchedule: ExecutionPlanSchedule = Schedule.exponential(Duration.millis(100), 2);

const NETWORK_ERROR_PATTERNS = [
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
  "socket hang up",
  "network error",
  "Failed to fetch",
  "fetch failed",
  "ETIMEDOUT",
  "timed out",
  "timeout",
  "TLS handshake timeout",
  "Temporary failure in name resolution",
  "ENOTFOUND",
];

const RATE_LIMIT_PATTERNS = [
  "rate limit",
  "too many requests",
  "exceeded your current quota",
  "429",
  "try again later",
];

const PROVIDER_OUTAGE_PATTERNS = [
  "overloaded",
  "at capacity",
  "capacity exceeded",
  "service unavailable",
  "upstream error",
  "bad gateway",
  "provider is down",
  "model is currently overloaded",
];

const AUTH_PATTERNS = ["invalid api key", "unauthorized", "access denied", "permission"];

export type ExecutionPlanErrorCategory = "network" | "rateLimit" | "providerOutage" | "auth" | "unknown";

const toErrorMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    if (error.message) return error.message;
    return error.toString();
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const matchesPattern = (message: string, patterns: readonly string[]): boolean => {
  const lower = message.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
};

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  typeof (error as { name?: unknown }).name === "string" &&
  (error as { name?: string }).name === "AbortError";

export const classifyExecutionPlanError = (error: unknown): ExecutionPlanErrorCategory => {
  if (isAbortError(error)) return "unknown";
  const message = toErrorMessage(error);
  if (matchesPattern(message, NETWORK_ERROR_PATTERNS)) return "network";
  if (matchesPattern(message, RATE_LIMIT_PATTERNS)) return "rateLimit";
  if (matchesPattern(message, PROVIDER_OUTAGE_PATTERNS)) return "providerOutage";
  if (matchesPattern(message, AUTH_PATTERNS)) return "auth";
  return "unknown";
};

export const isRetryableExecutionPlanError = (error: unknown): boolean => {
  const category = classifyExecutionPlanError(error);
  return category === "network" || category === "rateLimit";
};

const createRetryPredicate = () => {
  let isFirstInput = true;
  return (error: unknown) => {
    if (isFirstInput) {
      isFirstInput = false;
      return true;
    }
    return isRetryableExecutionPlanError(error);
  };
};

export interface ExecutionPlanStepDescriptor {
  readonly id: string;
  readonly index: number;
  readonly provider: KnownProvider;
  readonly modelId: string;
  readonly modelName: string;
  readonly attempts: number;
  readonly isFallback: boolean;
}

export interface ExecutionPlanStepContext {
  readonly descriptor: ExecutionPlanStepDescriptor;
  readonly model: Model<Api>;
}

export const ExecutionPlanStepTag = Context.GenericTag<ExecutionPlanStepContext>("runtime-effect/ExecutionPlanStep");

export interface BuiltExecutionPlan {
  readonly plan: ExecutionPlanType<{
    provides: ExecutionPlanStepContext;
    input: unknown;
    error: never;
    requirements: never;
  }>;
  readonly steps: ExecutionPlanStepDescriptor[];
}

export interface ExecutionPlanBuilderOptions {
  readonly cycle?: ReadonlyArray<PlanModelEntry>;
  readonly attempts?: Partial<ExecutionPlanAttempts>;
  readonly schedule?: ExecutionPlanSchedule;
}

export interface ExecutionPlanBuilderService {
  readonly defaultPlan: BuiltExecutionPlan;
  readonly build: (options?: ExecutionPlanBuilderOptions) => BuiltExecutionPlan;
}

export const ExecutionPlanBuilderTag = Context.GenericTag<ExecutionPlanBuilderService>("runtime-effect/ExecutionPlanBuilder");

const ensureAttempts = (attempts?: Partial<ExecutionPlanAttempts>): ExecutionPlanAttempts => ({
  primary: Math.max(1, attempts?.primary ?? defaultAttempts.primary),
  fallback: Math.max(1, attempts?.fallback ?? defaultAttempts.fallback),
});

const mergeAttempts = (
  base: ExecutionPlanAttempts,
  overrides?: Partial<ExecutionPlanAttempts>,
): ExecutionPlanAttempts =>
  ensureAttempts({
    primary: overrides?.primary ?? base.primary,
    fallback: overrides?.fallback ?? base.fallback,
  });

const buildExecutionPlan = (
  cycle: ReadonlyArray<PlanModelEntry>,
  schedule: ExecutionPlanSchedule,
  attempts: ExecutionPlanAttempts,
  instrumentation: InstrumentationService,
): BuiltExecutionPlan => {
  if (cycle.length === 0) {
    throw new Error("ExecutionPlan requires at least one model entry");
  }

  const stepDescriptors: ExecutionPlanStepDescriptor[] = cycle.map((entry, index) => ({
    id: `${index === 0 ? "primary" : "fallback"}-${entry.provider}-${entry.model.id}`,
    index,
    provider: entry.provider,
    modelId: entry.model.id,
    modelName: entry.model.name,
    attempts: index === 0 ? attempts.primary : attempts.fallback,
    isFallback: index > 0,
  }));

  instrumentation.record({
    type: "tmux:log",
    level: "info",
    message: "execution-plan:registered",
    details: {
      steps: stepDescriptors.map((step) => ({
        id: step.id,
        provider: step.provider,
        modelId: step.modelId,
        attempts: step.attempts,
        isFallback: step.isFallback,
      })),
    },
  });

  const planSteps = stepDescriptors.map((descriptor) => ({
    provide: Layer.succeedContext(
      Context.make(ExecutionPlanStepTag, {
        descriptor,
        model: cycle[descriptor.index]!.model,
      }),
    ),
    attempts: descriptor.attempts,
    schedule,
    while: createRetryPredicate(),
  }));

  const [firstStep, ...otherSteps] = planSteps;
  if (!firstStep) {
    throw new Error("ExecutionPlan requires at least one step definition");
  }
  const plan = ExecutionPlan.make(firstStep, ...otherSteps);

  return { plan, steps: stepDescriptors };
};

export const ExecutionPlanBuilderLayer = (options?: ExecutionPlanBuilderOptions) =>
  Layer.effect(
    ExecutionPlanBuilderTag,
    Effect.gen(function* () {
      const { config } = yield* ConfigTag;
      const instrumentation = yield* InstrumentationTag;

      const baseCycle: ReadonlyArray<PlanModelEntry> =
        options?.cycle ?? [
          {
            provider: config.provider,
            model: config.model,
          },
        ];

      const baseSchedule = options?.schedule ?? defaultSchedule;
      const baseAttempts = ensureAttempts(options?.attempts);

      const buildWith = (overrides?: ExecutionPlanBuilderOptions): BuiltExecutionPlan => {
        const cycle = overrides?.cycle ?? baseCycle;
        const schedule = overrides?.schedule ?? baseSchedule;
        const attempts = mergeAttempts(baseAttempts, overrides?.attempts);
        return buildExecutionPlan(cycle, schedule, attempts, instrumentation);
      };

      return {
        defaultPlan: buildWith(),
        build: buildWith,
      } satisfies ExecutionPlanBuilderService;
    }),
  );

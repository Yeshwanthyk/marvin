import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import * as Runtime from "effect/Runtime";
import { getModels, type Api, type Model, type KnownProvider } from "@marvin-agents/ai";
import type { AppMessage } from "@marvin-agents/agent-core";
import { SessionOrchestratorLayer, SessionOrchestratorTag } from "../src/session/orchestrator.js";
import { PromptQueueLayer } from "../src/session/prompt-queue.js";
import { ExecutionPlanBuilderLayer, type ExecutionPlanBuilderOptions } from "../src/session/execution-plan.js";
import { ConfigTag, type LoadedAppConfig } from "../src/config.js";
import { AgentFactoryTag } from "../src/agent.js";
import { ExtensibilityTag } from "../src/extensibility/index.js";
import { InstrumentationTag, type InstrumentationEvent, type InstrumentationService } from "../src/instrumentation.js";
import { SessionManagerTag } from "../src/session-manager.js";
import type { HookRunner } from "../src/hooks/index.js";

const anthropicModel = getModels("anthropic")[0]!;
const openAiModel = getModels("openai")[0]!;

const createTestConfig = (model: Model<Api>, provider: KnownProvider): LoadedAppConfig => ({
  provider,
  modelId: model.id,
  model,
  thinking: "off",
  theme: "marvin",
  systemPrompt: "system",
  agentsConfig: { combined: "" },
  configDir: "/tmp/marvin-test",
  configPath: "/tmp/marvin-test/config.json",
  lsp: { enabled: false, autoInstall: false },
});

class TestAgent {
  state: {
    systemPrompt: string;
    model: Model<Api>;
    thinkingLevel: "off";
    tools: [];
    messages: AppMessage[];
  };
  prompts: string[] = [];
  modelsUsed: string[] = [];
  callCount = 0;
  failuresBeforeSuccess = 0;
  replaceSnapshots: AppMessage[][] = [];

  constructor(model: Model<Api>) {
    this.state = {
      systemPrompt: "system",
      model,
      thinkingLevel: "off",
      tools: [],
      messages: [],
    };
  }

  setModel(model: Model<Api>) {
    this.state.model = model;
    this.modelsUsed.push(model.id);
  }

  replaceMessages(messages: AppMessage[]) {
    this.state.messages = messages.slice();
    this.replaceSnapshots.push(messages.slice());
  }

  async prompt(text: string) {
    this.callCount++;
    this.prompts.push(text);
    if (this.callCount <= this.failuresBeforeSuccess) {
      throw new Error("planned failure");
    }
    this.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: `ok:${text}` }],
      timestamp: Date.now(),
    } as AppMessage);
  }
}

class TestSessionManager {
  sessionIdValue: string | null = null;
  startCount = 0;
  appended: AppMessage[] = [];

  startSession(): string {
    this.startCount += 1;
    this.sessionIdValue = `session-${this.startCount}`;
    return this.sessionIdValue;
  }

  appendMessage(message: AppMessage) {
    this.appended.push(message);
  }

  get sessionId(): string | null {
    return this.sessionIdValue;
  }
}

class TestHookRunner {
  beforeStart: string[] = [];
  chatEvents: Array<{ text: string }> = [];
  emitted: Array<{ type: string }> = [];

  async emitBeforeAgentStart(text: string) {
    this.beforeStart.push(text);
    return undefined;
  }

  async emitChatMessage(input: { text: string }, _output: unknown) {
    this.chatEvents.push({ text: input.text });
  }

  async emit(event: { type: string }) {
    this.emitted.push(event);
  }

  onError() {
    return () => {};
  }
}

class TestInstrumentation implements InstrumentationService {
  events: InstrumentationEvent[] = [];

  record(event: InstrumentationEvent) {
    this.events.push(event);
  }
}

const waitForAgentCalls = (agent: TestAgent, expected: number) =>
  Effect.async<void>((resume) => {
    const interval = setInterval(() => {
      if (agent.callCount >= expected) {
        clearInterval(interval);
        clearTimeout(timeout);
        resume(Effect.succeed(undefined));
      }
    }, 5);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      resume(Effect.fail(new Error("timed out waiting for agent calls")));
    }, 1000);
    return Effect.sync(() => {
      clearInterval(interval);
      clearTimeout(timeout);
    });
  });

interface LayerOptions {
  agent: TestAgent;
  sessionManager: TestSessionManager;
  hookRunner: TestHookRunner;
  instrumentation: TestInstrumentation;
  config?: LoadedAppConfig;
  executionPlanOptions?: ExecutionPlanBuilderOptions;
}

const createTestLayer = (options: LayerOptions) => {
  const configLayer = Layer.succeed(ConfigTag, { config: options.config ?? createTestConfig(anthropicModel, "anthropic") });
  const instrumentationLayer = Layer.succeed(InstrumentationTag, options.instrumentation);
  const agentFactoryLayer = Layer.succeed(AgentFactoryTag, {
    bootstrapAgent: options.agent as any,
    createAgent: () => options.agent as any,
    transport: {} as any,
    tools: [],
  });
  const extensibilityLayer = Layer.succeed(ExtensibilityTag, {
    hookRunner: options.hookRunner as unknown as HookRunner,
    customTools: [],
    validationIssues: [],
    hookCount: 0,
  });
  const sessionManagerLayer = Layer.succeed(SessionManagerTag, {
    sessionManager: options.sessionManager as any,
  });
  const composed = Layer.mergeAll(
    PromptQueueLayer,
    ExecutionPlanBuilderLayer(options.executionPlanOptions),
    agentFactoryLayer,
    extensibilityLayer,
    sessionManagerLayer,
  );
  const withOrchestrator = Layer.provide(SessionOrchestratorLayer(), composed);
  return Layer.provide(withOrchestrator, Layer.mergeAll(configLayer, instrumentationLayer));
};

const runWithLayer = async <A>(layer: Layer.Layer<never, never, never>, program: Effect.Effect<A>) => {
  const scoped = Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* Layer.toRuntime(layer);
      return yield* Effect.promise(() => Runtime.runPromise(runtime, program));
    }),
  );
  return await Effect.runPromise(scoped);
};

describe("SessionOrchestratorLayer", () => {
  it("processes queued prompts and emits hook/session side effects", async () => {
    const agent = new TestAgent(anthropicModel);
    const sessionManager = new TestSessionManager();
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({ agent, sessionManager, hookRunner, instrumentation });

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("build the feature");
        yield* waitForAgentCalls(agent, 1);
      }),
    );

    expect(agent.prompts).toEqual(["build the feature"]);
    expect(sessionManager.startCount).toBe(1);
    expect(sessionManager.appended[0]?.role).toBe("user");
    expect(hookRunner.beforeStart).toEqual(["build the feature"]);
    expect(instrumentation.events.some((ev) => ev.type === "dmux:log" && ev.message === "prompt:process:complete")).toBe(
      true,
    );
  });

  it("retries prompts with execution plans and restores state on failure", async () => {
    const agent = new TestAgent(anthropicModel);
    agent.failuresBeforeSuccess = 1;
    const sessionManager = new TestSessionManager();
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({
      agent,
      sessionManager,
      hookRunner,
      instrumentation,
      executionPlanOptions: {
        cycle: [
          { provider: "anthropic", model: anthropicModel },
          { provider: "openai", model: openAiModel },
        ],
        attempts: { primary: 1, fallback: 1 },
      },
    });

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("fallback please");
        yield* waitForAgentCalls(agent, 2);
      }),
    );

    expect(agent.callCount).toBe(2);
    expect(agent.modelsUsed).toEqual([anthropicModel.id, openAiModel.id]);
    expect(agent.replaceSnapshots).toHaveLength(1);
  });
});

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import * as Runtime from "effect/Runtime";
import { getModels, type Api, type Model, type KnownProvider } from "@yeshwanthyk/ai";
import type { AppMessage, Attachment } from "@yeshwanthyk/agent-core";
import type { ThinkingLevel } from "@yeshwanthyk/agent-core";
import { SessionOrchestratorLayer, SessionOrchestratorTag } from "../src/session/orchestrator.js";
import { PromptQueueLayer } from "../src/session/prompt-queue.js";
import { ExecutionPlanBuilderLayer, type ExecutionPlanBuilderOptions } from "../src/session/execution-plan.js";
import { ConfigTag, type LoadedAppConfig } from "../src/config.js";
import { AgentFactoryTag } from "../src/agent.js";
import { ExtensibilityTag } from "../src/extensibility/index.js";
import { InstrumentationTag, type InstrumentationEvent, type InstrumentationService } from "../src/instrumentation.js";
import { SessionManagerTag } from "../src/session-manager.js";
import { HookEffectsTag, createHookEffects } from "../src/hooks/effects.js";
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
  workspace: { projectRoots: [] },
});

class TestAgent {
  state: {
    systemPrompt: string;
    model: Model<Api>;
    thinkingLevel: ThinkingLevel;
    tools: [];
    messages: AppMessage[];
  };
  prompts: string[] = [];
  modelsUsed: string[] = [];
  thinkingUsed: ThinkingLevel[] = [];
  callCount = 0;
  failuresBeforeSuccess = 0;
  replaceSnapshots: AppMessage[][] = [];
  attachmentsReceived: Attachment[][] = [];
  steerMessages: AppMessage[] = [];
  promptGate: Promise<void> | undefined;

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

  setThinkingLevel(level: ThinkingLevel) {
    this.state.thinkingLevel = level;
    this.thinkingUsed.push(level);
  }

  replaceMessages(messages: AppMessage[]) {
    this.state.messages = messages.slice();
    this.replaceSnapshots.push(messages.slice());
  }

  async prompt(text: string, attachments?: Attachment[]) {
    this.callCount++;
    this.prompts.push(text);
    this.attachmentsReceived.push(attachments ? [...attachments] : []);
    if (this.promptGate) {
      await this.promptGate;
    }
    if (this.callCount <= this.failuresBeforeSuccess) {
      throw new Error("planned failure");
    }
    this.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: `ok:${text}` }],
      timestamp: Date.now(),
    } as AppMessage);
  }

  async steer(message: AppMessage) {
    this.steerMessages.push(message);
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

const waitForSteerCalls = (agent: TestAgent, expected: number) =>
  Effect.async<void>((resume) => {
    const interval = setInterval(() => {
      if (agent.steerMessages.length >= expected) {
        clearInterval(interval);
        clearTimeout(timeout);
        resume(Effect.succeed(undefined));
      }
    }, 5);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      resume(Effect.fail(new Error("timed out waiting for steer calls")));
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
  const hookEffectsLayer = Layer.scoped(
    HookEffectsTag,
    Effect.gen(function* () {
      return yield* createHookEffects(options.hookRunner as unknown as HookRunner);
    }),
  );
  const composed = Layer.mergeAll(
    PromptQueueLayer,
    ExecutionPlanBuilderLayer(options.executionPlanOptions),
    agentFactoryLayer,
    extensibilityLayer,
    sessionManagerLayer,
    hookEffectsLayer,
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
    expect(instrumentation.events.some((ev) => ev.type === "tmux:log" && ev.message === "prompt:process:complete")).toBe(
      true,
    );
  });

  it("exposes each submitted prompt once while processing, then clears it", async () => {
    const agent = new TestAgent(anthropicModel);
    let releaseGate: () => void = () => {};
    agent.promptGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const sessionManager = new TestSessionManager();
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({ agent, sessionManager, hookRunner, instrumentation });

    const result = await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("from ui");
        yield* waitForAgentCalls(agent, 1);
        const during = yield* orchestrator.snapshot;
        yield* Effect.sync(releaseGate);
        yield* Effect.sleep(20);
        const after = yield* orchestrator.snapshot;
        return { during, after };
      }),
    );

    expect(result.during.pending).toEqual([{ text: "from ui", mode: "followUp" }]);
    expect(result.during.counts).toEqual({ followUp: 1, steer: 0 });
    expect(result.after.pending).toEqual([]);
    expect(result.after.counts).toEqual({ followUp: 0, steer: 0 });
  });

  it("delivers steer immediately while a prompt is processing", async () => {
    const agent = new TestAgent(anthropicModel);
    let releaseGate: () => void = () => {};
    agent.promptGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const sessionManager = new TestSessionManager();
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({ agent, sessionManager, hookRunner, instrumentation });

    const result = await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("active turn");
        yield* waitForAgentCalls(agent, 1);

        yield* orchestrator.submitPrompt("interrupt now", { mode: "steer" });
        yield* waitForSteerCalls(agent, 1);
        const during = yield* orchestrator.snapshot;

        yield* Effect.sync(releaseGate);
        yield* Effect.sleep(20);
        const after = yield* orchestrator.snapshot;
        return { during, after };
      }),
    );

    expect(agent.prompts).toEqual(["active turn"]);
    expect(agent.steerMessages).toHaveLength(1);
    expect(agent.steerMessages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "interrupt now" }],
    });
    expect(result.during.pending).toEqual([
      { text: "active turn", mode: "followUp" },
      { text: "interrupt now", mode: "steer" },
    ]);
    expect(result.during.counts).toEqual({ followUp: 1, steer: 1 });
    expect(result.after.pending).toEqual([]);
    expect(result.after.counts).toEqual({ followUp: 0, steer: 0 });
  });

  it("processes steer through the normal loop while idle", async () => {
    const agent = new TestAgent(anthropicModel);
    const sessionManager = new TestSessionManager();
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({ agent, sessionManager, hookRunner, instrumentation });

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("idle steer", { mode: "steer" });
        yield* waitForAgentCalls(agent, 1);
      }),
    );

    expect(agent.prompts).toEqual(["idle steer"]);
    expect(agent.steerMessages).toEqual([]);
  });

  it("continues an existing session manager session without starting a new one", async () => {
    const agent = new TestAgent(anthropicModel);
    const sessionManager = new TestSessionManager();
    sessionManager.sessionIdValue = "restored-session";
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({ agent, sessionManager, hookRunner, instrumentation });

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("continue restored");
        yield* waitForAgentCalls(agent, 1);
      }),
    );

    expect(sessionManager.startCount).toBe(0);
    expect(sessionManager.appended[0]?.role).toBe("user");
  });

  it("starts a new session after the current session identity is cleared", async () => {
    const agent = new TestAgent(anthropicModel);
    const sessionManager = new TestSessionManager();
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({ agent, sessionManager, hookRunner, instrumentation });

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("first");
        yield* waitForAgentCalls(agent, 1);
        sessionManager.sessionIdValue = null;
        yield* orchestrator.submitPrompt("second");
        yield* waitForAgentCalls(agent, 2);
      }),
    );

    expect(sessionManager.startCount).toBe(2);
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

  it("applies per-model thinking levels from execution plans", async () => {
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
          { provider: "anthropic", model: anthropicModel, thinking: "low" },
          { provider: "openai", model: openAiModel, thinking: "high" },
        ],
        attempts: { primary: 1, fallback: 1 },
      },
    });

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("fallback thinking please");
        yield* waitForAgentCalls(agent, 2);
      }),
    );

    expect(agent.modelsUsed).toEqual([anthropicModel.id, openAiModel.id]);
    expect(agent.thinkingUsed).toEqual(["low", "high"]);
  });

  it("awaits prompt completion via submitPromptAndWait", async () => {
    const agent = new TestAgent(anthropicModel);
    const sessionManager = new TestSessionManager();
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({ agent, sessionManager, hookRunner, instrumentation });

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPromptAndWait("blocking call");
      }),
    );

    expect(agent.callCount).toBe(1);
    expect(agent.prompts).toEqual(["blocking call"]);
  });

  it("forwards attachments to the agent", async () => {
    const agent = new TestAgent(anthropicModel);
    const sessionManager = new TestSessionManager();
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({ agent, sessionManager, hookRunner, instrumentation });

    const attachments: Attachment[] = [
      {
        id: "img-1",
        type: "image",
        fileName: "shot.png",
        mimeType: "image/png",
        size: 10,
        content: "data",
      },
    ];

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("need vision", { attachments });
        yield* waitForAgentCalls(agent, 1);
      }),
    );

    expect(agent.attachmentsReceived[0]).toEqual(attachments);
  });

  it("respects provided beforeStartResult without re-running hooks", async () => {
    const agent = new TestAgent(anthropicModel);
    const sessionManager = new TestSessionManager();
    const hookRunner = new TestHookRunner();
    const instrumentation = new TestInstrumentation();
    const layer = createTestLayer({ agent, sessionManager, hookRunner, instrumentation });

    const beforeStartResult = {
      message: {
        customType: "before-start",
        content: "Heads up",
        display: true,
      },
    };

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const orchestrator = yield* SessionOrchestratorTag;
        yield* orchestrator.submitPrompt("preprocessed prompt", { beforeStartResult });
        yield* waitForAgentCalls(agent, 1);
      }),
    );

    expect(hookRunner.beforeStart).toHaveLength(0);
    expect(sessionManager.appended.some((entry) => (entry as any).customType === "before-start")).toBe(true);
  });
});

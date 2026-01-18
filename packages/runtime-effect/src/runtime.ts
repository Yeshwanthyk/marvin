import {
  Agent,
  CodexTransport,
  ProviderTransport,
  RouterTransport,
  type ThinkingLevel,
} from "@marvin-agents/agent-core";
import {
  getModels,
  getProviders,
  type AgentTool,
  type Api,
  type KnownProvider,
  type Model,
} from "@marvin-agents/ai";
import { createToolRegistry, type ToolRegistry } from "@marvin-agents/base-tools";
import {
  createLspManager,
  wrapToolsWithLspDiagnostics,
  type LspManager,
} from "@marvin-agents/lsp";
import { Context, Effect, Layer } from "effect";
import {
	HookRunner,
	HookedTransport,
	getHookTools,
	wrapToolsWithHooks,
	HookContextControllerLayer,
	HookContextControllerTag,
	type HookContextController,
} from "./hooks/index.js";
import { HookEffectsTag, createHookEffects } from "./hooks/effects.js";
import {
  CustomCommandLayer,
  CustomCommandTag,
  type CustomCommand,
} from "./extensibility/custom-commands.js";
import {
  ExtensibilityLayer,
  ExtensibilityTag,
  attachHookErrorLogging,
} from "./extensibility/index.js";
import type { ValidationIssue } from "./extensibility/schema.js";
import type { LoadedCustomTool, SendRef } from "./extensibility/custom-tools/index.js";
import { ConfigTag, loadAppConfig, type LoadConfigOptions, type LoadedAppConfig } from "./config.js";
import { LazyToolLoader } from "./lazy-tool-loader.js";
import {
  PromptQueueLayer,
  PromptQueueTag,
  type PromptQueueService,
} from "./session/prompt-queue.js";
import {
  ExecutionPlanBuilderLayer,
  type PlanModelEntry,
} from "./session/execution-plan.js";
import {
  SessionOrchestratorLayer,
  SessionOrchestratorTag,
  type SessionOrchestratorService,
} from "./session/orchestrator.js";
import {
  SessionManager,
  SessionManagerTag,
  type SessionManagerService,
} from "./session-manager.js";
import {
  AgentFactoryTag,
  type AgentFactoryService,
} from "./agent.js";
import {
  InstrumentationTag,
  NoopInstrumentationLayer,
  type InstrumentationService,
} from "./instrumentation.js";
import {
  TransportLayer,
  TransportTag,
  createApiKeyResolver,
  type ApiKeyResolver,
  type TransportBundle,
} from "./transports.js";
import { LspLayer, LspServiceTag } from "./lsp.js";

export type AdapterKind = "tui" | "headless" | "acp";

export interface ToolRegistryEntry {
  label: string;
  source: "builtin" | "custom";
  sourcePath?: string;
  renderCall?: unknown;
  renderResult?: unknown;
}

export interface RuntimeServices {
  readonly adapter: AdapterKind;
  readonly agent: Agent;
  readonly createAgent: AgentFactoryService["createAgent"];
  readonly sessionManager: SessionManager;
  readonly hookRunner: HookRunner;
  readonly hookContext: HookContextController;
  readonly customCommands: Map<string, CustomCommand>;
  readonly toolByName: Map<string, ToolRegistryEntry>;
  readonly lsp: LspManager;
  readonly lspActiveRef: { setActive: (value: boolean) => void };
  readonly sendRef: SendRef;
  readonly config: LoadedAppConfig;
  readonly cycleModels: Array<{ provider: KnownProvider; model: Model<Api> }>;
  readonly getApiKey: ApiKeyResolver;
  readonly transport: RouterTransport;
  readonly providerTransport: ProviderTransport;
  readonly codexTransport: CodexTransport;
  readonly validationIssues: ValidationIssue[];
  readonly promptQueue: PromptQueueService;
  readonly sessionOrchestrator: SessionOrchestratorService;
}

export const RuntimeServicesTag = Context.GenericTag<RuntimeServices>("runtime-effect/RuntimeServices");

interface ToolRuntimeService {
  readonly loader: LazyToolLoader;
  readonly tools: AgentTool[];
  readonly toolByName: Map<string, ToolRegistryEntry>;
}

const ToolRuntimeTag = Context.GenericTag<ToolRuntimeService>("runtime-effect/ToolRuntimeService");

export interface RuntimeLayerOptions extends LoadConfigOptions {
  readonly adapter?: AdapterKind;
  readonly cwd?: string;
  readonly hasUI?: boolean;
  readonly sendRef?: SendRef;
  readonly instrumentation?: InstrumentationService;
  readonly lspFactory?: typeof createLspManager;
  readonly transportFactory?: (config: LoadedAppConfig, resolver: ApiKeyResolver) => TransportBundle;
}

interface RuntimeLayerInternalOptions extends RuntimeLayerOptions {
  adapter: AdapterKind;
  cwd: string;
  hasUI: boolean;
  sendRef: SendRef;
  instrumentationLayer: Layer.Layer<InstrumentationService, never, never>;
}

export const RuntimeLayer = (options?: RuntimeLayerOptions): Layer.Layer<RuntimeServices, unknown, never> => {
  const adapter = options?.adapter ?? "tui";
  const cwd = options?.cwd ?? process.cwd();
  const hasUI = options?.hasUI ?? adapter === "tui";
  const sendRef = options?.sendRef ?? { current: () => {} };
  const instrumentationLayer =
    options?.instrumentation !== undefined
      ? Layer.succeed(InstrumentationTag, options.instrumentation)
      : NoopInstrumentationLayer;

  const layerOptions: RuntimeLayerInternalOptions = {
    ...options,
    adapter,
    cwd,
    hasUI,
    sendRef,
    instrumentationLayer,
  };

  const layerEffect: Effect.Effect<Layer.Layer<RuntimeServices, unknown, never>, unknown, never> =
    Effect.gen(function* () {
      const config = yield* Effect.tryPromise(() => loadAppConfig(layerOptions));
      const apiKeyResolver = createApiKeyResolver(config.configDir);
      const cycleModels = buildCycleModels(layerOptions.model, config);

      const configLayer = Layer.succeed(ConfigTag, { config });
      const sessionManagerLayer = Layer.succeed(SessionManagerTag, {
        sessionManager: new SessionManager(config.configDir),
      } satisfies SessionManagerService);
      const transportLayer =
        layerOptions.transportFactory
          ? Layer.succeed(TransportTag, {
              transport: layerOptions.transportFactory(config, apiKeyResolver),
            })
          : TransportLayer(config, apiKeyResolver);
      const customCommandsLayer = CustomCommandLayer({ configDir: config.configDir });
      const executionPlanLayer = ExecutionPlanBuilderLayer({
        cycle: cycleModels.map((entry) => ({ provider: entry.provider, model: entry.model }) satisfies PlanModelEntry),
      });
      const toolRegistry = createToolRegistry(layerOptions.cwd);
      const extensibilityLayer = ExtensibilityLayer({
        cwd: layerOptions.cwd,
        sendRef: layerOptions.sendRef,
        builtinToolNames: Object.keys(toolRegistry),
        hasUI: layerOptions.hasUI,
      });
      const hookContextLayer = HookContextControllerLayer;
      const hookEffectsLayer = createHookEffectsLayer();
      const promptQueueLayer = PromptQueueLayer;
      const lspLayer = LspLayer({
        cwd: layerOptions.cwd,
        ...(layerOptions.lspFactory ? { lspFactory: layerOptions.lspFactory } : {}),
      });
      const toolRuntimeLayer = createToolRuntimeLayer({
        cwd: layerOptions.cwd,
        toolRegistry,
      });
      const agentFactoryLayer = createAgentFactoryLayer();
      const runtimeServicesLayer = createRuntimeServicesLayer({
        adapter: layerOptions.adapter,
        sendRef: layerOptions.sendRef,
        apiKeyResolver,
        cycleModels,
      });

      const baseProviders = Layer.merge(configLayer, layerOptions.instrumentationLayer);
      const withSessionManager = Layer.provideMerge(sessionManagerLayer, baseProviders);
      const withTransport = Layer.provideMerge(transportLayer, withSessionManager);
      const withCommands = Layer.provideMerge(customCommandsLayer, withTransport);
      const withExecutionPlan = Layer.provideMerge(executionPlanLayer, withCommands);
      const withPromptQueue = Layer.provideMerge(promptQueueLayer, withExecutionPlan);
      const withExtensibility = Layer.provideMerge(extensibilityLayer, withPromptQueue);
      const withHookContext = Layer.provideMerge(hookContextLayer, withExtensibility);
      const withHookEffects = Layer.provideMerge(hookEffectsLayer, withHookContext);
      const withLsp = Layer.provideMerge(lspLayer, withHookEffects);
      const withToolRuntime = Layer.provideMerge(toolRuntimeLayer, withLsp);
      const withAgentFactory = Layer.provideMerge(agentFactoryLayer, withToolRuntime);
      const withOrchestrator = Layer.provideMerge(SessionOrchestratorLayer(), withAgentFactory);
      return Layer.provide(runtimeServicesLayer, withOrchestrator);
    });

  return Layer.unwrapEffect(layerEffect);
};

const createToolRuntimeLayer = (options: { cwd: string; toolRegistry: ToolRegistry }) =>
  Layer.effect(
    ToolRuntimeTag,
    Effect.gen(function* () {
      const { hookRunner, customTools } = yield* ExtensibilityTag;
      const lspService = yield* LspServiceTag;

      const loader = new LazyToolLoader(
        options.toolRegistry,
        customTools.map((entry) => entry.tool),
        getHookTools(hookRunner),
      );
      yield* Effect.promise(() => loader.preloadCoreTools());

      const tools = wrapToolsWithLspDiagnostics(
        wrapToolsWithHooks(loader.getToolsProxy().toArray(), hookRunner),
        lspService.manager,
        {
          cwd: options.cwd,
          onCheckStart: () => lspService.notifyActivity(true),
          onCheckEnd: () => lspService.notifyActivity(false),
        },
      );

      return {
        loader,
        tools,
        toolByName: buildToolRegistry(options.toolRegistry, customTools),
      } satisfies ToolRuntimeService;
    }),
  );

const createHookEffectsLayer = () =>
  Layer.scoped(
    HookEffectsTag,
    Effect.gen(function* () {
      const { hookRunner } = yield* ExtensibilityTag;
      return yield* createHookEffects(hookRunner);
    }),
  );

const createAgentFactoryLayer = () =>
  Layer.effect(
    AgentFactoryTag,
    Effect.gen(function* () {
      const { config } = yield* ConfigTag;
      const { transport } = yield* TransportTag;
      const { hookRunner } = yield* ExtensibilityTag;
      const { tools } = yield* ToolRuntimeTag;

      const hookedTransport = new HookedTransport(transport.router, hookRunner);

      const makeAgent = (options?: { model?: Model<Api>; thinking?: ThinkingLevel }) =>
        new Agent({
          transport: hookedTransport,
          initialState: {
            systemPrompt: config.systemPrompt,
            model: options?.model ?? config.model,
            thinkingLevel: options?.thinking ?? config.thinking,
            tools,
          },
        });

      return {
        bootstrapAgent: makeAgent(),
        createAgent: makeAgent,
        transport: hookedTransport,
        tools,
      } satisfies AgentFactoryService;
    }),
  );

const createRuntimeServicesLayer = (options: {
  adapter: AdapterKind;
  sendRef: SendRef;
  apiKeyResolver: ApiKeyResolver;
  cycleModels: Array<{ provider: KnownProvider; model: Model<Api> }>;
}) =>
  Layer.effect(
    RuntimeServicesTag,
    Effect.gen(function* () {
      const { config } = yield* ConfigTag;
      const { sessionManager } = yield* SessionManagerTag;
      const { hookRunner, validationIssues: extensibilityIssues } = yield* ExtensibilityTag;
      const { commands, issues: commandIssues } = yield* CustomCommandTag;
      const toolRuntime = yield* ToolRuntimeTag;
      const { transport } = yield* TransportTag;
      const promptQueue = yield* PromptQueueTag;
      const sessionOrchestrator = yield* SessionOrchestratorTag;
      const agentFactory = yield* AgentFactoryTag;
      const hookContext = yield* HookContextControllerTag;
      const lspService = yield* LspServiceTag;

      attachHookErrorLogging(hookRunner, (message) => process.stderr.write(`${message}\n`));
      yield* Effect.promise(() => hookRunner.emit({ type: "app.start" }));

      const validationIssues = [...commandIssues, ...extensibilityIssues];
      for (const issue of validationIssues) {
        if (issue.severity === "error") {
          process.stderr.write(`[${issue.kind}] ${issue.path}: ${issue.message}\n`);
        }
      }

      return {
        adapter: options.adapter,
        agent: agentFactory.bootstrapAgent,
        createAgent: agentFactory.createAgent,
        sessionManager,
        hookRunner,
        hookContext,
        customCommands: commands,
        toolByName: toolRuntime.toolByName,
        lsp: lspService.manager,
        lspActiveRef: lspService.activityRef,
        sendRef: options.sendRef,
        config,
        cycleModels: options.cycleModels,
        getApiKey: options.apiKeyResolver,
        transport: transport.router,
        providerTransport: transport.provider,
        codexTransport: transport.codex,
        validationIssues,
        promptQueue,
        sessionOrchestrator,
      } satisfies RuntimeServices;
    }),
  );

const buildToolRegistry = (
  toolRegistry: ToolRegistry,
  customTools: LoadedCustomTool[],
): Map<string, ToolRegistryEntry> => {
  const registry = new Map<string, ToolRegistryEntry>();

  for (const [name, def] of Object.entries(toolRegistry)) {
    registry.set(name, { label: def.label, source: "builtin" });
  }

  for (const entry of customTools) {
    registry.set(entry.tool.name, {
      label: entry.tool.label,
      source: "custom",
      sourcePath: entry.resolvedPath,
      renderCall: entry.tool.renderCall,
      renderResult: entry.tool.renderResult,
    });
  }

  return registry;
};

const buildCycleModels = (
  modelSpec: string | undefined,
  loaded: LoadedAppConfig,
): Array<{ provider: KnownProvider; model: Model<Api> }> => {
  const entries: Array<{ provider: KnownProvider; model: Model<Api> }> = [];
  const requested = modelSpec?.split(",").map((value) => value.trim()).filter(Boolean) ?? [loaded.modelId];

  for (const id of requested) {
    if (id.includes("/")) {
      const [providerId, modelId] = id.split("/");
      const provider = getKnownProvider(providerId);
      if (!provider) continue;
      const model = findModel(provider, modelId);
      if (model) entries.push({ provider, model });
      continue;
    }

    let resolved = false;
    for (const provider of getProviders()) {
      const known = getKnownProvider(provider);
      if (!known) continue;
      const model = findModel(known, id);
      if (model) {
        entries.push({ provider: known, model });
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      const fallbackModel = findModel(loaded.provider, id);
      if (fallbackModel) {
        entries.push({ provider: loaded.provider, model: fallbackModel });
      }
    }
  }

  if (entries.length === 0) {
    entries.push({ provider: loaded.provider, model: loaded.model });
  }

  return entries;
};

const findModel = (provider: KnownProvider, modelId: string): Model<Api> | undefined => {
  const models = getModels(provider);
  return models.find((model) => model.id === modelId) as Model<Api> | undefined;
};

const getKnownProvider = (value: string): KnownProvider | undefined => {
  return getProviders().find((provider) => provider === value) as KnownProvider | undefined;
};

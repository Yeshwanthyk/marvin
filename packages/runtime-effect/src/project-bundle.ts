import { Agent, type ThinkingLevel } from "@yeshwanthyk/agent-core";
import {
  getModels,
  getProviders,
  resolveProviderAlias,
  type AgentTool,
  type Api,
  type KnownProvider,
  type Model,
} from "@yeshwanthyk/ai";
import { createToolRegistry, type ToolRegistry } from "@yeshwanthyk/base-tools";
import { Context, Duration, Effect, Exit, Layer, Schedule, Scope } from "effect";
import {
  HookRunner,
  HookedTransport,
  getHookTools,
  loadHooks,
  wrapToolsWithHooks,
  HookContextControllerLayer,
  HookContextControllerTag,
  type HookContextController,
  type HookSessionContext,
  type HookUIContext,
} from "./hooks/index.js";
import { HookEffectsTag, createHookEffects } from "./hooks/effects.js";
import {
  CustomCommandTag,
  loadCustomCommands,
  type CustomCommand,
} from "./extensibility/custom-commands.js";
import {
  ExtensibilityTag,
  attachHookErrorLogging,
  type ExtensibilityService,
} from "./extensibility/index.js";
import type { ValidationIssue } from "./extensibility/schema.js";
import {
  loadCustomTools,
  type LoadedCustomTool,
  type SendRef,
} from "./extensibility/custom-tools/index.js";
import {
  ConfigTag,
  loadAppConfig,
  parseThinkingLevels,
  type LoadConfigOptions,
  type LoadedAppConfig,
} from "./config.js";
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
  TransportTag,
  createApiKeyResolver,
  createTransportBundle,
  type ApiKeyResolver,
  type TransportBundle,
} from "./transports.js";
import type { JsonlOwnershipIndex, LaneId } from "./session/jsonl-ownership.js";

export type AdapterKind = "tui" | "headless" | "acp";
export type ProjectId = string;

export interface ToolRegistryEntry {
  label: string;
  source: "builtin" | "custom";
  sourcePath?: string;
  renderCall?: unknown;
  renderResult?: unknown;
}

export interface SessionActorDescriptor {
  readonly laneId: LaneId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly sessionId: string | null;
  readonly sessionPath: string | null;
  readonly initialTitle?: string;
}

export interface LoadedHookDefinitions {
  readonly paths: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<ValidationIssue>;
}

export interface ActorUiPolicy {
  readonly adapter?: AdapterKind;
  readonly hasUI?: boolean;
  readonly sendRef?: SendRef;
  readonly hookUIContext?: HookUIContext;
  readonly hookSessionContext?: HookSessionContext;
  readonly notify?: (title: string, message: string, variant?: "info" | "warning" | "success" | "error") => void;
}

export interface ActorRuntimeOptions {
  readonly retry?: {
    readonly primary?: number;
    readonly fallback?: number;
    readonly initialDelayMs?: number;
  };
  readonly timeout?: number;
}

export interface ProjectRuntimeBundleOptions extends LoadConfigOptions, ActorRuntimeOptions {
  readonly projectId?: ProjectId;
  readonly cwd?: string;
  readonly hasUI?: boolean;
  readonly sendRef?: SendRef;
  readonly instrumentation?: InstrumentationService;
  readonly transportFactory?: (config: LoadedAppConfig, resolver: ApiKeyResolver) => TransportBundle;
  readonly jsonlOwnership?: JsonlOwnershipIndex;
}

export interface SessionActorServices {
  readonly agent: Agent;
  readonly createAgent: AgentFactoryService["createAgent"];
  readonly sessionManager: SessionManager;
  readonly promptQueue: PromptQueueService;
  readonly sessionOrchestrator: SessionOrchestratorService;
  readonly hookRunner: HookRunner;
  readonly hookContext: HookContextController;
  readonly hookedTransport: HookedTransport;
  readonly tools: AgentTool[];
}

export interface ScopedSessionActorServices extends SessionActorServices {
  readonly close: () => Promise<void>;
}

export interface ProjectRuntimeBundle {
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly config: LoadedAppConfig;
  readonly cycleModels: ReadonlyArray<{ provider: KnownProvider; model: Model<Api>; thinking?: ThinkingLevel }>;
  readonly getApiKey: ApiKeyResolver;
  readonly transports: TransportBundle;
  readonly customCommands: Map<string, CustomCommand>;
  readonly customTools: ReadonlyArray<LoadedCustomTool>;
  readonly toolRegistry: ToolRegistry;
  readonly toolByName: Map<string, ToolRegistryEntry>;
  readonly hookDefinitions: LoadedHookDefinitions;
  readonly validationIssues: ReadonlyArray<ValidationIssue>;
  createActorServices(descriptor: SessionActorDescriptor, ui?: ActorUiPolicy): Promise<ScopedSessionActorServices>;
  close(): Promise<void>;
}

interface ToolRuntimeService {
  readonly loader: LazyToolLoader;
  readonly tools: AgentTool[];
  readonly toolByName: Map<string, ToolRegistryEntry>;
}

const ToolRuntimeTag = Context.GenericTag<ToolRuntimeService>("runtime-effect/ToolRuntimeService");
const HookedTransportTag = Context.GenericTag<HookedTransport>("runtime-effect/HookedTransport");

export const createProjectRuntimeBundle = async (
  options: ProjectRuntimeBundleOptions = {},
): Promise<ProjectRuntimeBundle> => {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadAppConfig({ ...options, cwd });
  const apiKeyResolver = createApiKeyResolver(config.configDir);
  const transports = options.transportFactory
    ? options.transportFactory(config, apiKeyResolver)
    : createTransportBundle(config, apiKeyResolver);
  const cycleModels = buildCycleModels(options.model, options.thinking, config);
  const toolRegistry = createToolRegistry(cwd);
  const commandsResult = loadCustomCommands(config.configDir);
  const sendRef = options.sendRef ?? { current: () => {} };
  const hasUI = options.hasUI ?? false;
  const hookDefinitionsResult = await loadHooks(config.configDir, {
    cwd,
    extensionPaths: options.extensions ?? config.extensions,
    extensionsEnabled: options.noExtensions ? false : config.extensionsEnabled,
  });
  const customToolsResult = await loadCustomTools(
    config.configDir,
    cwd,
    Object.keys(toolRegistry),
    sendRef,
    hasUI,
  );
  const validationIssues = [
    ...commandsResult.issues,
    ...hookDefinitionsResult.issues,
    ...customToolsResult.issues,
  ];
  const instrumentationLayer =
    options.instrumentation !== undefined
      ? Layer.succeed(InstrumentationTag, options.instrumentation)
      : NoopInstrumentationLayer;

  const bundle: ProjectRuntimeBundle = {
    projectId: options.projectId ?? cwd,
    cwd,
    config,
    cycleModels,
    getApiKey: apiKeyResolver,
    transports,
    customCommands: commandsResult.commands,
    customTools: customToolsResult.tools,
    toolRegistry,
    toolByName: buildToolRegistry(toolRegistry, customToolsResult.tools),
    hookDefinitions: {
      paths: hookDefinitionsResult.hooks.map((hook) => hook.path),
      issues: hookDefinitionsResult.issues,
    },
    validationIssues,
    createActorServices: (descriptor, ui) => {
      const actorUi = {
        adapter: ui?.adapter ?? "headless",
        hasUI: ui?.hasUI ?? hasUI,
        sendRef: ui?.sendRef ?? sendRef,
        ...(ui?.hookUIContext !== undefined ? { hookUIContext: ui.hookUIContext } : {}),
        ...(ui?.hookSessionContext !== undefined ? { hookSessionContext: ui.hookSessionContext } : {}),
        ...(ui?.notify !== undefined ? { notify: ui.notify } : {}),
      } satisfies CreateActorServicesOptions["ui"];
      const createOptions = {
        bundle,
        descriptor,
        ui: actorUi,
        instrumentationLayer,
        runtimeOptions: options,
        ...(options.jsonlOwnership !== undefined ? { ownership: options.jsonlOwnership } : {}),
      } satisfies CreateActorServicesOptions;
      return createActorServices(createOptions);
    },
    close: async () => {},
  };

  return bundle;
};

interface CreateActorServicesOptions {
  readonly bundle: ProjectRuntimeBundle;
  readonly descriptor: SessionActorDescriptor;
  readonly ui: ActorUiPolicy & { readonly adapter: AdapterKind; readonly hasUI: boolean; readonly sendRef: SendRef };
  readonly instrumentationLayer: Layer.Layer<InstrumentationService, never, never>;
  readonly ownership?: JsonlOwnershipIndex;
  readonly runtimeOptions: ActorRuntimeOptions;
}

const createActorServices = async (
  options: CreateActorServicesOptions,
): Promise<ScopedSessionActorServices> => {
  const scope = await Effect.runPromise(Scope.make());
  const sessionManager = new SessionManager(
    options.bundle.config.configDir,
    options.descriptor.cwd,
    options.ownership === undefined
      ? undefined
      : { laneId: options.descriptor.laneId, index: options.ownership },
  );

  if (options.descriptor.sessionPath !== null && options.descriptor.sessionId !== null) {
    sessionManager.continueSession(options.descriptor.sessionPath, options.descriptor.sessionId);
  }

  const layer = buildActorLayer({
    ...options,
    sessionManager,
  });
  const context = await Effect.runPromise(Layer.buildWithScope(layer, scope));
  const services = Context.get(context, SessionActorServicesTag);

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const ownedPath = sessionManager.sessionPath;
    await Effect.runPromise(Scope.close(scope, Exit.void));
    if (ownedPath !== null && options.ownership !== undefined) {
      options.ownership.release(ownedPath, options.descriptor.laneId);
    }
  };

  return {
    ...services,
    close,
  };
};

const SessionActorServicesTag = Context.GenericTag<SessionActorServices>("runtime-effect/SessionActorServices");

const buildActorLayer = (
  options: CreateActorServicesOptions & { readonly sessionManager: SessionManager },
) => {
  const configLayer = Layer.succeed(ConfigTag, { config: options.bundle.config });
  const sessionManagerLayer = Layer.succeed(SessionManagerTag, {
    sessionManager: options.sessionManager,
  } satisfies SessionManagerService);
  const transportLayer = Layer.succeed(TransportTag, {
    transport: options.bundle.transports,
  });
  const commandsLayer = Layer.succeed(CustomCommandTag, {
    commands: options.bundle.customCommands,
    issues: [],
  });
  const executionPlanLayer = ExecutionPlanBuilderLayer({
    cycle: options.bundle.cycleModels.map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      ...(entry.thinking !== undefined ? { thinking: entry.thinking } : {}),
    }) satisfies PlanModelEntry),
    ...buildRetryOptions(options.runtimeOptions.retry),
  });
  const promptQueueLayer = PromptQueueLayer;
  const extensibilityLayer = createActorExtensibilityLayer(options);
  const hookContextLayer = HookContextControllerLayer;
  const hookEffectsLayer = createHookEffectsLayer();
  const toolRuntimeLayer = createToolRuntimeLayer({
    toolRegistry: options.bundle.toolRegistry,
  });
  const hookedTransportLayer = createHookedTransportLayer();
  const agentFactoryLayer = createAgentFactoryLayer();
  const actorServicesLayer = createSessionActorServicesLayer(options);

  const baseProviders = Layer.merge(configLayer, options.instrumentationLayer);
  const withSessionManager = Layer.provideMerge(sessionManagerLayer, baseProviders);
  const withTransport = Layer.provideMerge(transportLayer, withSessionManager);
  const withCommands = Layer.provideMerge(commandsLayer, withTransport);
  const withExecutionPlan = Layer.provideMerge(executionPlanLayer, withCommands);
  const withPromptQueue = Layer.provideMerge(promptQueueLayer, withExecutionPlan);
  const withExtensibility = Layer.provideMerge(extensibilityLayer, withPromptQueue);
  const withHookContext = Layer.provideMerge(hookContextLayer, withExtensibility);
  const withHookEffects = Layer.provideMerge(hookEffectsLayer, withHookContext);
  const withToolRuntime = Layer.provideMerge(toolRuntimeLayer, withHookEffects);
  const withHookedTransport = Layer.provideMerge(hookedTransportLayer, withToolRuntime);
  const withAgentFactory = Layer.provideMerge(agentFactoryLayer, withHookedTransport);
  const withOrchestrator = Layer.provideMerge(
    SessionOrchestratorLayer(
      options.runtimeOptions.timeout !== undefined ? { timeout: options.runtimeOptions.timeout } : undefined,
    ),
    withAgentFactory,
  );

  return Layer.provide(actorServicesLayer, withOrchestrator);
};

const createActorExtensibilityLayer = (options: CreateActorServicesOptions) =>
  Layer.effect(
    ExtensibilityTag,
    Effect.gen(function* () {
      const { sessionManager } = yield* SessionManagerTag;
      const instrumentation = yield* InstrumentationTag;
      const hookResult = yield* Effect.tryPromise(() =>
        loadHooks(options.bundle.config.configDir, {
          cwd: options.descriptor.cwd,
          extensionPaths: options.bundle.config.extensions,
          extensionsEnabled: options.bundle.config.extensionsEnabled,
        }),
      );
      const hookRunner = new HookRunner(
        hookResult.hooks,
        options.descriptor.cwd,
        options.bundle.config.configDir,
        sessionManager,
      );
      const service: ExtensibilityService = {
        hookRunner,
        customTools: [...options.bundle.customTools],
        validationIssues: hookResult.issues,
        hookCount: hookResult.hooks.length,
      };

      hookRunner.onError((err) => {
        const errorValue = err.error;
        const errorMessage = String(errorValue);
        instrumentation.record({
          type: "hook:error",
          hookPath: err.hookPath,
          event: err.event,
          error: errorMessage,
        });
      });

      instrumentation.record({
        type: "extensibility:loaded",
        hooks: service.hookCount,
        customTools: service.customTools.length,
        customCommands: options.bundle.customCommands.size,
      });

      return service;
    }),
  );

const createToolRuntimeLayer = (options: { readonly toolRegistry: ToolRegistry }) =>
  Layer.effect(
    ToolRuntimeTag,
    Effect.gen(function* () {
      const { hookRunner, customTools } = yield* ExtensibilityTag;
      const loader = new LazyToolLoader(
        options.toolRegistry,
        customTools.map((entry) => entry.tool),
        getHookTools(hookRunner),
      );
      yield* Effect.promise(() => loader.preloadCoreTools());
      const tools = wrapToolsWithHooks(loader.getToolsProxy().toArray(), hookRunner);
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

const createHookedTransportLayer = () =>
  Layer.effect(
    HookedTransportTag,
    Effect.gen(function* () {
      const { transport } = yield* TransportTag;
      const { hookRunner } = yield* ExtensibilityTag;
      return new HookedTransport(transport.router, hookRunner);
    }),
  );

const createAgentFactoryLayer = () =>
  Layer.effect(
    AgentFactoryTag,
    Effect.gen(function* () {
      const { config } = yield* ConfigTag;
      const { tools } = yield* ToolRuntimeTag;
      const hookedTransport = yield* HookedTransportTag;

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

const createSessionActorServicesLayer = (options: CreateActorServicesOptions) =>
  Layer.effect(
    SessionActorServicesTag,
    Effect.gen(function* () {
      const { sessionManager } = yield* SessionManagerTag;
      const { hookRunner } = yield* ExtensibilityTag;
      const toolRuntime = yield* ToolRuntimeTag;
      const promptQueue = yield* PromptQueueTag;
      const sessionOrchestrator = yield* SessionOrchestratorTag;
      const agentFactory = yield* AgentFactoryTag;
      const hookContext = yield* HookContextControllerTag;
      const hookedTransport = yield* HookedTransportTag;

      attachHookErrorLogging(hookRunner, (message) => process.stderr.write(`${message}\n`));
      const notify = (message: string, variant: "info" | "warning" | "success" | "error" = "warning") =>
        options.ui.notify?.("Hook needs focus", message, variant);
      hookRunner.initialize({
        sendHandler: (text) => notify(`Hook tried to send while lane ${options.descriptor.laneId} was unfocused: ${text.slice(0, 80)}`),
        sendMessageHandler: (message) => {
          if (message.display) notify(`Hook message available in ${options.descriptor.cwd}`, "info");
        },
        sendUserMessageHandler: async (text) => notify(`Hook tried to enqueue while unfocused: ${text.slice(0, 80)}`),
        steerHandler: async (text) => notify(`Hook tried to steer while unfocused: ${text.slice(0, 80)}`),
        followUpHandler: async (text) => notify(`Hook tried to follow up while unfocused: ${text.slice(0, 80)}`),
        isIdleHandler: () => !agentFactory.bootstrapAgent.state.isStreaming,
        appendEntryHandler: (customType, data) => sessionManager.appendEntry(customType, data),
        getSessionId: () => sessionManager.sessionId,
        getModel: () => agentFactory.bootstrapAgent.state.model ?? null,
        ...(options.ui.hookUIContext !== undefined ? { uiContext: options.ui.hookUIContext } : {}),
        ...(options.ui.hookSessionContext !== undefined ? { sessionContext: options.ui.hookSessionContext } : {}),
        hasUI: options.ui.hasUI,
      });
      yield* Effect.promise(() => hookRunner.emit({ type: "app.start" }));

      return {
        agent: agentFactory.bootstrapAgent,
        createAgent: agentFactory.createAgent,
        sessionManager,
        promptQueue,
        sessionOrchestrator,
        hookRunner,
        hookContext,
        hookedTransport,
        tools: toolRuntime.tools,
      } satisfies SessionActorServices;
    }),
  );

const buildRetryOptions = (retry: ActorRuntimeOptions["retry"]) => {
  if (retry === undefined) return {};
  const attempts: { primary?: number; fallback?: number } = {};
  if (retry.primary !== undefined) attempts.primary = retry.primary;
  if (retry.fallback !== undefined) attempts.fallback = retry.fallback;
  return {
    attempts,
    ...(retry.initialDelayMs !== undefined
      ? { schedule: Schedule.exponential(Duration.millis(retry.initialDelayMs), 2) }
      : {}),
  };
};

export const buildToolRegistry = (
  toolRegistry: ToolRegistry,
  customTools: ReadonlyArray<LoadedCustomTool>,
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

export const buildCycleModels = (
  modelSpec: string | undefined,
  thinkingSpec: ThinkingLevel | string | undefined,
  loaded: LoadedAppConfig,
): Array<{ provider: KnownProvider; model: Model<Api>; thinking?: ThinkingLevel }> => {
  const entries: Array<{ provider: KnownProvider; model: Model<Api>; thinking?: ThinkingLevel }> = [];
  const requested = modelSpec?.split(",").map((value) => value.trim()).filter(Boolean) ?? [loaded.modelId];
  const requestedThinking = parseThinkingLevels(thinkingSpec);
  const thinkingFor = (index: number): ThinkingLevel | undefined => {
    if (requestedThinking.length === 0) return undefined;
    return requestedThinking[index] ?? requestedThinking[requestedThinking.length - 1];
  };
  const addEntry = (provider: KnownProvider, model: Model<Api>) => {
    const thinking = thinkingFor(entries.length);
    entries.push({
      provider,
      model,
      ...(thinking !== undefined ? { thinking } : {}),
    });
  };

  for (const id of requested) {
    const slashIndex = id.indexOf("/");
    if (slashIndex > -1) {
      const provider = getKnownProvider(id.slice(0, slashIndex));
      const model = provider ? findModel(provider, id.slice(slashIndex + 1)) : undefined;
      if (provider && model) addEntry(provider, model);
      continue;
    }

    const loadedProviderModel = findModel(loaded.provider, id);
    if (loadedProviderModel) {
      addEntry(loaded.provider, loadedProviderModel);
      continue;
    }

    for (const providerValue of getProviders()) {
      const provider = getKnownProvider(providerValue);
      const model = provider ? findModel(provider, id) : undefined;
      if (provider && model) {
        addEntry(provider, model);
        break;
      }
    }
  }

  if (entries.length === 0) {
    const thinking = thinkingFor(0);
    entries.push({
      provider: loaded.provider,
      model: loaded.model,
      ...(thinking !== undefined ? { thinking } : {}),
    });
  }

  return entries;
};

const findModel = (provider: KnownProvider, modelId: string): Model<Api> | undefined =>
  getModels(provider).find((model) => model.id === modelId);

const getKnownProvider = (value: string): KnownProvider | undefined => {
  const resolved = resolveProviderAlias(value);
  return getProviders().find((provider) => provider === resolved);
};

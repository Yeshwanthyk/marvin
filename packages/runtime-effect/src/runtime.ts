import type {
  Agent,
  CodexTransport,
  ProviderTransport,
  RouterTransport,
  ThinkingLevel,
} from "@yeshwanthyk/agent-core";
import type { Api, KnownProvider, Model } from "@yeshwanthyk/ai";
import { Context, Effect, Layer } from "effect";
import type { HookRunner, HookContextController } from "./hooks/index.js";
import type { CustomCommand } from "./extensibility/custom-commands.js";
import type { ValidationIssue } from "./extensibility/schema.js";
import type { SendRef } from "./extensibility/custom-tools/index.js";
import type { LoadConfigOptions, LoadedAppConfig } from "./config.js";
import type { PromptQueueService } from "./session/prompt-queue.js";
import type { SessionOrchestratorService } from "./session/orchestrator.js";
import type { SessionManager } from "./session-manager.js";
import type { AgentFactoryService } from "./agent.js";
import type { InstrumentationService } from "./instrumentation.js";
import type { ApiKeyResolver, TransportBundle } from "./transports.js";
import {
  createProjectRuntimeBundle,
  type AdapterKind,
  type ProjectRuntimeBundleOptions,
  type ToolRegistryEntry,
} from "./project-bundle.js";

export type { AdapterKind, ToolRegistryEntry } from "./project-bundle.js";

export interface RuntimeServices {
  readonly adapter: AdapterKind;
  readonly agent: Agent;
  readonly createAgent: AgentFactoryService["createAgent"];
  readonly sessionManager: SessionManager;
  readonly hookRunner: HookRunner;
  readonly hookContext: HookContextController;
  readonly customCommands: Map<string, CustomCommand>;
  readonly toolByName: Map<string, ToolRegistryEntry>;
  readonly sendRef: SendRef;
  readonly config: LoadedAppConfig;
  readonly cycleModels: Array<{ provider: KnownProvider; model: Model<Api>; thinking?: ThinkingLevel }>;
  readonly getApiKey: ApiKeyResolver;
  readonly transport: RouterTransport;
  readonly providerTransport: ProviderTransport;
  readonly codexTransport: CodexTransport;
  readonly validationIssues: ValidationIssue[];
  readonly promptQueue: PromptQueueService;
  readonly sessionOrchestrator: SessionOrchestratorService;
}

export const RuntimeServicesTag = Context.GenericTag<RuntimeServices>("runtime-effect/RuntimeServices");

export interface RuntimeLayerOptions extends LoadConfigOptions {
  readonly adapter?: AdapterKind;
  readonly cwd?: string;
  readonly hasUI?: boolean;
  readonly sendRef?: SendRef;
  readonly instrumentation?: InstrumentationService;
  readonly transportFactory?: (config: LoadedAppConfig, resolver: ApiKeyResolver) => TransportBundle;
  readonly retry?: {
    readonly primary?: number;
    readonly fallback?: number;
    readonly initialDelayMs?: number;
  };
  readonly timeout?: number;
}

export const RuntimeLayer = (options?: RuntimeLayerOptions): Layer.Layer<RuntimeServices, unknown, never> => {
  const adapter = options?.adapter ?? "tui";
  const cwd = options?.cwd ?? process.cwd();
  const hasUI = options?.hasUI ?? adapter === "tui";
  const sendRef = options?.sendRef ?? { current: () => {} };

  return Layer.scoped(
    RuntimeServicesTag,
    Effect.gen(function* () {
      const bundleOptions: ProjectRuntimeBundleOptions = {
        ...options,
        cwd,
        hasUI,
        sendRef,
      };
      const bundle = yield* Effect.tryPromise(() => createProjectRuntimeBundle(bundleOptions));
      const actor = yield* Effect.tryPromise(() =>
        bundle.createActorServices(
          {
            laneId: "runtime-default",
            projectId: bundle.projectId,
            cwd,
            sessionId: null,
            sessionPath: null,
          },
          { adapter, hasUI, sendRef },
        ),
      );

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await actor.close();
          await bundle.close();
        }),
      );

      return {
        adapter,
        agent: actor.agent,
        createAgent: actor.createAgent,
        sessionManager: actor.sessionManager,
        hookRunner: actor.hookRunner,
        hookContext: actor.hookContext,
        customCommands: bundle.customCommands,
        toolByName: bundle.toolByName,
        sendRef,
        config: bundle.config,
        cycleModels: [...bundle.cycleModels],
        getApiKey: bundle.getApiKey,
        transport: bundle.transports.router,
        providerTransport: bundle.transports.provider,
        codexTransport: bundle.transports.codex,
        validationIssues: [...bundle.validationIssues],
        promptQueue: actor.promptQueue,
        sessionOrchestrator: actor.sessionOrchestrator,
      } satisfies RuntimeServices;
    }),
  );
};

import { Agent, type AgentTransport, type ThinkingLevel } from "@marvin-agents/agent-core"
import { getModels, getProviders, type AgentTool, type Api, type KnownProvider, type Model } from "@marvin-agents/ai"
import { codingTools } from "@marvin-agents/base-tools"
import { createLspManager, wrapToolsWithLspDiagnostics, type LspManager } from "@marvin-agents/lsp"
import { loadAppConfig, type LoadedAppConfig } from "../config.js"
import { loadCustomCommands, type CustomCommand, type CustomCommandLoadResult } from "../custom-commands.js"
import { wrapToolsWithHooks, getHookTools, HookedTransport, type HookRunner } from "../hooks/index.js"
import { SessionManager } from "../session-manager.js"
import { loadExtensibility, attachHookErrorLogging } from "./extensibility/index.js"
import {
	createTransportBundle,
	defaultApiKeyResolver,
	type TransportBundle,
} from "./transport/index.js"
import type { LoadedCustomTool, SendRef } from "../custom-tools/index.js"
import type { ValidationIssue } from "@ext/schema.js"

export type AdapterKind = "tui" | "headless" | "acp"

export interface RuntimeInitArgs {
	configDir?: string
	configPath?: string
	provider?: string
	model?: string
	thinking?: ThinkingLevel
}

export interface RuntimeContext {
	adapter: AdapterKind
	agent: Agent
	createAgent: (options?: { model?: Model<Api>; thinking?: ThinkingLevel }) => Agent
	sessionManager: SessionManager
	hookRunner: HookRunner
	customCommands: Map<string, CustomCommand>
	toolByName: Map<string, ToolRegistryEntry>
	lsp: LspManager
	lspActiveRef: { setActive: (value: boolean) => void }
	sendRef: SendRef
	config: LoadedAppConfig
	cycleModels: Array<{ provider: KnownProvider; model: Model<Api> }>
	getApiKey: (provider: string) => string | undefined
	transport: TransportBundle["router"]
	providerTransport: TransportBundle["provider"]
	codexTransport: TransportBundle["codex"]
	validationIssues: ValidationIssue[]
}

export interface ToolRegistryEntry {
	label: string
	source: "builtin" | "custom"
	sourcePath?: string
	renderCall?: any
	renderResult?: any
}

const buildToolRegistry = (customTools: LoadedCustomTool[]): Map<string, ToolRegistryEntry> => {
	const registry = new Map<string, ToolRegistryEntry>()
	for (const tool of codingTools) {
		registry.set(tool.name, { label: tool.label, source: "builtin" })
	}
	for (const { tool, resolvedPath } of customTools) {
		const customTool = tool as any
		registry.set(tool.name, {
			label: tool.label,
			source: "custom",
			sourcePath: resolvedPath,
			renderCall: customTool.renderCall,
			renderResult: customTool.renderResult,
		})
	}
	return registry
}

const buildCycleModels = (
	modelSpec: string | undefined,
	loaded: LoadedAppConfig,
): Array<{ provider: KnownProvider; model: Model<Api> }> => {
	type ModelEntry = { provider: KnownProvider; model: Model<Api> }
	const entries: ModelEntry[] = []
	const modelIds = modelSpec?.split(",").map((s) => s.trim()).filter(Boolean) || [loaded.modelId]

	for (const id of modelIds) {
		if (id.includes("/")) {
			const [provStr, modelStr] = id.split("/")
			const prov = getProviders().find((p) => p === provStr) as KnownProvider | undefined
			if (!prov) continue
			const model = getModels(prov).find((m) => m.id === modelStr)
			if (model) entries.push({ provider: prov, model })
		} else {
			for (const prov of getProviders()) {
				const model = getModels(prov as KnownProvider).find((m) => m.id === id)
				if (model) {
					entries.push({ provider: prov as KnownProvider, model })
					break
				}
			}
		}
	}

	if (entries.length === 0) entries.push({ provider: loaded.provider, model: loaded.model })
	return entries
}

const createAgentFactory =
	(transport: AgentTransport, tools: AgentTool<any, any>[], config: LoadedAppConfig) =>
	(options?: { model?: Model<Api>; thinking?: ThinkingLevel }) =>
		new Agent({
			transport,
			initialState: {
				systemPrompt: config.systemPrompt,
				model: options?.model ?? config.model,
				thinkingLevel: options?.thinking ?? config.thinking,
				tools,
			},
		})

const parseModelArgs = (args?: RuntimeInitArgs) => {
	const firstModelRaw = args?.model?.split(",")[0]?.trim()
	let firstProvider = args?.provider
	let firstModel = firstModelRaw
	if (firstModelRaw?.includes("/")) {
		const [p, m] = firstModelRaw.split("/")
		firstProvider = p
		firstModel = m
	}
	return { firstProvider, firstModel }
}

export const createRuntime = async (
	args: RuntimeInitArgs = {},
	adapter: AdapterKind = "tui",
): Promise<RuntimeContext> => {
	const { firstProvider, firstModel } = parseModelArgs(args)
	const loaded = await loadAppConfig({
		configDir: args.configDir,
		configPath: args.configPath,
		provider: firstProvider,
		model: firstModel,
		thinking: args.thinking,
	})

	const { commands: customCommands, issues: commandIssues } = loadCustomCommands(loaded.configDir)
	const cwd = process.cwd()
	const sendRef: SendRef = { current: () => {} }
	const sessionManager = new SessionManager(loaded.configDir)
	const extensibility = await loadExtensibility({
		configDir: loaded.configDir,
		cwd,
		sendRef,
		builtinTools: codingTools,
		hasUI: adapter === "tui",
		sessionManager,
	})

	const validationIssues: ValidationIssue[] = [...commandIssues, ...extensibility.validationIssues]
	for (const issue of validationIssues) {
		if (issue.severity === "error") {
			process.stderr.write(`[${issue.kind}] ${issue.path}: ${issue.message}\n`)
		}
	}

	attachHookErrorLogging(extensibility.hookRunner, (message) => process.stderr.write(`${message}\n`))

	const lsp = createLspManager({
		cwd,
		configDir: loaded.configDir,
		enabled: loaded.lsp.enabled,
		autoInstall: loaded.lsp.autoInstall,
	})
	const lspActiveRef = { setActive: (_v: boolean) => {} }

	// Build tool list: builtins + custom tools + hook-registered tools
	const hookTools = getHookTools(extensibility.hookRunner)
	const allTools: AgentTool<any, any>[] = [
		...codingTools,
		...extensibility.customTools.map((t) => t.tool),
		...hookTools,
	]

	const tools = wrapToolsWithLspDiagnostics(
		wrapToolsWithHooks(allTools, extensibility.hookRunner),
		lsp,
		{
			cwd,
			onCheckStart: () => lspActiveRef.setActive(true),
			onCheckEnd: () => lspActiveRef.setActive(false),
		},
	)

	const transports = createTransportBundle(loaded, defaultApiKeyResolver)
	// Wrap router transport with hook transforms (chat.messages.transform, auth.get, model.resolve, etc.)
	const hookedTransport = new HookedTransport(transports.router, extensibility.hookRunner)
	const createAgentInstance = createAgentFactory(hookedTransport, tools, loaded)
	const agent = createAgentInstance()

	await extensibility.hookRunner.emit({ type: "app.start" })

	const toolByName = buildToolRegistry(extensibility.customTools)
	const cycleModels = buildCycleModels(args.model, loaded)

	return {
		adapter,
		agent,
		createAgent: createAgentInstance,
		sessionManager,
		hookRunner: extensibility.hookRunner,
		customCommands,
		toolByName,
		lsp,
		lspActiveRef,
		sendRef,
		config: loaded,
		cycleModels,
		getApiKey: defaultApiKeyResolver,
		transport: transports.router,
		providerTransport: transports.provider,
		codexTransport: transports.codex,
		validationIssues,
	}
}

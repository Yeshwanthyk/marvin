import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens, type ThinkingLevel } from "@marvin-agents/agent-core"
import { getApiKey, getModels, getProviders, type AgentTool, type Model, type Api, type KnownProvider } from "@marvin-agents/ai"
import { codingTools } from "@marvin-agents/base-tools"
import { createLspManager, wrapToolsWithLspDiagnostics, type LspManager } from "@marvin-agents/lsp"
import { loadAppConfig, type LoadedAppConfig } from "../config.js"
import { loadCustomCommands, type CustomCommand } from "../custom-commands.js"
import { loadHooks, HookRunner, wrapToolsWithHooks, type HookError } from "../hooks/index.js"
import { loadCustomTools, getToolNames, type SendRef, type LoadedCustomTool } from "../custom-tools/index.js"
import { SessionManager } from "../session-manager.js"

export interface RunTuiArgs {
	configDir?: string
	configPath?: string
	provider?: string
	model?: string
	thinking?: ThinkingLevel
	continueSession?: boolean
	resumeSession?: boolean
}

export interface AppRuntime {
	agent: Agent
	sessionManager: SessionManager
	hookRunner: HookRunner
	toolByName: Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: any; renderResult?: any }>
	customCommands: Map<string, CustomCommand>
	lsp: LspManager
	config: LoadedAppConfig
	getApiKey: (provider: string) => string | undefined
	codexTransport: CodexTransport
	sendRef: SendRef
	lspActiveRef: { setActive: (v: boolean) => void }
	cycleModels: Array<{ provider: KnownProvider; model: Model<Api> }>
}

const buildToolRegistry = (customTools: LoadedCustomTool[]) => {
	const registry = new Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: any; renderResult?: any }>()
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

const buildCycleModels = (modelSpec: string | undefined, loaded: LoadedAppConfig): Array<{ provider: KnownProvider; model: Model<Api> }> => {
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

export const createRuntime = async (args?: RunTuiArgs): Promise<AppRuntime> => {
	const firstModelRaw = args?.model?.split(",")[0]?.trim()
	let firstProvider = args?.provider
	let firstModel = firstModelRaw
	if (firstModelRaw?.includes("/")) {
		const [p, m] = firstModelRaw.split("/")
		firstProvider = p
		firstModel = m
	}

	const loaded = await loadAppConfig({
		configDir: args?.configDir,
		configPath: args?.configPath,
		provider: firstProvider,
		model: firstModel,
		thinking: args?.thinking,
	})

	const customCommands = loadCustomCommands(loaded.configDir)

	const cwd = process.cwd()
	const { hooks, errors: hookErrors } = await loadHooks(loaded.configDir)
	const hookRunner = new HookRunner(hooks, cwd, loaded.configDir)

	for (const { path, error } of hookErrors) {
		process.stderr.write(`Hook load error: ${path}: ${error}\n`)
	}

	hookRunner.onError((err: HookError) => {
		process.stderr.write(`Hook error [${err.event}] ${err.hookPath}: ${err.error}\n`)
	})

	const sendRef: SendRef = { current: () => {} }
	const { tools: customTools, errors: toolErrors } = await loadCustomTools(
		loaded.configDir,
		cwd,
		getToolNames(codingTools),
		sendRef,
	)

	for (const { path, error } of toolErrors) {
		process.stderr.write(`Tool load error: ${path}: ${error}\n`)
	}

	const lsp = createLspManager({
		cwd,
		configDir: loaded.configDir,
		enabled: loaded.lsp.enabled,
		autoInstall: loaded.lsp.autoInstall,
	})
	const lspActiveRef = { setActive: (_v: boolean) => {} }

	const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)]
	const tools = wrapToolsWithLspDiagnostics(wrapToolsWithHooks(allTools, hookRunner), lsp, {
		cwd,
		onCheckStart: () => lspActiveRef.setActive(true),
		onCheckEnd: () => lspActiveRef.setActive(false),
	})

	const toolByName = buildToolRegistry(customTools)

	const sessionManager = new SessionManager(loaded.configDir)

	const getApiKeyForProvider = (provider: string): string | undefined => {
		if (provider === "anthropic") return process.env["ANTHROPIC_OAUTH_TOKEN"] || getApiKey(provider)
		return getApiKey(provider)
	}

	const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider })
	const codexTransport = new CodexTransport({
		getTokens: async () => loadTokens({ configDir: loaded.configDir }),
		setTokens: async (tokens) => saveTokens(tokens, { configDir: loaded.configDir }),
		clearTokens: async () => clearTokens({ configDir: loaded.configDir }),
	})

	const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport })
	const agent = new Agent({
		transport,
		initialState: { systemPrompt: loaded.systemPrompt, model: loaded.model, thinkingLevel: loaded.thinking, tools },
	})

	await hookRunner.emit({ type: "app.start" })

	const cycleModels = buildCycleModels(args?.model, loaded)

	return {
		agent,
		sessionManager,
		hookRunner,
		toolByName,
		customCommands,
		lsp,
		config: loaded,
		getApiKey: getApiKeyForProvider,
		codexTransport,
		sendRef,
		lspActiveRef,
		cycleModels,
	}
}

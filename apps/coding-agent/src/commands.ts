/**
 * Slash command handlers for TUI application
 */

import type { Agent, ThinkingLevel } from "@marvin-agents/agent-core"
import type { Api, Model } from "@marvin-agents/ai"
import { getModels, getProviders } from "@marvin-agents/ai"
import type { CodexTransport } from "@marvin-agents/agent-core"
import type { SessionManager } from "./session-manager.js"
import type { UIMessage, ActivityState } from "./types.js"
import { handleCompact as doCompact } from "./compact-handler.js"
import { updateAppConfig } from "./config.js"

type KnownProvider = ReturnType<typeof getProviders>[number]

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"]

export interface CommandContext {
	agent: Agent
	sessionManager: SessionManager
	configDir: string
	configPath: string
	codexTransport: CodexTransport
	getApiKey: (provider: string) => string | undefined

	// Current state (mutable refs)
	currentProvider: KnownProvider
	currentModelId: string
	currentThinking: ThinkingLevel

	// State setters
	setCurrentProvider: (p: KnownProvider) => void
	setCurrentModelId: (id: string) => void
	setCurrentThinking: (t: ThinkingLevel) => void

	// UI state
	isResponding: () => boolean
	setIsResponding: (v: boolean) => void
	setActivityState: (s: ActivityState) => void
	setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void
	setToolBlocks: (updater: (prev: unknown[]) => unknown[]) => void
	setContextTokens: (v: number) => void

	// Display state
	setDisplayModelId: (id: string) => void
	setDisplayThinking: (t: ThinkingLevel) => void
	setDisplayContextWindow: (v: number) => void

	// Diff wrap mode
	setDiffWrapMode: (updater: (prev: "word" | "none") => "word" | "none") => void
}

// Helper to resolve provider from string
const resolveProvider = (raw: string): KnownProvider | undefined => {
	const trimmed = raw.trim()
	if (!trimmed) return undefined
	const providers = getProviders()
	return providers.includes(trimmed as KnownProvider) ? (trimmed as KnownProvider) : undefined
}

// Helper to resolve model for a provider
const resolveModel = (provider: KnownProvider, raw: string): Model<Api> | undefined => {
	const modelId = raw.trim()
	if (!modelId) return undefined
	return getModels(provider).find((m) => m.id === modelId) as Model<Api> | undefined
}

export { resolveProvider, resolveModel }

// Add a system message to the UI
function addSystemMessage(ctx: CommandContext, content: string): void {
	ctx.setMessages((prev) => [
		...prev,
		{ id: crypto.randomUUID(), role: "assistant" as const, content },
	])
}

// ----- Individual Command Handlers -----

function handleExit(): boolean {
	process.exit(0)
}

function handleClear(ctx: CommandContext): boolean {
	ctx.setMessages(() => [])
	ctx.setToolBlocks(() => [])
	ctx.setContextTokens(0)
	ctx.agent.reset()
	return true
}

function handleThinking(args: string, ctx: CommandContext): boolean {
	const next = args.trim() as ThinkingLevel
	if (!THINKING_LEVELS.includes(next)) return false

	ctx.agent.setThinkingLevel(next)
	ctx.setCurrentThinking(next)
	ctx.setDisplayThinking(next)
	void updateAppConfig(
		{ configDir: ctx.configDir, configPath: ctx.configPath },
		{ thinking: next }
	)
	return true
}

function handleDiffwrap(ctx: CommandContext): boolean {
	ctx.setDiffWrapMode((prev) => (prev === "word" ? "none" : "word"))
	return true
}

function handleModel(args: string, ctx: CommandContext): boolean {
	if (!args) {
		addSystemMessage(ctx, "Usage: /model <provider> <modelId> (or /model <modelId>)")
		return true
	}

	if (ctx.isResponding()) {
		addSystemMessage(ctx, "Model cannot be changed while responding. Use /abort first.")
		return true
	}

	const parts = args.split(/\s+/)
	if (parts.length === 1) {
		// Try to find model in current provider
		const modelId = parts[0]!
		const model = resolveModel(ctx.currentProvider, modelId)
		if (!model) {
			const examples = getModels(ctx.currentProvider).slice(0, 5).map((m) => m.id).join(", ")
			addSystemMessage(ctx, `Unknown model "${modelId}" for ${ctx.currentProvider}. Examples: ${examples}`)
			return true
		}

		ctx.agent.setModel(model)
		ctx.setCurrentModelId(model.id)
		ctx.setDisplayModelId(model.id)
		ctx.setDisplayContextWindow(model.contextWindow)
		void updateAppConfig(
			{ configDir: ctx.configDir, configPath: ctx.configPath },
			{ model: model.id }
		)
		return true
	}

	// provider modelId format
	const [providerRaw, ...modelParts] = parts
	const provider = resolveProvider(providerRaw!)
	if (!provider) {
		addSystemMessage(ctx, `Unknown provider "${providerRaw}". Known: ${getProviders().join(", ")}`)
		return true
	}

	const modelId = modelParts.join(" ")
	const model = resolveModel(provider, modelId)
	if (!model) {
		const examples = getModels(provider).slice(0, 5).map((m) => m.id).join(", ")
		addSystemMessage(ctx, `Unknown model "${modelId}" for ${provider}. Examples: ${examples}`)
		return true
	}

	ctx.agent.setModel(model)
	ctx.setCurrentProvider(provider)
	ctx.setCurrentModelId(model.id)
	ctx.setDisplayModelId(model.id)
	ctx.setDisplayContextWindow(model.contextWindow)
	void updateAppConfig(
		{ configDir: ctx.configDir, configPath: ctx.configPath },
		{ provider, model: model.id }
	)
	return true
}

async function handleCompactCmd(args: string, ctx: CommandContext): Promise<boolean> {
	if (ctx.isResponding()) {
		addSystemMessage(ctx, "Cannot compact while responding. Use /abort first.")
		return true
	}

	const messages = ctx.agent.state.messages
	if (messages.length < 2) {
		addSystemMessage(ctx, "Nothing to compact (need at least one exchange)")
		return true
	}

	const customInstructions = args.trim() || undefined

	ctx.setActivityState("thinking")
	ctx.setIsResponding(true)

	try {
		const { summary, summaryMessage } = await doCompact({
			agent: ctx.agent,
			currentProvider: ctx.currentProvider,
			getApiKey: ctx.getApiKey,
			codexTransport: ctx.codexTransport,
			customInstructions,
		})

		// Reset agent and add summary message
		ctx.agent.reset()
		ctx.agent.replaceMessages([summaryMessage])

		// Start a new session containing the compacted context, so resume works as expected.
		ctx.sessionManager.startSession(ctx.currentProvider, ctx.currentModelId, ctx.currentThinking)
		ctx.sessionManager.appendMessage(summaryMessage)

		// Clear UI and show compaction result
		ctx.setMessages(() => [
			{ id: crypto.randomUUID(), role: "assistant" as const, content: `Context compacted:\n\n${summary}` },
		])
		ctx.setToolBlocks(() => [])
		ctx.setContextTokens(0)
	} catch (err) {
		addSystemMessage(ctx, `Compact failed: ${err instanceof Error ? err.message : String(err)}`)
	} finally {
		ctx.setIsResponding(false)
		ctx.setActivityState("idle")
	}

	return true
}

// ----- Main Dispatcher -----

export function handleSlashCommand(line: string, ctx: CommandContext): boolean | Promise<boolean> {
	const trimmed = line.trim()

	if (trimmed === "/exit" || trimmed === "/quit") {
		return handleExit()
	}

	if (trimmed === "/clear") {
		return handleClear(ctx)
	}

	if (trimmed.startsWith("/thinking")) {
		const args = trimmed.slice("/thinking".length).trim()
		return handleThinking(args, ctx)
	}

	if (trimmed === "/diffwrap") {
		return handleDiffwrap(ctx)
	}

	if (trimmed.startsWith("/model")) {
		const args = trimmed.slice("/model".length).trim()
		return handleModel(args, ctx)
	}

	if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
		const args = trimmed.startsWith("/compact ") ? trimmed.slice("/compact ".length) : ""
		return handleCompactCmd(args, ctx)
	}

	return false
}

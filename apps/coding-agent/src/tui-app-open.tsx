/**
 * OpenTUI-based TUI application for coding-agent
 */

import { TextareaRenderable, InputRenderable, ScrollBoxRenderable, type KeyEvent } from "@opentui/core"
import { render, useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { createSignal, createEffect, createMemo, For, Show, onCleanup, onMount, batch } from "solid-js"
import { ThemeProvider, useTheme, TextAttributes } from "@marvin-agents/open-tui"
import {
	Agent,
	ProviderTransport,
	RouterTransport,
	CodexTransport,
	loadTokens,
	saveTokens,
	clearTokens,
} from "@marvin-agents/agent-core"
import type { AgentEvent, ThinkingLevel, AppMessage } from "@marvin-agents/agent-core"
import { getApiKey, getModels, getProviders, type Model, type Api, type AssistantMessage, type Message } from "@marvin-agents/ai"
import { codingTools } from "@marvin-agents/base-tools"
import { loadAppConfig, updateAppConfig } from "./config.js"
import { handleCompact, SUMMARY_PREFIX, SUMMARY_SUFFIX } from "./tui/compact-handler.js"
import { CombinedAutocompleteProvider, type AutocompleteItem } from "@marvin-agents/tui"
import { createAutocompleteCommands } from "./tui/autocomplete-commands.js"
import { SessionManager, type LoadedSession, type SessionDetails } from "./session-manager.js"
import { colors } from "./tui/themes.js"
import { ToolBlock as ToolBlockComponent, Thinking, getToolText, getEditDiffText } from "./tui-open-rendering.js"
import { existsSync, readFileSync, watch, appendFileSync, type FSWatcher } from "fs"

// Debug logger
const DEBUG = process.env.MARVIN_DEBUG === "1"
const debugLog = (msg: string, data?: unknown) => {
	if (!DEBUG) return
	const line = `[${new Date().toISOString()}] ${msg}${data !== undefined ? ": " + JSON.stringify(data) : ""}\n`
	try { appendFileSync("/tmp/marvin-debug.log", line) } catch {}
}
import { spawnSync } from "child_process"
import { dirname, join } from "path"

type KnownProvider = ReturnType<typeof getProviders>[number]

// ----- Session Picker -----

async function selectSessionOpen(sessionManager: SessionManager): Promise<string | null> {
	const sessions = sessionManager.loadAllSessions()
	if (sessions.length === 0) return null
	if (sessions.length === 1) return sessions[0]!.path

	// Use legacy picker for now - OpenTUI render doesn't provide cleanup mechanism
	const { selectSession } = await import("./tui/session-picker.js")
	return selectSession(sessionManager)
}

// ----- Types -----

interface UIMessage {
	id: string
	role: "user" | "assistant"
	content: string
	thinking?: { summary: string; full: string }
	isStreaming?: boolean  // true while actively streaming
	tools?: ToolBlock[]    // tools associated with this message
}

interface ToolBlock {
	id: string
	name: string
	args: unknown
	output?: string
	editDiff?: string
	isError: boolean
	isComplete: boolean
}

type ActivityState = "idle" | "thinking" | "streaming" | "tool"

// ----- Git helpers -----

function findGitHeadPath(): string | null {
	let dir = process.cwd()
	while (true) {
		const gitHeadPath = join(dir, ".git", "HEAD")
		if (existsSync(gitHeadPath)) return gitHeadPath
		const parent = dirname(dir)
		if (parent === dir) return null
		dir = parent
	}
}

function getCurrentBranch(): string | null {
	try {
		const gitHeadPath = findGitHeadPath()
		if (!gitHeadPath) return null
		const content = readFileSync(gitHeadPath, "utf8").trim()
		if (content.startsWith("ref: refs/heads/")) return content.slice(16)
		return "detached"
	} catch {
		return null
	}
}

function getGitDiffStats(): { ins: number; del: number } | null {
	try {
		const result = spawnSync("git", ["diff", "--shortstat"], { cwd: process.cwd(), encoding: "utf8" })
		const output = (result.stdout || "").trim()
		if (!output) return { ins: 0, del: 0 }
		const ins = output.match(/(\d+) insertions?/)?.[1] ?? "0"
		const del = output.match(/(\d+) deletions?/)?.[1] ?? "0"
		return { ins: +ins, del: +del }
	} catch {
		return null
	}
}

// ----- Main -----

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

export const runTuiOpen = async (args?: {
	configDir?: string
	configPath?: string
	provider?: string
	model?: string
	thinking?: ThinkingLevel
	continueSession?: boolean
	resumeSession?: boolean
}) => {
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

	// Session management
	const sessionManager = new SessionManager(loaded.configDir)
	let selectedSessionPath: string | null = null
	let initialSession: LoadedSession | null = null

	// Handle --resume: show picker before main TUI
	if (args?.resumeSession) {
		selectedSessionPath = await selectSessionOpen(sessionManager)
		if (selectedSessionPath === null) {
			process.stdout.write("No session selected\n")
			return
		}
		initialSession = sessionManager.loadSession(selectedSessionPath)
	}

	// Handle --continue: load latest session
	if (args?.continueSession && !initialSession) {
		initialSession = sessionManager.loadLatest()
	}

	const getApiKeyForProvider = (provider: string): string | undefined => {
		if (provider === "anthropic") {
			return process.env["ANTHROPIC_OAUTH_TOKEN"] || getApiKey(provider)
		}
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
		initialState: {
			systemPrompt: loaded.systemPrompt,
			model: loaded.model,
			thinkingLevel: loaded.thinking,
			tools: codingTools,
		},
	})

	// Build model cycling list from comma-separated --model arg
	type ModelEntry = { provider: KnownProvider; model: Model<Api> }
	const cycleModels: ModelEntry[] = []
	const modelIds = args?.model?.split(",").map((s) => s.trim()).filter(Boolean) || [loaded.modelId]

	for (const id of modelIds) {
		if (id.includes("/")) {
			const [provStr, modelStr] = id.split("/")
			const prov = resolveProvider(provStr!)
			if (!prov) continue
			const model = resolveModel(prov, modelStr!)
			if (model) cycleModels.push({ provider: prov, model })
		} else {
			for (const prov of getProviders()) {
				const model = resolveModel(prov as KnownProvider, id)
				if (model) {
					cycleModels.push({ provider: prov as KnownProvider, model })
					break
				}
			}
		}
	}
	if (cycleModels.length === 0) {
		cycleModels.push({ provider: loaded.provider, model: loaded.model })
	}

	render(
		() => (
			<App
				agent={agent}
				sessionManager={sessionManager}
				initialSession={initialSession}
				modelId={loaded.modelId}
				model={loaded.model}
				provider={loaded.provider}
				thinking={loaded.thinking}
				cycleModels={cycleModels}
				configDir={loaded.configDir}
				configPath={loaded.configPath}
				codexTransport={codexTransport}
				getApiKey={getApiKeyForProvider}
			/>
		),
		{
			targetFps: 60,
			exitOnCtrlC: false,
			useKittyKeyboard: {},
		}
	)
}

// ----- Content extraction -----

function extractText(content: unknown[]): string {
	let text = ""
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>
		if (b.type === "text" && typeof b.text === "string") {
			text += b.text
		}
	}
	return text
}

function extractThinking(content: unknown[]): { summary: string; full: string } | null {
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>
		if (b.type === "thinking" && typeof b.thinking === "string") {
			const full = b.thinking
			const lines = full.trim().split("\n").filter((l) => l.trim().length > 20)
			const summary = lines[0]?.trim().slice(0, 80) || full.trim().slice(0, 80)
			const truncated = summary.length >= 80 ? summary + "..." : summary
			return { summary: truncated, full }
		}
	}
	return null
}

// ----- App Component -----

interface AppProps {
	agent: Agent
	sessionManager: SessionManager
	initialSession: LoadedSession | null
	modelId: string
	model: Model<Api>
	provider: KnownProvider
	thinking: ThinkingLevel
	cycleModels: Array<{ provider: KnownProvider; model: Model<Api> }>
	configDir: string
	configPath: string
	codexTransport: CodexTransport
	getApiKey: (provider: string) => string | undefined
}

function App(props: AppProps) {
	const { agent, sessionManager } = props

	// Mutable state for provider/model/thinking (cycled via keybindings)
	let currentProvider = props.provider
	let currentModelId = props.modelId
	let currentThinking = props.thinking
	let cycleIndex = 0

	// Session state
	let sessionStarted = false

	const ensureSession = () => {
		if (!sessionStarted) {
			sessionManager.startSession(currentProvider, currentModelId, currentThinking)
			sessionStarted = true
		}
	}

	// State
	const [messages, setMessages] = createSignal<UIMessage[]>([])
	const [toolBlocks, setToolBlocks] = createSignal<ToolBlock[]>([])
	const [isResponding, setIsResponding] = createSignal(false)
	const [activityState, setActivityState] = createSignal<ActivityState>("idle")

	// Toggle states
	const [toolOutputExpanded, setToolOutputExpanded] = createSignal(false)
	const [thinkingVisible, setThinkingVisible] = createSignal(true)

	// Footer state (reactive for cycling)
	const [displayModelId, setDisplayModelId] = createSignal(props.modelId)
	const [displayThinking, setDisplayThinking] = createSignal(props.thinking)
	const [displayContextWindow, setDisplayContextWindow] = createSignal(props.model.contextWindow)

	// Usage tracking
	const [contextTokens, setContextTokens] = createSignal(0)

	// Queue state
	const queuedMessages: string[] = []
	const [queueCount, setQueueCount] = createSignal(0)

	// Retry state
	const retryConfig = { enabled: true, maxRetries: 3, baseDelayMs: 2000 }
	const retryablePattern = /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error/i
	let retryAttempt = 0
	let retryAbortController: AbortController | null = null
	const [retryStatus, setRetryStatus] = createSignal<string | null>(null)

	// Restore session on mount
	onMount(() => {
		if (props.initialSession) {
			restoreSession(props.initialSession)
		}
	})

	const restoreSession = (session: LoadedSession) => {
		const { metadata, messages: sessionMessages } = session

		// Update provider/model/thinking if different
		const resolvedProvider = resolveProvider(metadata.provider)
		if (resolvedProvider) {
			const resolvedModel = resolveModel(resolvedProvider, metadata.modelId)
			if (resolvedModel) {
				currentProvider = resolvedProvider
				currentModelId = resolvedModel.id
				currentThinking = metadata.thinkingLevel
				agent.setModel(resolvedModel)
				agent.setThinkingLevel(metadata.thinkingLevel)
				setDisplayModelId(resolvedModel.id)
				setDisplayThinking(metadata.thinkingLevel)
				setDisplayContextWindow(resolvedModel.contextWindow)
			}
		}

		// Restore messages to agent
		agent.replaceMessages(sessionMessages)

		// Render conversation history
		const uiMessages: UIMessage[] = []
		for (const msg of sessionMessages) {
			if (msg.role === "user") {
				const text = typeof msg.content === "string" ? msg.content : extractText(msg.content as unknown[])
				uiMessages.push({ id: crypto.randomUUID(), role: "user", content: text })
			} else if (msg.role === "assistant") {
				const text = extractText(msg.content as unknown[])
				const thinking = extractThinking(msg.content as unknown[])
				uiMessages.push({
					id: crypto.randomUUID(),
					role: "assistant",
					content: text,
					thinking: thinking || undefined,
					isStreaming: false,
					tools: [],
				})
			}
		}
		setMessages(uiMessages)

		// Continue the existing session file
		const sessionPath = sessionManager.listSessions().find((s) => s.id === metadata.id)?.path || ""
		sessionManager.continueSession(sessionPath, metadata.id)
		sessionStarted = true
	}

	// Subscribe to agent events
	createEffect(() => {
		const unsubscribe = agent.subscribe((event: AgentEvent) => {
			try {
				handleAgentEvent(event)
			} catch (err) {
				// Silently handle errors
			}
		})

		onCleanup(() => unsubscribe())
	})

	// Track current streaming message ID
	let streamingMessageId: string | null = null

	const handleAgentEvent = (event: AgentEvent) => {
		if (event.type === "message_start") {
			// Handle queued user message being processed
			if (event.message.role === "user") {
				if (queuedMessages.length > 0) {
					queuedMessages.shift()
					setQueueCount(queuedMessages.length)
					const text = typeof event.message.content === "string"
						? event.message.content
						: extractText(event.message.content as unknown[])
					setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }])
					setActivityState("thinking")
				}
			}

			// Create streaming assistant message
			if (event.message.role === "assistant") {
				streamingMessageId = crypto.randomUUID()
				batch(() => {
					setActivityState("streaming")
					setMessages((prev) => [
						...prev,
						{
							id: streamingMessageId!,
							role: "assistant",
							content: "",
							isStreaming: true,
							tools: [],
						},
					])
				})
			}
		}

		if (event.type === "message_update" && event.message.role === "assistant") {
			const content = event.message.content as unknown[]
			const text = extractText(content)
			const thinking = extractThinking(content)

			// Update the streaming message in place
			setMessages((prev) =>
				prev.map((msg) =>
					msg.id === streamingMessageId
						? {
								...msg,
								content: text,
								thinking: thinking || msg.thinking,
						  }
						: msg
				)
			)

			if (thinking && !text) setActivityState("thinking")
		}

		if (event.type === "message_end" && event.message.role === "assistant") {
			const content = event.message.content as unknown[]
			const text = extractText(content)
			const thinking = extractThinking(content)

			// Finalize the streaming message
			setMessages((prev) =>
				prev.map((msg) =>
					msg.id === streamingMessageId
						? {
								...msg,
								content: text,
								thinking: thinking || msg.thinking,
								isStreaming: false,
						  }
						: msg
				)
			)

			streamingMessageId = null

			// Save message to session
			sessionManager.appendMessage(event.message as AppMessage)

			// Update usage
			const msg = event.message as { usage?: { input: number; output: number; cacheRead: number; cacheWrite?: number } }
			if (msg.usage) {
				const tokens = msg.usage.input + msg.usage.output + msg.usage.cacheRead + (msg.usage.cacheWrite || 0)
				setContextTokens(tokens)
			}
		}

		if (event.type === "tool_execution_start") {
			setActivityState("tool")
			const newTool: ToolBlock = {
				id: event.toolCallId,
				name: event.toolName,
				args: event.args,
				isError: false,
				isComplete: false,
			}
			// Add tool to current streaming message
			if (streamingMessageId) {
				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === streamingMessageId
							? { ...msg, tools: [...(msg.tools || []), newTool] }
							: msg
					)
				)
			}
			setToolBlocks((prev) => [...prev, newTool])
		}

		if (event.type === "tool_execution_update") {
			const updateTool = (tools: ToolBlock[]) =>
				tools.map((t) =>
					t.id === event.toolCallId
						? { ...t, output: getToolText(event.partialResult) }
						: t
				)
			setToolBlocks(updateTool)
			if (streamingMessageId) {
				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === streamingMessageId
							? { ...msg, tools: updateTool(msg.tools || []) }
							: msg
					)
				)
			}
		}

		if (event.type === "tool_execution_end") {
			const updateTool = (tools: ToolBlock[]) =>
				tools.map((t) =>
					t.id === event.toolCallId
						? {
								...t,
								output: getToolText(event.result),
								editDiff: getEditDiffText(event.result) || undefined,
								isError: event.isError,
								isComplete: true,
						  }
						: t
				)
			setToolBlocks(updateTool)
			if (streamingMessageId) {
				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === streamingMessageId
							? { ...msg, tools: updateTool(msg.tools || []) }
							: msg
					)
				)
			}
		}

		if (event.type === "turn_end") {
			streamingMessageId = null
		}

		if (event.type === "agent_end") {
			streamingMessageId = null

			// Check for retryable error
			const lastMsg = agent.state.messages[agent.state.messages.length - 1]
			const errorMsg = lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).errorMessage
			const isRetryable = errorMsg && retryablePattern.test(errorMsg)

			if (isRetryable && retryConfig.enabled && retryAttempt < retryConfig.maxRetries) {
				retryAttempt++
				const delay = retryConfig.baseDelayMs * Math.pow(2, retryAttempt - 1)
				setRetryStatus(`Retrying (${retryAttempt}/${retryConfig.maxRetries}) in ${Math.round(delay / 1000)}s... (esc to cancel)`)

				retryAbortController = new AbortController()
				const signal = retryAbortController.signal

				const sleep = (ms: number) =>
					new Promise<void>((resolve, reject) => {
						const timeout = setTimeout(resolve, ms)
						signal.addEventListener("abort", () => {
							clearTimeout(timeout)
							reject(new Error("cancelled"))
						})
					})

				sleep(delay)
					.then(() => {
						if (signal.aborted) return
						setRetryStatus(null)
						retryAbortController = null
						// Remove last error message and retry
						agent.replaceMessages(agent.state.messages.slice(0, -1))
						setActivityState("thinking")
						void agent.continue().catch((err) => {
							setActivityState("idle")
							setIsResponding(false)
							setMessages((prev) => [
								...prev,
								{
									id: crypto.randomUUID(),
									role: "assistant",
									content: `Error: ${err instanceof Error ? err.message : String(err)}`,
								},
							])
						})
					})
					.catch(() => {
						// Retry cancelled
						setIsResponding(false)
						setActivityState("idle")
					})
				return
			}

			retryAttempt = 0
			batch(() => {
				setIsResponding(false)
				setActivityState("idle")
			})
		}
	}

	// ----- Slash Command Handling -----
	const thinkingLevels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"]

	const clearConversation = () => {
		setMessages([])
		setToolBlocks([])
		setContextTokens(0)
		agent.reset()
	}

	const exit = () => {
		process.exit(0)
	}

	const handleSlashCommand = (line: string): boolean => {
		if (line === "/exit" || line === "/quit") {
			exit()
			return true
		}

		if (line === "/clear") {
			clearConversation()
			return true
		}

		if (line === "/abort") {
			handleAbort()
			return true
		}

		if (line.startsWith("/thinking")) {
			const next = line.slice("/thinking".length).trim() as ThinkingLevel
			if (thinkingLevels.includes(next)) {
				agent.setThinkingLevel(next)
				currentThinking = next
				setDisplayThinking(next)
				void updateAppConfig({ configDir: props.configDir, configPath: props.configPath }, { thinking: next })
				return true
			}
			return false
		}

		if (line.startsWith("/model")) {
			const rest = line.slice("/model".length).trim()

			if (!rest) {
				// Show help message
				setMessages((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						role: "assistant",
						content: "Usage: /model <provider> <modelId> (or /model <modelId>)",
					},
				])
				return true
			}

			if (isResponding()) {
				setMessages((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						role: "assistant",
						content: "Model cannot be changed while responding. Use /abort first.",
					},
				])
				return true
			}

			const parts = rest.split(/\s+/)
			if (parts.length === 1) {
				// Try to find model in current provider
				const modelId = parts[0]!
				const model = resolveModel(currentProvider, modelId)
				if (!model) {
					const examples = getModels(currentProvider).slice(0, 5).map((m) => m.id).join(", ")
					setMessages((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							role: "assistant",
							content: `Unknown model "${modelId}" for ${currentProvider}. Examples: ${examples}`,
						},
					])
					return true
				}

				agent.setModel(model)
				currentModelId = model.id
				setDisplayModelId(model.id)
				setDisplayContextWindow(model.contextWindow)
				void updateAppConfig({ configDir: props.configDir, configPath: props.configPath }, { model: model.id })
				return true
			}

			// provider modelId format
			const [providerRaw, ...modelParts] = parts
			const provider = resolveProvider(providerRaw!)
			if (!provider) {
				setMessages((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						role: "assistant",
						content: `Unknown provider "${providerRaw}". Known: ${getProviders().join(", ")}`,
					},
				])
				return true
			}

			const modelId = modelParts.join(" ")
			const model = resolveModel(provider, modelId)
			if (!model) {
				const examples = getModels(provider).slice(0, 5).map((m) => m.id).join(", ")
				setMessages((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						role: "assistant",
						content: `Unknown model "${modelId}" for ${provider}. Examples: ${examples}`,
					},
				])
				return true
			}

			agent.setModel(model)
			currentProvider = provider
			currentModelId = model.id
			setDisplayModelId(model.id)
			setDisplayContextWindow(model.contextWindow)
			void updateAppConfig({ configDir: props.configDir, configPath: props.configPath }, { provider, model: model.id })
			return true
		}

		// /compact - summarize and restart session
		if (line === "/compact" || line.startsWith("/compact ")) {
			if (isResponding()) {
				setMessages((prev) => [
					...prev,
					{ id: crypto.randomUUID(), role: "assistant", content: "Cannot compact while responding. Use /abort first." },
				])
				return true
			}

			const messages = agent.state.messages
			if (messages.length < 2) {
				setMessages((prev) => [
					...prev,
					{ id: crypto.randomUUID(), role: "assistant", content: "Nothing to compact (need at least one exchange)" },
				])
				return true
			}

			const customInstructions = line.startsWith("/compact ") ? line.slice(9).trim() : undefined

			setActivityState("thinking")
			setIsResponding(true)

			handleCompact({
				agent,
				currentProvider,
				getApiKey: props.getApiKey,
				codexTransport: props.codexTransport,
				customInstructions,
			})
				.then(({ summary, summaryMessage }) => {
					// Reset agent and add summary message
					agent.reset()
					agent.replaceMessages([summaryMessage])

					// Clear UI and show compaction result
					setMessages([
						{ id: crypto.randomUUID(), role: "assistant", content: `Context compacted:\n\n${summary}` },
					])
					setToolBlocks([])
					setContextTokens(0)

					// Start new session with compacted context
					ensureSession()
					sessionManager.appendMessage(summaryMessage)
				})
				.catch((err) => {
					setMessages((prev) => [
						...prev,
						{ id: crypto.randomUUID(), role: "assistant", content: `Compact failed: ${err instanceof Error ? err.message : String(err)}` },
					])
				})
				.finally(() => {
					setIsResponding(false)
					setActivityState("idle")
				})

			return true
		}

		return false
	}

	const handleSubmit = async (text: string, editorClearFn?: () => void) => {
		if (!text.trim()) return

		// Try slash commands first
		if (text.startsWith("/")) {
			if (handleSlashCommand(text.trim())) {
				editorClearFn?.()
				return
			}
		}

		// Queue if responding
		if (isResponding()) {
			queuedMessages.push(text)
			setQueueCount(queuedMessages.length)
			const queuedUserMessage: AppMessage = {
				role: "user",
				content: [{ type: "text", text }],
				timestamp: Date.now(),
			}
			void agent.queueMessage(queuedUserMessage)
			editorClearFn?.()
			return
		}

		editorClearFn?.()

		// Ensure session is started on first message
		ensureSession()

		// Create user message for session
		const userMessage: AppMessage = {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		}
		sessionManager.appendMessage(userMessage)

		batch(() => {
			setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }])
			setToolBlocks([])
			setIsResponding(true)
			setActivityState("thinking")
		})

		try {
			await agent.prompt(text)
		} catch (err) {
			batch(() => {
				setMessages((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						role: "assistant",
						content: `Error: ${err instanceof Error ? err.message : String(err)}`,
					},
				])
				setIsResponding(false)
				setActivityState("idle")
			})
		}
	}

	const handleAbort = (): string | null => {
		// Cancel retry if pending
		if (retryAbortController) {
			retryAbortController.abort()
			retryAbortController = null
			retryAttempt = 0
			setRetryStatus(null)
		}

		agent.abort()
		agent.clearMessageQueue()

		// Return queued messages to restore to editor
		let restore: string | null = null
		if (queuedMessages.length > 0) {
			restore = queuedMessages.join("\n")
			queuedMessages.length = 0
			setQueueCount(0)
		}

		batch(() => {
			setIsResponding(false)
			setActivityState("idle")
		})

		return restore
	}

	const toggleToolExpand = () => {
		setToolOutputExpanded((v) => {
			debugLog("toggleToolExpand", { from: v, to: !v })
			return !v
		})
	}
	const toggleThinking = () => setThinkingVisible((v) => !v)

	// Ctrl+P model cycling
	const cycleModel = () => {
		if (props.cycleModels.length <= 1) return
		cycleIndex = (cycleIndex + 1) % props.cycleModels.length
		const entry = props.cycleModels[cycleIndex]!
		currentProvider = entry.provider
		currentModelId = entry.model.id
		agent.setModel(entry.model)
		setDisplayModelId(entry.model.id)
		setDisplayContextWindow(entry.model.contextWindow)
	}

	// Shift+Tab thinking cycling
	const cycleThinking = () => {
		const idx = thinkingLevels.indexOf(currentThinking)
		const nextIdx = (idx + 1) % thinkingLevels.length
		const next = thinkingLevels[nextIdx]!
		currentThinking = next
		agent.setThinkingLevel(next)
		setDisplayThinking(next)
	}

	return (
		<ThemeProvider mode="dark">
			<MainView
				messages={messages()}
				toolBlocks={toolBlocks()}
				isResponding={isResponding()}
				activityState={activityState()}
				toolOutputExpanded={toolOutputExpanded()}
				thinkingVisible={thinkingVisible()}
				modelId={displayModelId()}
				thinking={displayThinking()}
				provider={currentProvider}
				contextTokens={contextTokens()}
				contextWindow={displayContextWindow()}
				queueCount={queueCount()}
				retryStatus={retryStatus()}
				onSubmit={handleSubmit}
				onAbort={handleAbort}
				onToggleToolExpand={toggleToolExpand}
				onToggleThinking={toggleThinking}
				onCycleModel={cycleModel}
				onCycleThinking={cycleThinking}
			/>
		</ThemeProvider>
	)
}

// ----- MainView Component -----

function MainView(props: {
	messages: UIMessage[]
	toolBlocks: ToolBlock[]
	isResponding: boolean
	activityState: ActivityState
	toolOutputExpanded: boolean
	thinkingVisible: boolean
	modelId: string
	thinking: ThinkingLevel
	provider: KnownProvider
	contextTokens: number
	contextWindow: number
	queueCount: number
	retryStatus: string | null
	onSubmit: (text: string, clearFn?: () => void) => void
	onAbort: () => string | null
	onToggleToolExpand: () => void
	onToggleThinking: () => void
	onCycleModel: () => void
	onCycleThinking: () => void
}) {
	const { theme } = useTheme()
	const dimensions = useTerminalDimensions()
	let textareaRef: TextareaRenderable | undefined
	let lastCtrlC = 0

	// Autocomplete state (must be before useKeyboard that references it)
	const autocompleteProvider = new CombinedAutocompleteProvider(
		createAutocompleteCommands(() => ({ currentProvider: props.provider })),
		process.cwd()
	)
	const [autocompleteItems, setAutocompleteItems] = createSignal<AutocompleteItem[]>([])
	const [autocompletePrefix, setAutocompletePrefix] = createSignal("")
	const [autocompleteIndex, setAutocompleteIndex] = createSignal(0)
	const [showAutocomplete, setShowAutocomplete] = createSignal(false)

	const updateAutocomplete = (text: string, cursorLine: number, cursorCol: number) => {
		const lines = text.split("\n")
		const result = autocompleteProvider.getSuggestions(lines, cursorLine, cursorCol)
		if (result && result.items.length > 0) {
			const prevPrefix = autocompletePrefix()
			const newItems = result.items.slice(0, 10)
			setAutocompleteItems(newItems)
			setAutocompletePrefix(result.prefix)
			if (result.prefix !== prevPrefix) {
				setAutocompleteIndex(0)
			} else {
				setAutocompleteIndex((i) => Math.min(i, newItems.length - 1))
			}
			setShowAutocomplete(true)
		} else {
			setShowAutocomplete(false)
			setAutocompleteItems([])
		}
	}

	const applyAutocomplete = () => {
		if (!showAutocomplete() || !textareaRef) return false
		const items = autocompleteItems()
		const idx = autocompleteIndex()
		if (idx < 0 || idx >= items.length) return false

		const item = items[idx]!
		const text = textareaRef.plainText
		const lines = text.split("\n")
		const cursorLine = lines.length - 1
		const cursorCol = lines[cursorLine]?.length ?? 0
		const prefix = autocompletePrefix()

		const result = autocompleteProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
		textareaRef.setText(result.lines.join("\n"))
		setShowAutocomplete(false)
		setAutocompleteItems([])
		return true
	}

	// Git state
	const [branch, setBranch] = createSignal<string | null>(getCurrentBranch())
	const [gitStats, setGitStats] = createSignal<{ ins: number; del: number } | null>(null)
	let gitWatcher: FSWatcher | null = null
	let gitStatsInterval: ReturnType<typeof setInterval> | null = null

	// Spinner state
	const [spinnerFrame, setSpinnerFrame] = createSignal(0)
	let spinnerInterval: ReturnType<typeof setInterval> | null = null

	onMount(() => {
		textareaRef?.focus()

		// Watch git branch changes
		const gitHeadPath = findGitHeadPath()
		if (gitHeadPath) {
			try {
				gitWatcher = watch(gitHeadPath, () => {
					setBranch(getCurrentBranch())
				})
			} catch {}
		}

		// Poll git stats every 2s
		setGitStats(getGitDiffStats())
		gitStatsInterval = setInterval(() => {
			setGitStats(getGitDiffStats())
		}, 2000)
	})

	onCleanup(() => {
		if (gitWatcher) gitWatcher.close()
		if (gitStatsInterval) clearInterval(gitStatsInterval)
		if (spinnerInterval) clearInterval(spinnerInterval)
	})

	// Spinner effect
	createEffect(() => {
		if (props.activityState !== "idle") {
			if (!spinnerInterval) {
				spinnerInterval = setInterval(() => {
					setSpinnerFrame((f) => (f + 1) % 8)
				}, 80)
			}
		} else {
			if (spinnerInterval) {
				clearInterval(spinnerInterval)
				spinnerInterval = null
			}
		}
	})

	const handleKeyDown = (e: KeyEvent) => {


		// Autocomplete: up/down navigation, tab/return selection
		if (showAutocomplete()) {
			const items = autocompleteItems()
			if (e.name === "up") {
				setAutocompleteIndex((i) => (i > 0 ? i - 1 : items.length - 1))
				e.preventDefault()
				return
			}
			if (e.name === "down") {
				setAutocompleteIndex((i) => (i < items.length - 1 ? i + 1 : 0))
				e.preventDefault()
				return
			}
			if (e.name === "tab" || e.name === "return") {
				if (applyAutocomplete()) {
					e.preventDefault()
					return
				}
			}
			if (e.name === "escape") {
				setShowAutocomplete(false)
				e.preventDefault()
				return
			}
		}

		// Ctrl+N/Ctrl+P for autocomplete (up/down are consumed by textarea)
		if (showAutocomplete() && e.ctrl && (e.name === "n" || e.name === "p")) {
			const items = autocompleteItems()

			if (e.name === "n") {
				setAutocompleteIndex((i) => (i < items.length - 1 ? i + 1 : 0))
			} else {
				setAutocompleteIndex((i) => (i > 0 ? i - 1 : items.length - 1))
			}

			e.preventDefault()
			return
		}

		// Ctrl+C - abort or exit
		if (e.ctrl && e.name === "c") {
			const now = Date.now()
			if (props.isResponding) {
				props.onAbort()
			} else if (now - lastCtrlC < 750) {
				process.exit(0)
			} else {
				// Clear input on single Ctrl+C when idle
				if (textareaRef) {
					textareaRef.clear()
				}
			}
			lastCtrlC = now
			e.preventDefault()
			return
		}

		// Escape - abort if responding (or cancel retry)
		if (e.name === "escape") {
			if (props.isResponding || props.retryStatus) {
				const restore = props.onAbort()
				if (restore && textareaRef) {
					textareaRef.setText(restore)
				}
				e.preventDefault()
				return
			}
		}

		// Ctrl+O - toggle tool output expansion
		if (e.ctrl && e.name === "o") {
			props.onToggleToolExpand()
			e.preventDefault()
			return
		}

		// Ctrl+T - toggle thinking visibility
		if (e.ctrl && e.name === "t") {
			props.onToggleThinking()
			e.preventDefault()
			return
		}

		// Ctrl+P - cycle model
		if (e.ctrl && e.name === "p") {
			props.onCycleModel()
			e.preventDefault()
			return
		}

		// Shift+Tab - cycle thinking level
		if (e.shift && e.name === "tab") {
			props.onCycleThinking()
			e.preventDefault()
			return
		}

	}



	// Footer helpers
	const getProjectBranch = () => {
		const cwd = process.cwd()
		const project = cwd.split("/").pop() || cwd
		const br = branch()
		return project + (br ? ` (${br})` : "")
	}

	const getContextPct = () => {
		if (props.contextWindow <= 0 || props.contextTokens <= 0) return null
		const pct = (props.contextTokens / props.contextWindow) * 100
		const pctStr = pct < 10 ? pct.toFixed(1) : Math.round(pct).toString()
		const color = pct > 90 ? "#e06c75" : pct > 70 ? "#ffcc00" : colors.dimmed
		return { text: `${pctStr}%`, color }
	}

	const getActivityData = () => {
		if (props.activityState === "idle") return null
		const spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"]
		const spinner = spinners[spinnerFrame()]
		const labels: Record<ActivityState, string> = {
			thinking: "thinking",
			streaming: "streaming",
			tool: "running",
			idle: "",
		}
		const stateColors: Record<ActivityState, string> = {
			thinking: "#b48ead",
			streaming: "#88c0d0",
			tool: "#ebcb8b",
			idle: colors.dimmed,
		}
		return {
			text: `${spinner} ${labels[props.activityState]}`,
			color: stateColors[props.activityState],
		}
	}

	// Build unified content array for deterministic render order
	type ContentItem =
		| { type: "user"; content: string }
		| { type: "thinking"; summary: string; isStreaming?: boolean }
		| { type: "assistant"; content: string; isStreaming?: boolean }
		| { type: "tool"; tool: ToolBlock }

	const contentItems = (): ContentItem[] => {
		const items: ContentItem[] = []
		const renderedToolIds = new Set<string>()
		const messages = props.messages

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i]
			const isLastMessage = i === messages.length - 1

			if (msg.role === "user") {
				items.push({ type: "user", content: msg.content })
			} else if (msg.role === "assistant") {
				// Thinking first
				if (props.thinkingVisible && msg.thinking) {
					items.push({ type: "thinking", summary: msg.thinking.summary, isStreaming: msg.isStreaming })
				}

				// Tools from message
				for (const tool of msg.tools || []) {
					if (!renderedToolIds.has(tool.id)) {
						items.push({ type: "tool", tool })
						renderedToolIds.add(tool.id)
					}
				}

				// For last message, insert orphan toolBlocks BEFORE text content
				if (isLastMessage) {
					for (const tool of props.toolBlocks) {
						if (!renderedToolIds.has(tool.id)) {
							items.push({ type: "tool", tool })
							renderedToolIds.add(tool.id)
						}
					}
				}

				// Then text content
				if (msg.content) {
					items.push({ type: "assistant", content: msg.content, isStreaming: msg.isStreaming })
				}
			}
		}

		return items
	}

	return (
		<box flexDirection="column" width={dimensions().width} height={dimensions().height}>
			{/* Header */}
			<text fg={theme.textMuted}>marvin</text>

			{/* Messages - single For loop for deterministic order */}
			<scrollbox flexGrow={1} flexShrink={1}>
				<box flexDirection="column">
					<For each={contentItems()}>
						{(item) => (
							<box flexDirection="column">
								{item.type === "user" && (
									<box padding={1}>
										<text fg={theme.textMuted}>{"› "}{item.content}</text>
									</box>
								)}
								{item.type === "thinking" && (
									<box paddingLeft={1} paddingRight={1}>
										<text fg="#8a7040">
											{"thinking "}
											<span style={{ fg: theme.textMuted, attributes: TextAttributes.ITALIC }}>
												{item.summary}
											</span>
										</text>
									</box>
								)}
								{item.type === "assistant" && (
									<box padding={1}>
										<text fg={theme.text}>{item.content}</text>
									</box>
								)}
								{item.type === "tool" && (
									<box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
										<ToolBlockComponent
											name={item.tool.name}
											args={item.tool.args}
											output={item.tool.output || null}
											editDiff={item.tool.editDiff || null}
											isError={item.tool.isError}
											isComplete={item.tool.isComplete}
											expanded={props.toolOutputExpanded}
										/>
									</box>
								)}
							</box>
						)}
					</For>
				</box>
			</scrollbox>

			{/* Autocomplete popup */}
			<Show when={showAutocomplete() && autocompleteItems().length > 0}>
				<box
					flexDirection="column"
					border={["top"]}
					borderColor={theme.border}
					paddingLeft={2}
					maxHeight={8}
					flexShrink={0}
				>
					<For each={autocompleteItems()}>
						{(item, i) => {
							const isSelected = createMemo(() => i() === autocompleteIndex())
							return (
								<text fg={isSelected() ? theme.primary : theme.text}>
									{isSelected() ? "→ " : "  "}{item.label}{item.description ? `  ${item.description}` : ""}
								</text>
							)
						}}
					</For>
				</box>
			</Show>

			{/* Input area */}
			<box border={["top"]} borderColor={theme.border} paddingTop={1}>
				<textarea
					ref={(r: TextareaRenderable) => {
						textareaRef = r
						r.focus()
					}}
					placeholder="Ask anything..."
					textColor={theme.text}
					focusedTextColor={theme.text}
					cursorColor={theme.text}
					minHeight={1}
					maxHeight={6}
					keyBindings={[
						{ name: "return", action: "submit" as const },
						{ name: "return", meta: true, action: "newline" as const },
						{ name: "left", action: "move-left" as const },
						{ name: "right", action: "move-right" as const },
						// up/down handled in onKeyDown for autocomplete support
						{ name: "backspace", action: "backspace" as const },
						{ name: "delete", action: "delete" as const },
						{ name: "a", ctrl: true, action: "line-home" as const },
						{ name: "e", ctrl: true, action: "line-end" as const },
						{ name: "k", ctrl: true, action: "delete-to-line-end" as const },
						{ name: "u", ctrl: true, action: "delete-to-line-start" as const },
						{ name: "w", ctrl: true, action: "delete-word-backward" as const },
					]}
					onKeyDown={handleKeyDown}
					onContentChange={() => {

						// Update autocomplete on text change
						if (textareaRef) {
							const text = textareaRef.plainText
							const lines = text.split("\n")
							const cursorLine = lines.length - 1
							const cursorCol = lines[cursorLine]?.length ?? 0
							updateAutocomplete(text, cursorLine, cursorCol)
						}
					}}
					onSubmit={() => {
						if (textareaRef) {
							const ref = textareaRef
							const text = ref.plainText
							props.onSubmit(text, () => ref.clear())
						}
					}}
				/>
			</box>

			{/* Footer */}
			<box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
				<box flexDirection="row" gap={1}>
					<text fg={colors.dimmed}>{getProjectBranch()}</text>
					<text fg={colors.dimmed}>·</text>
					<text fg={theme.text}>{props.modelId}</text>
					<Show when={props.thinking !== "off"}>
						<text fg={colors.dimmed}>·</text>
						<text fg={theme.textMuted}>{props.thinking}</text>
					</Show>
					<Show when={getContextPct()}>
						<text fg={colors.dimmed}>·</text>
						<text fg={getContextPct()!.color}>{getContextPct()!.text}</text>
					</Show>
					<Show when={gitStats() && (gitStats()!.ins > 0 || gitStats()!.del > 0)}>
						<text fg={colors.dimmed}>·</text>
						<text fg="#a3be8c">+{gitStats()!.ins}</text>
						<text fg={colors.dimmed}>/</text>
						<text fg="#bf616a">-{gitStats()!.del}</text>
					</Show>
					<Show when={props.queueCount > 0}>
						<text fg={colors.dimmed}>·</text>
						<text fg="#ebcb8b">{props.queueCount}q</text>
					</Show>
				</box>
				<Show when={props.retryStatus} fallback={
					<Show when={getActivityData()}>
						<text fg={getActivityData()!.color}>{getActivityData()!.text}</text>
					</Show>
				}>
					<text fg="#ebcb8b">{props.retryStatus}</text>
				</Show>
			</box>
		</box>
	)
}



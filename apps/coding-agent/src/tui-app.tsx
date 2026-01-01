/**
 * OpenTUI-based TUI application for coding-agent
 */

import { TextareaRenderable } from "@opentui/core"
import { render, useTerminalDimensions } from "@opentui/solid"
import { createSignal, createEffect, Show, onCleanup, onMount, batch } from "solid-js"
import { CombinedAutocompleteProvider, SelectList, ThemeProvider, ToastViewport, useRenderer, useTheme, type AutocompleteItem, type SelectItem, type ToastItem } from "@marvin-agents/open-tui"
import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens } from "@marvin-agents/agent-core"
import type { AgentEvent, ThinkingLevel, AppMessage } from "@marvin-agents/agent-core"
import { getApiKey, getModels, getProviders, type AgentTool, type Model, type Api } from "@marvin-agents/ai"
import { codingTools } from "@marvin-agents/base-tools"
import { createLspManager, wrapToolsWithLspDiagnostics, type LspManager } from "@marvin-agents/lsp"
import { loadAppConfig, updateAppConfig, type EditorConfig } from "./config.js"
import { openExternalEditor, openFileInEditor } from "./editor.js"
import { createAutocompleteCommands } from "./autocomplete-commands.js"
import { SessionManager, type LoadedSession } from "./session-manager.js"
import { selectSession as selectSessionOpen } from "./session-picker.js"
import { watch, type FSWatcher } from "fs"
import { createPatch } from "diff"

// Extracted modules
import type { UIMessage, ToolBlock, ActivityState, UIContentBlock, UIShellMessage } from "./types.js"
import { findGitHeadPath, getCurrentBranch, extractText, extractThinking, extractToolCalls, extractOrderedBlocks, copyToClipboard, getToolText, getEditDiffText } from "./utils.js"
import { runShellCommand } from "./shell-runner.js"
import { handleSlashCommand, resolveProvider, resolveModel, THINKING_LEVELS, type CommandContext } from "./commands.js"
import { loadCustomCommands, tryExpandCustomCommand, type CustomCommand } from "./custom-commands.js"
import { slashCommands } from "./autocomplete-commands.js"
import { createAgentEventHandler, type EventHandlerContext } from "./agent-events.js"
import { Footer } from "./components/Footer.js"
import { Header } from "./components/Header.js"
import { MessageList } from "./components/MessageList.js"
import { createKeyboardHandler, type KeyboardHandlerConfig } from "./keyboard-handler.js"
import { loadHooks, HookRunner, wrapToolsWithHooks, type HookError } from "./hooks/index.js"
import { loadCustomTools, getToolNames, type SendRef } from "./custom-tools/index.js"

type KnownProvider = ReturnType<typeof getProviders>[number]

const SHELL_INJECTION_PREFIX = "[Shell output]" as const
const MESSAGE_CAP = 75 // Max messages in UI for performance

/** Append to array with cap */
const appendWithCap = <T,>(arr: T[], item: T, cap = MESSAGE_CAP): T[] => {
	const next = [...arr, item]
	return next.length > cap ? next.slice(-cap) : next
}

// ----- Main Entry -----

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

	// Load custom slash commands from ~/.config/marvin/commands/
	const customCommands = loadCustomCommands(loaded.configDir)

	// Load hooks from ~/.config/marvin/hooks/
	const cwd = process.cwd()
	const { hooks, errors: hookErrors } = await loadHooks(loaded.configDir)
	const hookRunner = new HookRunner(hooks, cwd, loaded.configDir)

	// Report hook load errors to stderr (non-fatal)
	for (const { path, error } of hookErrors) {
		process.stderr.write(`Hook load error: ${path}: ${error}\n`)
	}

	// Subscribe to hook runtime errors
	hookRunner.onError((err: HookError) => {
		process.stderr.write(`Hook error [${err.event}] ${err.hookPath}: ${err.error}\n`)
	})

	// Load custom tools from ~/.config/marvin/tools/
	// sendRef starts as no-op, wired up in App component
	const sendRef: SendRef = { current: () => {} }
	const { tools: customTools, errors: toolErrors } = await loadCustomTools(
		loaded.configDir,
		cwd,
		getToolNames(codingTools),
		sendRef,
	)

	// Report tool load errors to stderr (non-fatal)
	for (const { path, error } of toolErrors) {
		process.stderr.write(`Tool load error: ${path}: ${error}\n`)
	}

	// Combine built-in and custom tools, then wrap with hooks for interception
	const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)]
	const lsp = createLspManager({
		cwd,
		configDir: loaded.configDir,
		enabled: loaded.lsp.enabled,
		autoInstall: loaded.lsp.autoInstall,
	})

	// LSP active state - ref populated by App component
	const lspActiveRef = { setActive: (_v: boolean) => {} }
	const tools = wrapToolsWithLspDiagnostics(wrapToolsWithHooks(allTools, hookRunner), lsp, {
		cwd,
		onCheckStart: () => lspActiveRef.setActive(true),
		onCheckEnd: () => lspActiveRef.setActive(false),
	})

	// Build tool metadata registry for custom rendering
	const toolByName = new Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: any; renderResult?: any }>()
	for (const tool of codingTools) {
		toolByName.set(tool.name, { label: tool.label, source: "builtin" })
	}
	for (const { tool, resolvedPath } of customTools) {
		const customTool = tool as any
		toolByName.set(tool.name, {
			label: tool.label,
			source: "custom",
			sourcePath: resolvedPath,
			renderCall: customTool.renderCall,
			renderResult: customTool.renderResult,
		})
	}

	const sessionManager = new SessionManager(loaded.configDir)
	let initialSession: LoadedSession | null = null

	if (args?.resumeSession) {
		const selectedPath = await selectSessionOpen(sessionManager)
		if (selectedPath === null) { process.stdout.write("No session selected\n"); return }
		initialSession = sessionManager.loadSession(selectedPath)
	}
	if (args?.continueSession && !initialSession) {
		initialSession = sessionManager.loadLatest()
	}

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

	// Emit app.start hook event
	await hookRunner.emit({ type: "app.start" })

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
				if (model) { cycleModels.push({ provider: prov as KnownProvider, model }); break }
			}
		}
	}
	if (cycleModels.length === 0) cycleModels.push({ provider: loaded.provider, model: loaded.model })

	render(() => (
		<App agent={agent} sessionManager={sessionManager} initialSession={initialSession}
			modelId={loaded.modelId} model={loaded.model} provider={loaded.provider} thinking={loaded.thinking} theme={loaded.theme} editor={loaded.editor}
			cycleModels={cycleModels} configDir={loaded.configDir} configPath={loaded.configPath}
			codexTransport={codexTransport} getApiKey={getApiKeyForProvider} customCommands={customCommands}
			hookRunner={hookRunner} toolByName={toolByName} lsp={lsp} lspActiveRef={lspActiveRef} sendRef={sendRef} />
	), { targetFps: 30, exitOnCtrlC: false, useKittyKeyboard: {} })
}

// ----- App Component -----

interface AppProps {
	agent: Agent; sessionManager: SessionManager; initialSession: LoadedSession | null
	modelId: string; model: Model<Api>; provider: KnownProvider; thinking: ThinkingLevel; theme: string; editor?: EditorConfig
	cycleModels: Array<{ provider: KnownProvider; model: Model<Api> }>
	configDir: string; configPath: string; codexTransport: CodexTransport
	getApiKey: (provider: string) => string | undefined
	customCommands: Map<string, CustomCommand>
	hookRunner: HookRunner
	toolByName: Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: any; renderResult?: any }>
	lsp: LspManager
	/** Ref for LSP active state - App sets the callback */
	lspActiveRef: { setActive: (v: boolean) => void }
	/** Ref for custom tools send() - App sets the callback */
	sendRef: SendRef
}

function App(props: AppProps) {
	const { agent, sessionManager } = props
	let currentProvider = props.provider, currentModelId = props.modelId, currentThinking = props.thinking
	const [currentTheme, setCurrentTheme] = createSignal(props.theme)
	let cycleIndex = 0, sessionStarted = false

	const ensureSession = () => {
		if (!sessionStarted) {
			sessionManager.startSession(currentProvider, currentModelId, currentThinking)
			sessionStarted = true
			void props.hookRunner.emit({ type: "session.start", sessionId: sessionManager.sessionId })
		}
	}

	const [messages, setMessages] = createSignal<UIMessage[]>([])
	const [toolBlocks, setToolBlocks] = createSignal<ToolBlock[]>([])
	const [isResponding, setIsResponding] = createSignal(false)
	const [activityState, setActivityState] = createSignal<ActivityState>("idle")
	const [thinkingVisible, setThinkingVisible] = createSignal(true)
	const [diffWrapMode, setDiffWrapMode] = createSignal<"word" | "none">("word")
	const [concealMarkdown, setConcealMarkdown] = createSignal(true)
	const [displayModelId, setDisplayModelId] = createSignal(props.modelId)
	const [displayThinking, setDisplayThinking] = createSignal(props.thinking)
	const [displayContextWindow, setDisplayContextWindow] = createSignal(props.model.contextWindow)
	const [contextTokens, setContextTokens] = createSignal(0)
	const [cacheStats, setCacheStats] = createSignal<{ cacheRead: number; input: number } | null>(null)
	const [retryStatus, setRetryStatus] = createSignal<string | null>(null)
	const [turnCount, setTurnCount] = createSignal(0)
	const [lspActive, setLspActive] = createSignal(false)

	// Wire up LSP refs to state
	props.lspActiveRef.setActive = setLspActive

	const queuedMessages: string[] = []
	const [queueCount, setQueueCount] = createSignal(0)
	const retryConfig = { enabled: true, maxRetries: 3, baseDelayMs: 2000 }
	const retryablePattern = /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error/i
	const retryState = { attempt: 0, abortController: null as AbortController | null }
	const streamingMessageIdRef = { current: null as string | null }

	onMount(() => { if (props.initialSession) restoreSession(props.initialSession) })

	const restoreSession = (session: LoadedSession) => {
		const { metadata, messages: sessionMessages } = session
		const resolvedProvider = resolveProvider(metadata.provider)
		if (resolvedProvider) {
			const resolvedModel = resolveModel(resolvedProvider, metadata.modelId)
			if (resolvedModel) {
				currentProvider = resolvedProvider; currentModelId = resolvedModel.id; currentThinking = metadata.thinkingLevel
				agent.setModel(resolvedModel); agent.setThinkingLevel(metadata.thinkingLevel)
				setDisplayModelId(resolvedModel.id); setDisplayThinking(metadata.thinkingLevel); setDisplayContextWindow(resolvedModel.contextWindow)
			}
		}
		agent.replaceMessages(sessionMessages)

		// Rehydrate context tokens from last assistant message's usage
		for (let i = sessionMessages.length - 1; i >= 0; i--) {
			const msg = sessionMessages[i] as { role: string; usage?: { totalTokens?: number } }
			if (msg.role === "assistant" && msg.usage?.totalTokens) {
				setContextTokens(msg.usage.totalTokens)
				break
			}
		}
		// Build a map of toolCallId -> toolResult for matching
		const toolResultMap = new Map<string, { output: string; editDiff: string | null; isError: boolean }>()
		for (const msg of sessionMessages) {
			if (msg.role === "toolResult") {
				toolResultMap.set(msg.toolCallId, {
					output: getToolText(msg),
					editDiff: getEditDiffText(msg),
					isError: msg.isError ?? false,
				})
			}
		}
		const uiMessages: UIMessage[] = []
		for (const msg of sessionMessages) {
			if (msg.role === "user") {
				const contentText = typeof msg.content === "string" ? msg.content : extractText(msg.content as unknown[])
				if (contentText.startsWith(SHELL_INJECTION_PREFIX)) continue
				uiMessages.push({ id: crypto.randomUUID(), role: "user", content: contentText })
			} else if (msg.role === "assistant") {
				const text = extractText(msg.content as unknown[]), thinking = extractThinking(msg.content as unknown[])
				const toolCalls = extractToolCalls(msg.content as unknown[])
				const tools: ToolBlock[] = toolCalls.map((tc) => {
					const result = toolResultMap.get(tc.id)
					const meta = props.toolByName.get(tc.name)
					return {
						id: tc.id,
						name: tc.name,
						args: tc.args,
						output: result?.output,
						editDiff: result?.editDiff || undefined,
						isError: result?.isError ?? false,
						isComplete: true,
						// Reattach tool metadata for custom rendering on restored sessions
						label: meta?.label,
						source: meta?.source,
						sourcePath: meta?.sourcePath,
						renderCall: meta?.renderCall,
						renderResult: meta?.renderResult,
					}
				})
				// Build contentBlocks from ordered API content
				const orderedBlocks = extractOrderedBlocks(msg.content as unknown[])
				const contentBlocks: UIContentBlock[] = orderedBlocks.map((block) => {
					if (block.type === "thinking") {
						return { type: "thinking" as const, id: block.id, summary: block.summary, full: block.full }
					} else if (block.type === "text") {
						return { type: "text" as const, text: block.text }
					} else {
						// toolCall - find full tool from tools array
						const tool = tools.find((t) => t.id === block.id)
						return {
							type: "tool" as const,
							tool: tool || { id: block.id, name: block.name, args: block.args, isError: false, isComplete: false },
						}
					}
				})
				uiMessages.push({ id: crypto.randomUUID(), role: "assistant", content: text, thinking: thinking || undefined, isStreaming: false, tools, contentBlocks })
			} else if ((msg as { role: string }).role === "shell") {
				// Restore shell command messages
				const shellMsg = msg as unknown as { command: string; output: string; exitCode: number | null; truncated: boolean; tempFilePath?: string; timestamp?: number }
				uiMessages.push({
					id: crypto.randomUUID(),
					role: "shell",
					command: shellMsg.command,
					output: shellMsg.output,
					exitCode: shellMsg.exitCode,
					truncated: shellMsg.truncated,
					tempFilePath: shellMsg.tempFilePath,
					timestamp: shellMsg.timestamp,
				})
			}
			// Skip toolResult messages - they're attached to assistant messages via toolResultMap
		}
		setMessages(uiMessages)
		const sessionPath = sessionManager.listSessions().find((s) => s.id === metadata.id)?.path || ""
		sessionManager.continueSession(sessionPath, metadata.id); sessionStarted = true
		void props.hookRunner.emit({ type: "session.resume", sessionId: metadata.id })
	}

	const eventCtx: EventHandlerContext = {
		setMessages: setMessages as (updater: (prev: UIMessage[]) => UIMessage[]) => void,
		setToolBlocks: setToolBlocks as (updater: (prev: ToolBlock[]) => ToolBlock[]) => void,
		setActivityState, setIsResponding, setContextTokens, setCacheStats, setRetryStatus, setTurnCount, setQueueCount,
		queuedMessages, sessionManager, streamingMessageId: streamingMessageIdRef,
		retryConfig, retryablePattern, retryState, agent: agent as EventHandlerContext["agent"],
		hookRunner: props.hookRunner,
		toolByName: props.toolByName,
		getContextWindow: () => displayContextWindow(),
	}
	const handleAgentEvent = createAgentEventHandler(eventCtx)

	createEffect(() => {
		const unsubscribe = agent.subscribe((event: AgentEvent) => { try { handleAgentEvent(event) } catch {} })
		onCleanup(() => { unsubscribe(); handleAgentEvent.dispose() })
	})

	const handleThemeChange = (name: string) => {
		setCurrentTheme(name)
		void updateAppConfig({ configDir: props.configDir }, { theme: name })
	}

	// Ref for exit handler - populated by MainView once renderer is available
	const exitHandlerRef = { current: () => process.exit(0) }
	// Ref for editor handler - populated by MainView once renderer is available
	const editorOpenRef = { current: async () => {} }

	const cmdCtx: CommandContext = {
		agent, sessionManager, configDir: props.configDir, configPath: props.configPath,
		cwd: process.cwd(), editor: props.editor,
		codexTransport: props.codexTransport, getApiKey: props.getApiKey,
		get currentProvider() { return currentProvider }, get currentModelId() { return currentModelId }, get currentThinking() { return currentThinking },
		setCurrentProvider: (p) => { currentProvider = p }, setCurrentModelId: (id) => { currentModelId = id }, setCurrentThinking: (t) => { currentThinking = t },
		isResponding, setIsResponding, setActivityState,
		setMessages: setMessages as CommandContext["setMessages"], setToolBlocks: setToolBlocks as CommandContext["setToolBlocks"],
		setContextTokens, setCacheStats, setDisplayModelId, setDisplayThinking, setDisplayContextWindow, setDiffWrapMode, setConcealMarkdown,
		setTheme: handleThemeChange,
		openEditor: () => editorOpenRef.current(),
		onExit: () => exitHandlerRef.current(),
		hookRunner: props.hookRunner,
	}

	// Set of built-in command names for precedence check
	const builtInCommandNames = new Set(slashCommands.map((c) => c.name))

	const handleSubmit = async (text: string, editorClearFn?: () => void) => {
		if (!text.trim()) return

		// Handle shell commands (! prefix)
		if (text.startsWith("!")) {
			const shouldInject = text.startsWith("!!")
			const command = text.slice(shouldInject ? 2 : 1).trim()
			if (!command) return
			editorClearFn?.()
			ensureSession()

			// Show pending state
			const shellMsgId = crypto.randomUUID()
			const pendingMsg: UIShellMessage = {
				id: shellMsgId,
				role: "shell",
				command,
				output: "",
				exitCode: null,
				truncated: false,
				timestamp: Date.now(),
			}
			setMessages((prev) => appendWithCap(prev, pendingMsg))

			// Execute command
			const result = await runShellCommand(command, { timeout: 30000 })

			// Update message with result
			const finalMsg: UIShellMessage = {
				id: shellMsgId,
				role: "shell",
				command,
				output: result.output,
				exitCode: result.exitCode,
				truncated: result.truncated,
				tempFilePath: result.tempFilePath,
				timestamp: Date.now(),
			}
			setMessages((prev) => prev.map((m) => (m.id === shellMsgId ? finalMsg : m)))

			// Save to session (shell messages stored alongside regular messages)
			sessionManager.appendMessage({
				role: "shell",
				command,
				output: result.output,
				exitCode: result.exitCode,
				truncated: result.truncated,
				tempFilePath: result.tempFilePath,
				timestamp: Date.now(),
			} as unknown as AppMessage)

			if (shouldInject) {
				const injectionLines = [
					SHELL_INJECTION_PREFIX,
					`$ ${command}`,
					result.output,
				]
				if (result.exitCode !== null && result.exitCode !== 0) {
					injectionLines.push(`[exit ${result.exitCode}]`)
				}
				if (result.truncated && result.tempFilePath) {
					injectionLines.push(`[truncated, full output: ${result.tempFilePath}]`)
				}
				const injectedText = injectionLines.filter((line) => line.length > 0).join("\n")
				const injectionMessage: AppMessage = {
					role: "user",
					content: [{ type: "text", text: injectedText }],
					timestamp: Date.now(),
				}
				agent.appendMessage(injectionMessage)
				sessionManager.appendMessage(injectionMessage)
			}

			return
		}

		// Handle slash commands
		if (text.startsWith("/")) {
			const trimmed = text.trim()
			const isEditorCommand = trimmed === "/editor" || trimmed.startsWith("/editor ")
			// Try built-in commands first
			const result = handleSlashCommand(trimmed, cmdCtx)
			if (result instanceof Promise ? await result : result) { if (!isEditorCommand) editorClearFn?.(); return }

			// Try custom command expansion (built-ins already take precedence)
			const expanded = tryExpandCustomCommand(trimmed, builtInCommandNames, props.customCommands)
			if (expanded !== null) {
				// Submit expanded text as regular prompt (recursion-safe since expanded won't start with /)
				editorClearFn?.()
				return handleSubmit(expanded)
			}
		}

		if (isResponding()) {
			queuedMessages.push(text); setQueueCount(queuedMessages.length)
			void agent.queueMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
			editorClearFn?.(); return
		}
		editorClearFn?.(); ensureSession()
		sessionManager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
		batch(() => { setMessages((prev) => appendWithCap(prev, { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() })); setToolBlocks([]); setIsResponding(true); setActivityState("thinking") })
		try { await agent.prompt(text) }
		catch (err) { batch(() => { setMessages((prev) => appendWithCap(prev, { id: crypto.randomUUID(), role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` })); setIsResponding(false); setActivityState("idle") }) }
	}

	// Connect hook send() and custom tools send() to handleSubmit
	props.hookRunner.setSendHandler((text) => void handleSubmit(text))
	props.sendRef.current = (text) => void handleSubmit(text)

	const handleAbort = (): string | null => {
		if (retryState.abortController) { retryState.abortController.abort(); retryState.abortController = null; retryState.attempt = 0; setRetryStatus(null) }
		agent.abort(); agent.clearMessageQueue()
		let restore: string | null = null
		if (queuedMessages.length > 0) { restore = queuedMessages.join("\n"); queuedMessages.length = 0; setQueueCount(0) }
		batch(() => { setIsResponding(false); setActivityState("idle") }); return restore
	}

	const cycleModel = () => {
		if (props.cycleModels.length <= 1) return
		if (isResponding()) return // Prevent mid-stream model switch
		cycleIndex = (cycleIndex + 1) % props.cycleModels.length
		const entry = props.cycleModels[cycleIndex]!
		currentProvider = entry.provider; currentModelId = entry.model.id
		agent.setModel(entry.model); setDisplayModelId(entry.model.id); setDisplayContextWindow(entry.model.contextWindow)
	}

	const cycleThinking = () => {
		const next = THINKING_LEVELS[(THINKING_LEVELS.indexOf(currentThinking) + 1) % THINKING_LEVELS.length]!
		currentThinking = next; agent.setThinkingLevel(next); setDisplayThinking(next)
	}

	return (
		<ThemeProvider mode="dark" themeName={currentTheme()} onThemeChange={handleThemeChange}>
			<MainView messages={messages()} toolBlocks={toolBlocks()} isResponding={isResponding()} activityState={activityState()}
				thinkingVisible={thinkingVisible()} modelId={displayModelId()} thinking={displayThinking()} provider={currentProvider}
				contextTokens={contextTokens()} contextWindow={displayContextWindow()} queueCount={queueCount()} retryStatus={retryStatus()} turnCount={turnCount()} lspActive={lspActive()}
				diffWrapMode={diffWrapMode()} concealMarkdown={concealMarkdown()} customCommands={props.customCommands} onSubmit={handleSubmit} onAbort={handleAbort}
				onToggleThinking={() => setThinkingVisible((v) => !v)} onCycleModel={cycleModel} onCycleThinking={cycleThinking}
				exitHandlerRef={exitHandlerRef} editorOpenRef={editorOpenRef} editor={props.editor} lsp={props.lsp} />
		</ThemeProvider>
	)
}

// ----- MainView -----

interface MainViewProps {
	messages: UIMessage[]; toolBlocks: ToolBlock[]; isResponding: boolean; activityState: ActivityState
	thinkingVisible: boolean; modelId: string; thinking: ThinkingLevel; provider: KnownProvider
	contextTokens: number; contextWindow: number; queueCount: number; retryStatus: string | null; turnCount: number; lspActive: boolean; diffWrapMode: "word" | "none"; concealMarkdown: boolean
	customCommands: Map<string, CustomCommand>
	onSubmit: (text: string, clearFn?: () => void) => void; onAbort: () => string | null
	onToggleThinking: () => void; onCycleModel: () => void; onCycleThinking: () => void
	exitHandlerRef: { current: () => void }
	editorOpenRef: { current: () => Promise<void> | void }
	editor?: EditorConfig
	lsp: LspManager
}

function MainView(props: MainViewProps) {
	const { theme } = useTheme()
	const dimensions = useTerminalDimensions()
	let textareaRef: TextareaRenderable | undefined
	const lastCtrlC = { current: 0 }

	// Autocomplete
	// Build autocomplete commands: built-ins + custom commands
	const builtInAutocomplete = createAutocompleteCommands(() => ({ currentProvider: props.provider }))
	const customAutocomplete = Array.from(props.customCommands.values()).map((cmd) => ({
		name: cmd.name,
		description: cmd.description,
	}))
	const autocompleteProvider = new CombinedAutocompleteProvider([...builtInAutocomplete, ...customAutocomplete], process.cwd())
	const [autocompleteItems, setAutocompleteItems] = createSignal<AutocompleteItem[]>([])
	const [autocompletePrefix, setAutocompletePrefix] = createSignal("")
	const [autocompleteIndex, setAutocompleteIndex] = createSignal(0)
	const [showAutocomplete, setShowAutocomplete] = createSignal(false)
	const [isBashMode, setIsBashMode] = createSignal(false)
	let suppressNextAutocompleteUpdate = false

	const updateAutocomplete = (text: string, cursorLine: number, cursorCol: number) => {
		const lines = text.split("\n")
		const currentLine = lines[cursorLine] ?? ""
		const beforeCursor = currentLine.slice(0, cursorCol)

		if (beforeCursor.trim() === "") {
			setShowAutocomplete(false); setAutocompleteItems([])
			return
		}

		const result = autocompleteProvider.getSuggestions(lines, cursorLine, cursorCol)
		if (result && result.items.length > 0) {
			// Show up to 30 items (covers all themes; files naturally limited by results)
			const prevPrefix = autocompletePrefix(), newItems = result.items.slice(0, 30)
			setAutocompleteItems(newItems); setAutocompletePrefix(result.prefix)
			if (result.prefix !== prevPrefix) setAutocompleteIndex(0); else setAutocompleteIndex((i) => Math.min(i, newItems.length - 1))
			setShowAutocomplete(true)
		} else { setShowAutocomplete(false); setAutocompleteItems([]) }
	}

	const applyAutocomplete = () => {
		if (!showAutocomplete() || !textareaRef) return false
		const items = autocompleteItems(), idx = autocompleteIndex()
		if (idx < 0 || idx >= items.length) return false
		const cursor = textareaRef.logicalCursor
		const text = textareaRef.plainText, lines = text.split("\n")
		const result = autocompleteProvider.applyCompletion(lines, cursor.row, cursor.col, items[idx]!, autocompletePrefix())
		const newText = result.lines.join("\n")
		// If completion wouldn't change text, close autocomplete but return false to allow Enter to pass through
		if (newText === text) {
			setShowAutocomplete(false); setAutocompleteItems([])
			return false
		}
		suppressNextAutocompleteUpdate = true
		textareaRef.replaceText(newText)
		textareaRef.editBuffer.setCursorToLineCol(result.cursorLine, result.cursorCol)
		setShowAutocomplete(false); setAutocompleteItems([])
		return true
	}

	// Git branch & Spinner
	const [branch, setBranch] = createSignal<string | null>(getCurrentBranch())
	const [spinnerFrame, setSpinnerFrame] = createSignal(0)
	let gitWatcher: FSWatcher | null = null, spinnerInterval: ReturnType<typeof setInterval> | null = null

	onMount(() => {
		textareaRef?.focus()
		const gitHeadPath = findGitHeadPath(); if (gitHeadPath) try { gitWatcher = watch(gitHeadPath, () => setBranch(getCurrentBranch())) } catch {}
	})
	onCleanup(() => { if (gitWatcher) gitWatcher.close(); if (spinnerInterval) clearInterval(spinnerInterval) })
	createEffect(() => {
		if (props.activityState !== "idle") { if (!spinnerInterval) spinnerInterval = setInterval(() => setSpinnerFrame((f) => (f + 1) % 8), 200) }
		else { if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null } }
	})
	// Scrollbox handles sticky-follow for new output when already at bottom.

	// Exit handler - cleans up renderer before exit
	const renderer = useRenderer()
	const exitApp = () => {
		try {
			renderer.destroy()
		} finally {
			process.exit(0)
		}
	}
	// Register exit handler with parent so commands can use it
	props.exitHandlerRef.current = exitApp

	// Toasts & Clipboard
	const [toasts, setToasts] = createSignal<ToastItem[]>([])
	const toastTimeouts = new Set<ReturnType<typeof setTimeout>>()
	onCleanup(() => { for (const t of toastTimeouts) clearTimeout(t); toastTimeouts.clear() })

	const pushToast = (toast: Omit<ToastItem, "id">, ttlMs = 2000) => {
		const id = crypto.randomUUID()
		setToasts((prev) => [{ id, ...toast }, ...prev].slice(0, 3))
		const timeout = setTimeout(() => {
			toastTimeouts.delete(timeout)
			setToasts((prev) => prev.filter((t) => t.id !== id))
		}, ttlMs)
		toastTimeouts.add(timeout)
	}
	const copySelectionToClipboard = () => {
		const sel = renderer.getSelection(); if (!sel) return
		const text = sel.getSelectedText(); if (!text || text.length === 0) return
		copyToClipboard(text); pushToast({ title: "Copied to clipboard", variant: "success" }, 1500); renderer.clearSelection()
	}

	const openEditorFromTui = async () => {
		if (!textareaRef) return
		const editor = props.editor ?? { command: "nvim", args: [] }
		setShowAutocomplete(false); setAutocompleteItems([])
		textareaRef.clear()

		try {
			const content = await openExternalEditor({
				editor,
				cwd: process.cwd(),
				renderer,
				initialValue: "",
			})
			if (content === undefined) return
			suppressNextAutocompleteUpdate = true
			textareaRef.setText(content)
			textareaRef.focus()
			const lines = content.split("\n")
			const lastLine = Math.max(0, lines.length - 1)
			const lastCol = lines[lastLine]?.length ?? 0
			textareaRef.editBuffer.setCursorToLineCol(lastLine, lastCol)
			updateAutocomplete(content, lastLine, lastCol)
		} catch (err) {
			pushToast({
				title: "Editor failed",
				message: err instanceof Error ? err.message : String(err),
				variant: "error",
			}, 4000)
		}
	}
	props.editorOpenRef.current = openEditorFromTui

	const handleEditFile = async (filePath: string, line?: number) => {
		// Don't allow while agent is responding
		if (props.isResponding) return

		const editor = props.editor ?? { command: "nvim", args: [] }

		// Snapshot current content
		let beforeContent: string
		try {
			beforeContent = await Bun.file(filePath).text()
		} catch (err) {
			pushToast({ title: `Cannot read file: ${filePath}`, variant: "error" }, 3000)
			return
		}

		// Open editor
		try {
			await openFileInEditor({
				editor,
				filePath,
				line,
				cwd: process.cwd(),
				renderer,
			})
		} catch (err) {
			pushToast({ title: `Editor failed: ${err instanceof Error ? err.message : String(err)}`, variant: "error" }, 3000)
			return
		}

		// Read after
		let afterContent: string
		try {
			afterContent = await Bun.file(filePath).text()
		} catch (err) {
			pushToast({ title: `Cannot read file after edit: ${filePath}`, variant: "error" }, 3000)
			return
		}

		// Compare - if unchanged, do nothing
		if (beforeContent === afterContent) {
			return
		}

		// Compute diff
		const diff = createPatch(filePath, beforeContent, afterContent)
		// Trim header lines, keep from first @@ onwards
		const lines = diff.split("\n")
		const hunkStart = lines.findIndex((l) => l.startsWith("@@"))
		const diffBody = hunkStart >= 0 ? lines.slice(hunkStart).join("\n") : diff

		// Queue message for next turn
		const message = `Modified ${filePath}:\n${diffBody}`
		props.onSubmit(message)

		pushToast({ title: "Edit recorded", variant: "success" }, 1500)
	}

	// Model switch detector - warn on downshifts
	let prevContextWindow = props.contextWindow
	createEffect(() => {
		const newWindow = props.contextWindow
		const oldWindow = prevContextWindow
		prevContextWindow = newWindow

		// Only warn on downshift (switching to smaller context window)
		if (oldWindow <= 0 || newWindow >= oldWindow) return

		const tokens = props.contextTokens
		if (tokens <= 0) return // No usage data yet

		const usagePct = (tokens / newWindow) * 100
		const remaining = newWindow - tokens
		const formatK = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

		if (usagePct > 100) {
			// Overflow - tokens exceed new model's context
			pushToast({
				title: `Context overflow: ${formatK(tokens)}/${formatK(newWindow)}`,
				message: "Run /compact before continuing",
				variant: "error",
			}, 5000)
		} else if (usagePct > 85) {
			// Near limit warning
			pushToast({
				title: `Context near limit: ${formatK(tokens)}/${formatK(newWindow)}`,
				message: `${formatK(remaining)} remaining`,
				variant: "warning",
			}, 4000)
		}
		// No toast for safe switches - header shows context info
	})

	// Expansion state
	const [expandedToolIds, setExpandedToolIds] = createSignal<Set<string>>(new Set())
	const isToolExpanded = (id: string) => expandedToolIds().has(id)
	const toggleToolExpanded = (id: string) => setExpandedToolIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
	const toggleLastToolExpanded = () => { const last = props.toolBlocks[props.toolBlocks.length - 1]; if (last) toggleToolExpanded(last.id) }
	const [expandedThinkingIds, setExpandedThinkingIds] = createSignal<Set<string>>(new Set())
	const isThinkingExpanded = (id: string) => expandedThinkingIds().has(id)
	const toggleThinkingExpanded = (id: string) => setExpandedThinkingIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

	// Keyboard
	const handleKeyDown = createKeyboardHandler({
		showAutocomplete, autocompleteItems, setAutocompleteIndex, setShowAutocomplete, applyAutocomplete,
		isResponding: () => props.isResponding, retryStatus: () => props.retryStatus,
		onAbort: props.onAbort, onToggleThinking: props.onToggleThinking, onCycleModel: props.onCycleModel, onCycleThinking: props.onCycleThinking,
		toggleLastToolExpanded, copySelectionToClipboard,
		clearEditor: () => textareaRef?.clear(), setEditorText: (t) => textareaRef?.setText(t), lastCtrlC,
		onExit: exitApp,
	})

	return (
		<box flexDirection="column" width={dimensions().width} height={dimensions().height}
			onMouseUp={() => { const sel = renderer.getSelection(); if (sel && sel.getSelectedText()) copySelectionToClipboard() }}>
			<Header modelId={props.modelId} thinking={props.thinking} branch={branch()} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
				queueCount={props.queueCount} activityState={props.activityState} retryStatus={props.retryStatus} lspActive={props.lspActive} spinnerFrame={spinnerFrame()} lsp={props.lsp} />
			<scrollbox stickyScroll stickyStart="bottom" flexGrow={props.messages.length > 0 ? 1 : 0} flexShrink={1}>
				<MessageList messages={props.messages} toolBlocks={props.toolBlocks} thinkingVisible={props.thinkingVisible} diffWrapMode={props.diffWrapMode} concealMarkdown={props.concealMarkdown}
					isToolExpanded={isToolExpanded} toggleToolExpanded={toggleToolExpanded} isThinkingExpanded={isThinkingExpanded} toggleThinkingExpanded={toggleThinkingExpanded} onEditFile={handleEditFile} />
			</scrollbox>
			<Show when={showAutocomplete() && autocompleteItems().length > 0}>
				<box flexDirection="column" borderColor={theme.border} maxHeight={15} flexShrink={0}>
					<SelectList
						items={autocompleteItems().map((item): SelectItem => ({
							value: item.value,
							label: item.label,
							description: item.description,
						}))}
						selectedIndex={autocompleteIndex()}
						maxVisible={12}
						width={Math.max(10, dimensions().width - 2)}
					/>
					<text fg={theme.textMuted}>{"   "}↑↓ navigate · Tab select · Esc cancel</text>
				</box>
			</Show>
			<box border={["top"]} borderColor={isBashMode() ? theme.warning : theme.border} paddingTop={1} flexShrink={0}>
				<textarea ref={(r: TextareaRenderable) => { textareaRef = r; r.focus() }} placeholder="" textColor={theme.text} focusedTextColor={theme.text} cursorColor={theme.text} minHeight={1} maxHeight={6}
					keyBindings={[{ name: "return", action: "submit" as const }, { name: "return", meta: true, action: "newline" as const }, { name: "left", action: "move-left" as const }, { name: "right", action: "move-right" as const },
						{ name: "backspace", action: "backspace" as const }, { name: "delete", action: "delete" as const }, { name: "a", ctrl: true, action: "line-home" as const }, { name: "e", ctrl: true, action: "line-end" as const },
						{ name: "k", ctrl: true, action: "delete-to-line-end" as const }, { name: "u", ctrl: true, action: "delete-to-line-start" as const }, { name: "w", ctrl: true, action: "delete-word-backward" as const }]}
					onKeyDown={handleKeyDown}
					onContentChange={() => {
						if (!textareaRef) return
						if (suppressNextAutocompleteUpdate) {
							suppressNextAutocompleteUpdate = false
							return
						}
						const text = textareaRef.plainText
						// Detect bash mode (! prefix)
						setIsBashMode(text.trimStart().startsWith("!"))
						const cursor = textareaRef.logicalCursor
						updateAutocomplete(text, cursor.row, cursor.col)
					}}
					onSubmit={() => {
						if (!textareaRef) return
						props.onSubmit(textareaRef.plainText, () => {
							textareaRef?.clear()
							setIsBashMode(false)
						})
					}} />
			</box>
			<Footer borderColor={isBashMode() ? theme.warning : theme.border} />
			<ToastViewport toasts={toasts()} />
		</box>
	)
}

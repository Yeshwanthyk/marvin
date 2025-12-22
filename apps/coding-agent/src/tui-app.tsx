/**
 * OpenTUI-based TUI application for coding-agent
 */

import { TextareaRenderable, ScrollBoxRenderable } from "@opentui/core"
import { render, useTerminalDimensions } from "@opentui/solid"
import { createSignal, createEffect, createMemo, For, Show, onCleanup, onMount, batch } from "solid-js"
import { ThemeProvider, ToastViewport, useRenderer, useTheme, type ToastItem } from "@marvin-agents/open-tui"
import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens } from "@marvin-agents/agent-core"
import type { AgentEvent, ThinkingLevel, AppMessage } from "@marvin-agents/agent-core"
import { getApiKey, getModels, getProviders, type AgentTool, type Model, type Api } from "@marvin-agents/ai"
import { codingTools } from "@marvin-agents/base-tools"
import { createLspManager, wrapToolsWithLspDiagnostics, type LspManager } from "@marvin-agents/lsp"
import { loadAppConfig, updateAppConfig } from "./config.js"
import { CombinedAutocompleteProvider, type AutocompleteItem } from "@marvin-agents/open-tui"
import { createAutocompleteCommands } from "./autocomplete-commands.js"
import { SessionManager, type LoadedSession } from "./session-manager.js"
import { selectSession as selectSessionOpen } from "./session-picker.js"
import { watch, type FSWatcher } from "fs"

// Extracted modules
import type { UIMessage, ToolBlock, ActivityState, UIContentBlock } from "./types.js"
import { findGitHeadPath, getCurrentBranch, extractText, extractThinking, extractToolCalls, extractOrderedBlocks, copyToClipboard, getToolText, getEditDiffText } from "./utils.js"
import { handleSlashCommand, resolveProvider, resolveModel, THINKING_LEVELS, type CommandContext } from "./commands.js"
import { loadCustomCommands, tryExpandCustomCommand, type CustomCommand } from "./custom-commands.js"
import { slashCommands } from "./autocomplete-commands.js"
import { createAgentEventHandler, type EventHandlerContext } from "./agent-events.js"
import { Footer } from "./components/Footer.js"
import { MessageList } from "./components/MessageList.js"
import { createKeyboardHandler, type KeyboardHandlerConfig } from "./keyboard-handler.js"
import { loadHooks, HookRunner, wrapToolsWithHooks, type HookError } from "./hooks/index.js"
import { loadCustomTools, getToolNames } from "./custom-tools/index.js"

type KnownProvider = ReturnType<typeof getProviders>[number]

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
	const { tools: customTools, errors: toolErrors } = await loadCustomTools(
		loaded.configDir,
		cwd,
		getToolNames(codingTools),
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
	const tools = wrapToolsWithLspDiagnostics(wrapToolsWithHooks(allTools, hookRunner), lsp, { cwd })

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
			modelId={loaded.modelId} model={loaded.model} provider={loaded.provider} thinking={loaded.thinking} theme={loaded.theme}
			cycleModels={cycleModels} configDir={loaded.configDir} configPath={loaded.configPath}
			codexTransport={codexTransport} getApiKey={getApiKeyForProvider} customCommands={customCommands}
			hookRunner={hookRunner} toolByName={toolByName} lsp={lsp} />
	), { targetFps: 30, exitOnCtrlC: false, useKittyKeyboard: {} })
}

// ----- App Component -----

interface AppProps {
	agent: Agent; sessionManager: SessionManager; initialSession: LoadedSession | null
	modelId: string; model: Model<Api>; provider: KnownProvider; thinking: ThinkingLevel; theme: string
	cycleModels: Array<{ provider: KnownProvider; model: Model<Api> }>
	configDir: string; configPath: string; codexTransport: CodexTransport
	getApiKey: (provider: string) => string | undefined
	customCommands: Map<string, CustomCommand>
	hookRunner: HookRunner
	toolByName: Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: any; renderResult?: any }>
	lsp: LspManager
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
	const [displayModelId, setDisplayModelId] = createSignal(props.modelId)
	const [displayThinking, setDisplayThinking] = createSignal(props.thinking)
	const [displayContextWindow, setDisplayContextWindow] = createSignal(props.model.contextWindow)
	const [contextTokens, setContextTokens] = createSignal(0)
	const [retryStatus, setRetryStatus] = createSignal<string | null>(null)
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
				uiMessages.push({ id: crypto.randomUUID(), role: "user", content: typeof msg.content === "string" ? msg.content : extractText(msg.content as unknown[]) })
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
		setActivityState, setIsResponding, setContextTokens, setRetryStatus,
		queuedMessages, setQueueCount, sessionManager, streamingMessageId: streamingMessageIdRef,
		retryConfig, retryablePattern, retryState, agent: agent as EventHandlerContext["agent"],
		hookRunner: props.hookRunner,
		toolByName: props.toolByName,
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

	const cmdCtx: CommandContext = {
		agent, sessionManager, configDir: props.configDir, configPath: props.configPath,
		codexTransport: props.codexTransport, getApiKey: props.getApiKey,
		get currentProvider() { return currentProvider }, get currentModelId() { return currentModelId }, get currentThinking() { return currentThinking },
		setCurrentProvider: (p) => { currentProvider = p }, setCurrentModelId: (id) => { currentModelId = id }, setCurrentThinking: (t) => { currentThinking = t },
		isResponding, setIsResponding, setActivityState,
		setMessages: setMessages as CommandContext["setMessages"], setToolBlocks: setToolBlocks as CommandContext["setToolBlocks"],
		setContextTokens, setDisplayModelId, setDisplayThinking, setDisplayContextWindow, setDiffWrapMode,
		setTheme: handleThemeChange,
		hookRunner: props.hookRunner,
	}

	// Set of built-in command names for precedence check
	const builtInCommandNames = new Set(slashCommands.map((c) => c.name))

	const handleSubmit = async (text: string, editorClearFn?: () => void) => {
		if (!text.trim()) return

		// Handle slash commands
		if (text.startsWith("/")) {
			// Try built-in commands first
			const result = handleSlashCommand(text.trim(), cmdCtx)
			if (result instanceof Promise ? await result : result) { editorClearFn?.(); return }

			// Try custom command expansion (built-ins already take precedence)
			const expanded = tryExpandCustomCommand(text.trim(), builtInCommandNames, props.customCommands)
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
		batch(() => { setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() }]); setToolBlocks([]); setIsResponding(true); setActivityState("thinking") })
		try { await agent.prompt(text) }
		catch (err) { batch(() => { setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` }]); setIsResponding(false); setActivityState("idle") }) }
	}

	// Connect hook send() to handleSubmit
	props.hookRunner.setSendHandler((text) => void handleSubmit(text))

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
				contextTokens={contextTokens()} contextWindow={displayContextWindow()} queueCount={queueCount()} retryStatus={retryStatus()}
				diffWrapMode={diffWrapMode()} customCommands={props.customCommands} onSubmit={handleSubmit} onAbort={handleAbort}
				onToggleThinking={() => setThinkingVisible((v) => !v)} onCycleModel={cycleModel} onCycleThinking={cycleThinking} lsp={props.lsp} />
		</ThemeProvider>
	)
}

// ----- MainView -----

interface MainViewProps {
	messages: UIMessage[]; toolBlocks: ToolBlock[]; isResponding: boolean; activityState: ActivityState
	thinkingVisible: boolean; modelId: string; thinking: ThinkingLevel; provider: KnownProvider
	contextTokens: number; contextWindow: number; queueCount: number; retryStatus: string | null; diffWrapMode: "word" | "none"
	customCommands: Map<string, CustomCommand>
	onSubmit: (text: string, clearFn?: () => void) => void; onAbort: () => string | null
	onToggleThinking: () => void; onCycleModel: () => void; onCycleThinking: () => void
	lsp: LspManager
}

function MainView(props: MainViewProps) {
	const { theme } = useTheme()
	const dimensions = useTerminalDimensions()
	let textareaRef: TextareaRenderable | undefined
	let scrollRef: ScrollBoxRenderable | undefined
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

	const updateAutocomplete = (text: string, cursorLine: number, cursorCol: number) => {
		const result = autocompleteProvider.getSuggestions(text.split("\n"), cursorLine, cursorCol)
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
	// Scroll only when message count increases (not on every reactive change)
	let prevMsgCount = 0, prevToolCount = 0
	createEffect(() => {
		const msgCount = props.messages.length, toolCount = props.toolBlocks.length
		if (msgCount > prevMsgCount || toolCount > prevToolCount) {
			prevMsgCount = msgCount; prevToolCount = toolCount
			if (scrollRef) scrollRef.scrollBy(100_000)
		}
	})

	// Toasts & Clipboard
	const renderer = useRenderer()
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
			// Overflow - critical
			pushToast({
				title: `Context overflow: ${formatK(tokens)}/${formatK(newWindow)} (${Math.round(usagePct)}%)`,
				message: "Run /compact before continuing",
				variant: "error",
			}, 5000)
		} else if (usagePct > 85) {
			// Warning threshold
			pushToast({
				title: `Context near limit: ${formatK(tokens)}/${formatK(newWindow)} (${Math.round(usagePct)}%)`,
				message: `${formatK(remaining)} remaining`,
				variant: "warning",
			}, 4000)
		} else {
			// Info - context window changed
			pushToast({
				title: `Context window: ${formatK(oldWindow)} → ${formatK(newWindow)}`,
				message: `${Math.round(usagePct)}% used`,
				variant: "info",
			}, 3000)
		}
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
	})

	return (
		<box flexDirection="column" width={dimensions().width} height={dimensions().height}
			onMouseUp={() => { const sel = renderer.getSelection(); if (sel && sel.getSelectedText()) copySelectionToClipboard() }}>
			<text fg={theme.textMuted}>marvin</text>
			<scrollbox ref={(r: ScrollBoxRenderable) => { scrollRef = r }} flexGrow={props.messages.length > 0 ? 1 : 0} flexShrink={1}>
				<MessageList messages={props.messages} toolBlocks={props.toolBlocks} thinkingVisible={props.thinkingVisible} diffWrapMode={props.diffWrapMode}
					isToolExpanded={isToolExpanded} toggleToolExpanded={toggleToolExpanded} isThinkingExpanded={isThinkingExpanded} toggleThinkingExpanded={toggleThinkingExpanded} />
			</scrollbox>
			<Show when={showAutocomplete() && autocompleteItems().length > 0}>
				<box flexDirection="column" borderColor={theme.border} maxHeight={15} flexShrink={0}>
					<For each={autocompleteItems().filter(item => item && typeof item === "object")}>{(item, i) => {
						const isSelected = createMemo(() => i() === autocompleteIndex())
						const label = String(item.label ?? item.value ?? "")
						const descRaw = item.description
						// Truncate description from start to show relevant end (filename context)
						const maxDescLen = Math.max(0, dimensions().width - label.length - 8)
						const desc = typeof descRaw === "string" && descRaw && descRaw !== label
							? (descRaw.length > maxDescLen ? "…" + descRaw.slice(-(maxDescLen - 1)) : descRaw)
							: ""
						// Fixed-width label column for alignment
						const labelCol = label.length < 24 ? label + " ".repeat(24 - label.length) : label.slice(0, 23) + "…"
						// Reactive getters for selection-dependent values
						const prefix = () => isSelected() ? " → " : "   "
						const line = () => prefix() + labelCol + (desc ? " " + desc : "")
						const pad = () => " ".repeat(Math.max(0, dimensions().width - line().length))
						return (
							<Show when={isSelected} fallback={
								<text>
									<span style={{ fg: theme.textMuted }}>{prefix()}</span>
									<span style={{ fg: theme.text }}>{labelCol}</span>
									<span style={{ fg: theme.textMuted }}>{desc ? " " + desc : ""}</span>
								</text>
							}>
								<text fg={theme.selectionFg} bg={theme.selectionBg} attributes={1 /* BOLD */}>{line() + pad()}</text>
							</Show>
						)
					}}</For>
					<text fg={theme.textMuted}>{"   "}↑↓ navigate · Tab select · Esc cancel</text>
				</box>
			</Show>
			<box border={["top"]} borderColor={theme.border} paddingTop={1} flexShrink={0}>
				<textarea ref={(r: TextareaRenderable) => { textareaRef = r; r.focus() }} placeholder="Ask anything..." textColor={theme.text} focusedTextColor={theme.text} cursorColor={theme.text} minHeight={1} maxHeight={6}
					keyBindings={[{ name: "return", action: "submit" as const }, { name: "return", meta: true, action: "newline" as const }, { name: "left", action: "move-left" as const }, { name: "right", action: "move-right" as const },
						{ name: "backspace", action: "backspace" as const }, { name: "delete", action: "delete" as const }, { name: "a", ctrl: true, action: "line-home" as const }, { name: "e", ctrl: true, action: "line-end" as const },
						{ name: "k", ctrl: true, action: "delete-to-line-end" as const }, { name: "u", ctrl: true, action: "delete-to-line-start" as const }, { name: "w", ctrl: true, action: "delete-word-backward" as const }]}
					onKeyDown={handleKeyDown}
					onContentChange={() => { if (textareaRef) { const text = textareaRef.plainText; if (!text.startsWith("/") && !text.includes("@")) { setShowAutocomplete(false); return }; const cursor = textareaRef.logicalCursor; updateAutocomplete(text, cursor.row, cursor.col) } }}
					onSubmit={() => { if (textareaRef) { const ref = textareaRef; props.onSubmit(ref.plainText, () => ref.clear()) } }} />
			</box>
			<Footer modelId={props.modelId} thinking={props.thinking} branch={branch()} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
				queueCount={props.queueCount} activityState={props.activityState} retryStatus={props.retryStatus} spinnerFrame={spinnerFrame()} lsp={props.lsp} />
			<ToastViewport toasts={toasts()} />
		</box>
	)
}

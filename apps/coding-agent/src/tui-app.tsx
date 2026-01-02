/**
 * OpenTUI-based TUI application for coding-agent
 */

import { TextareaRenderable } from "@opentui/core"
import { render, useTerminalDimensions } from "@opentui/solid"
import { createSignal, createEffect, Show, onMount, batch } from "solid-js"
import { CombinedAutocompleteProvider, SelectList, ThemeProvider, ToastViewport, useRenderer, useTheme, type AutocompleteItem, type SelectItem } from "@marvin-agents/open-tui"
import type { ThinkingLevel, AppMessage } from "@marvin-agents/agent-core"
import type { KnownProvider } from "@marvin-agents/ai"
import type { LspManager } from "@marvin-agents/lsp"
import { updateAppConfig, type EditorConfig } from "./config.js"
import { createAutocompleteCommands, slashCommands } from "./autocomplete-commands.js"
import type { LoadedSession } from "./session-manager.js"
import { selectSession as selectSessionOpen } from "./session-picker.js"
import type { UIMessage, ToolBlock, ActivityState, UIContentBlock, UIShellMessage } from "./types.js"
import { extractText, extractThinking, extractToolCalls, extractOrderedBlocks, copyToClipboard, getToolText, getEditDiffText, appendWithCap } from "./utils.js"
import { runShellCommand } from "./shell-runner.js"
import { handleSlashCommand, THINKING_LEVELS, type CommandContext } from "./commands.js"
import { tryExpandCustomCommand, type CustomCommand } from "./custom-commands.js"
import type { EventHandlerContext } from "./agent-events.js"
import { Footer } from "./components/Footer.js"
import { Header } from "./components/Header.js"
import { MessageList } from "./components/MessageList.js"
import { createKeyboardHandler, type KeyboardHandlerConfig } from "./keyboard-handler.js"
import { RuntimeProvider, useRuntime } from "./runtime/context.js"
import { createRuntime, type RunTuiArgs } from "./runtime/create-runtime.js"
import { createSessionController } from "./hooks/useSessionController.js"
import { createPromptQueue } from "./hooks/usePromptQueue.js"
import { useAgentEvents } from "./hooks/useAgentEvents.js"
import { useGitStatus } from "./hooks/useGitStatus.js"
import { useSpinner } from "./hooks/useSpinner.js"
import { useToastManager } from "./hooks/useToastManager.js"
import { useEditorBridge } from "./hooks/useEditorBridge.js"

const SHELL_INJECTION_PREFIX = "[Shell output]" as const

// ----- Main Entry -----

export const runTuiOpen = async (args?: RunTuiArgs) => {
	const runtime = await createRuntime(args)
	const { sessionManager } = runtime
	let initialSession: LoadedSession | null = null

	if (args?.resumeSession) {
		const selectedPath = await selectSessionOpen(sessionManager)
		if (selectedPath === null) {
			process.stdout.write("No session selected\n")
			return
		}
		initialSession = sessionManager.loadSession(selectedPath)
	}

	if (args?.continueSession && !initialSession) {
		initialSession = sessionManager.loadLatest()
	}

	render(
		() => (
			<RuntimeProvider runtime={runtime}>
				<App initialSession={initialSession} />
			</RuntimeProvider>
		),
		{ targetFps: 30, exitOnCtrlC: false, useKittyKeyboard: {} },
	)
}

// ----- App Component -----


interface AppProps {
	initialSession: LoadedSession | null
}

function App({ initialSession }: AppProps) {
	const runtime = useRuntime()
	const {
		agent,
		sessionManager,
		hookRunner,
		toolByName,
		lsp,
		lspActiveRef,
		sendRef,
		customCommands,
		config,
		codexTransport,
		getApiKey,
		cycleModels,
	} = runtime

	const [currentTheme, setCurrentTheme] = createSignal(config.theme)
	const [messages, setMessages] = createSignal<UIMessage[]>([])
	const [toolBlocks, setToolBlocks] = createSignal<ToolBlock[]>([])
	const [isResponding, setIsResponding] = createSignal(false)
	const [activityState, setActivityState] = createSignal<ActivityState>("idle")
	const [thinkingVisible, setThinkingVisible] = createSignal(true)
	const [diffWrapMode, setDiffWrapMode] = createSignal<"word" | "none">("word")
	const [concealMarkdown, setConcealMarkdown] = createSignal(true)
	const [displayModelId, setDisplayModelId] = createSignal(config.modelId)
	const [displayThinking, setDisplayThinking] = createSignal(config.thinking)
	const [displayContextWindow, setDisplayContextWindow] = createSignal(config.model.contextWindow)
const [contextTokens, setContextTokens] = createSignal(0)
const [cacheStats, setCacheStats] = createSignal<{ cacheRead: number; input: number } | null>(null)
const [retryStatus, setRetryStatus] = createSignal<string | null>(null)
const [turnCount, setTurnCount] = createSignal(0)
const [lspActive, setLspActive] = createSignal(false)
const [queueCount, setQueueCount] = createSignal(0)
const [currentProvider, setCurrentProviderSignal] = createSignal(config.provider)

	lspActiveRef.setActive = setLspActive

	const promptQueue = createPromptQueue(setQueueCount)
	const retryConfig = { enabled: true, maxRetries: 3, baseDelayMs: 2000 }
	const retryablePattern = /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error/i
	const retryState = { attempt: 0, abortController: null as AbortController | null }
	const streamingMessageIdRef = { current: null as string | null }

const sessionController = createSessionController({
	initialProvider: config.provider,
	initialModel: config.model,
	initialModelId: config.modelId,
	initialThinking: config.thinking,
		agent,
		sessionManager,
		hookRunner,
	toolByName,
	setMessages: setMessages as (updater: (prev: UIMessage[]) => UIMessage[]) => void,
	setContextTokens,
	setDisplayProvider: setCurrentProviderSignal,
	setDisplayModelId,
	setDisplayThinking,
	setDisplayContextWindow,
		shellInjectionPrefix: SHELL_INJECTION_PREFIX,
})

onMount(() => {
	if (initialSession) sessionController.restoreSession(initialSession)
})

const ensureSession = () => {
	sessionController.ensureSession()
}

let cycleIndex = cycleModels.findIndex(
	(entry) => entry.model.id === config.modelId && entry.provider === config.provider,
)
if (cycleIndex < 0) cycleIndex = 0

	const eventCtx: EventHandlerContext = {
		setMessages: setMessages as (updater: (prev: UIMessage[]) => UIMessage[]) => void,
		setToolBlocks: setToolBlocks as (updater: (prev: ToolBlock[]) => ToolBlock[]) => void,
		setActivityState,
		setIsResponding,
		setContextTokens,
		setCacheStats,
		setRetryStatus,
		setTurnCount,
		promptQueue,
		sessionManager,
		streamingMessageId: streamingMessageIdRef,
		retryConfig,
		retryablePattern,
		retryState,
		agent: agent as EventHandlerContext["agent"],
		hookRunner,
		toolByName,
		getContextWindow: () => displayContextWindow(),
	}

	useAgentEvents({ agent, context: eventCtx })

	const handleThemeChange = (name: string) => {
		setCurrentTheme(name)
		void updateAppConfig({ configDir: config.configDir, configPath: config.configPath }, { theme: name })
	}

	const exitHandlerRef = { current: () => process.exit(0) }
	const editorOpenRef = { current: async () => {} }

	const cmdCtx: CommandContext = {
		agent,
		sessionManager,
		configDir: config.configDir,
		configPath: config.configPath,
		cwd: process.cwd(),
		editor: config.editor,
		codexTransport,
		getApiKey,
		get currentProvider() { return sessionController.currentProvider() },
		get currentModelId() { return sessionController.currentModelId() },
		get currentThinking() { return sessionController.currentThinking() },
		setCurrentProvider: (p) => sessionController.setCurrentProvider(p),
		setCurrentModelId: (id) => sessionController.setCurrentModelId(id),
		setCurrentThinking: (t) => sessionController.setCurrentThinking(t),
		isResponding,
		setIsResponding,
		setActivityState,
		setMessages: setMessages as CommandContext["setMessages"],
		setToolBlocks: setToolBlocks as CommandContext["setToolBlocks"],
		setContextTokens,
		setCacheStats,
		setDisplayModelId,
		setDisplayThinking,
		setDisplayContextWindow,
		setDiffWrapMode,
		setConcealMarkdown,
		setTheme: handleThemeChange,
		openEditor: () => editorOpenRef.current(),
		onExit: () => exitHandlerRef.current(),
		hookRunner,
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
			const expanded = tryExpandCustomCommand(trimmed, builtInCommandNames, customCommands)
			if (expanded !== null) {
				// Submit expanded text as regular prompt (recursion-safe since expanded won't start with /)
				editorClearFn?.()
				return handleSubmit(expanded)
			}
		}

		if (isResponding()) {
			promptQueue.push(text)
			void agent.queueMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
			editorClearFn?.()
			return
		}
		editorClearFn?.()
		ensureSession()
		sessionManager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
		batch(() => { setMessages((prev) => appendWithCap(prev, { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() })); setToolBlocks([]); setIsResponding(true); setActivityState("thinking") })
		try { await agent.prompt(text) }
		catch (err) { batch(() => { setMessages((prev) => appendWithCap(prev, { id: crypto.randomUUID(), role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` })); setIsResponding(false); setActivityState("idle") }) }
	}

	// Connect hook send() and custom tools send() to handleSubmit
	hookRunner.setSendHandler((text) => void handleSubmit(text))
	sendRef.current = (text) => void handleSubmit(text)

	const handleAbort = (): string | null => {
		if (retryState.abortController) {
			retryState.abortController.abort()
			retryState.abortController = null
			retryState.attempt = 0
			setRetryStatus(null)
		}
		agent.abort()
		agent.clearMessageQueue()
		const restore = promptQueue.drainToText()
		batch(() => { setIsResponding(false); setActivityState("idle") })
		return restore
	}

	const cycleModel = () => {
		if (cycleModels.length <= 1) return
		if (isResponding()) return
		cycleIndex = (cycleIndex + 1) % cycleModels.length
		const entry = cycleModels[cycleIndex]!
		sessionController.setCurrentProvider(entry.provider)
		sessionController.setCurrentModelId(entry.model.id)
		agent.setModel(entry.model)
		setDisplayModelId(entry.model.id)
		setDisplayContextWindow(entry.model.contextWindow)
	}

	const cycleThinking = () => {
		const current = sessionController.currentThinking()
		const next = THINKING_LEVELS[(THINKING_LEVELS.indexOf(current) + 1) % THINKING_LEVELS.length]!
		sessionController.setCurrentThinking(next)
		agent.setThinkingLevel(next)
		setDisplayThinking(next)
	}

	return (
		<ThemeProvider mode="dark" themeName={currentTheme()} onThemeChange={handleThemeChange}>
			<MainView messages={messages()} toolBlocks={toolBlocks()} isResponding={isResponding()} activityState={activityState()}
				thinkingVisible={thinkingVisible()} modelId={displayModelId()} thinking={displayThinking()} provider={currentProvider()}
				contextTokens={contextTokens()} contextWindow={displayContextWindow()} queueCount={queueCount()} retryStatus={retryStatus()} turnCount={turnCount()} lspActive={lspActive()}
				diffWrapMode={diffWrapMode()} concealMarkdown={concealMarkdown()} customCommands={customCommands} onSubmit={handleSubmit} onAbort={handleAbort}
				onToggleThinking={() => setThinkingVisible((v) => !v)} onCycleModel={cycleModel} onCycleThinking={cycleThinking}
				exitHandlerRef={exitHandlerRef} editorOpenRef={editorOpenRef} editor={config.editor} lsp={lsp} />
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
	const branch = useGitStatus()
	const spinnerFrame = useSpinner(() => props.activityState)
	const renderer = useRenderer()
	const { toasts, pushToast } = useToastManager()
	const { openBuffer, editFile } = useEditorBridge({
		editor: props.editor,
		renderer,
		pushToast,
		isResponding: () => props.isResponding,
		onSubmit: (text) => props.onSubmit(text),
	})

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

	onMount(() => {
		textareaRef?.focus()
	})
	// Scrollbox handles sticky-follow for new output when already at bottom.

	// Exit handler - cleans up renderer before exit
	const exitApp = () => {
		try {
			renderer.destroy()
		} finally {
			process.exit(0)
		}
	}
	// Register exit handler with parent so commands can use it
	props.exitHandlerRef.current = exitApp

	const copySelectionToClipboard = () => {
		const sel = renderer.getSelection(); if (!sel) return
		const text = sel.getSelectedText(); if (!text || text.length === 0) return
		copyToClipboard(text); pushToast({ title: "Copied to clipboard", variant: "success" }, 1500); renderer.clearSelection()
	}

	const openEditorFromTui = async () => {
		if (!textareaRef) return
		setShowAutocomplete(false); setAutocompleteItems([])
		textareaRef.clear()

		const content = await openBuffer("")
		if (content === undefined) return
		suppressNextAutocompleteUpdate = true
		textareaRef.setText(content)
		textareaRef.focus()
		const lines = content.split("\n")
		const lastLine = Math.max(0, lines.length - 1)
		const lastCol = lines[lastLine]?.length ?? 0
		textareaRef.editBuffer.setCursorToLineCol(lastLine, lastCol)
		updateAutocomplete(content, lastLine, lastCol)
	}
	props.editorOpenRef.current = openEditorFromTui

	const handleEditFile = (filePath: string, line?: number) => {
		void editFile(filePath, line)
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

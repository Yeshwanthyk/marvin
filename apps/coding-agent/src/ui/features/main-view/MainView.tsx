import { TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import {
	CombinedAutocompleteProvider,
	ToastViewport,
	copyToClipboard,
	useRenderer,
	useTheme,
	type AutocompleteItem,
} from "@yeshwanthyk/open-tui"
import type { ThinkingLevel } from "@yeshwanthyk/agent-core"
import type { KnownProvider } from "@yeshwanthyk/ai"
import type { LspManager } from "@yeshwanthyk/lsp"
import { createSignal, createEffect, onMount } from "solid-js"
import { createAutocompleteCommands } from "../../../autocomplete-commands.js"
import type { CustomCommand } from "@yeshwanthyk/runtime-effect/extensibility/custom-commands.js"
import { Footer } from "../../../components/Footer.js"
import { Header } from "../../../components/Header.js"
import type { ActivityState, ToolBlock, UIMessage } from "../../../types.js"
import type { QueueCounts } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import { useGitStatus } from "../../../hooks/useGitStatus.js"
import { useSpinner } from "../../../hooks/useSpinner.js"
import { useToastManager } from "../../../hooks/useToastManager.js"
import { useEditorBridge } from "../../../hooks/useEditorBridge.js"
import { MessagePane } from "../message-pane/MessagePane.js"
import { Composer } from "../composer/Composer.js"
import { createComposerKeyboardHandler } from "../composer/keyboard.js"
import type { ValidationIssue } from "@ext/schema.js"

export interface MainViewProps {
	validationIssues?: ValidationIssue[]
	messages: UIMessage[]
	toolBlocks: ToolBlock[]
	isResponding: boolean
	activityState: ActivityState
	thinkingVisible: boolean
	modelId: string
	thinking: ThinkingLevel
	provider: KnownProvider
	contextTokens: number
	contextWindow: number
	queueCounts: QueueCounts
	retryStatus: string | null
	turnCount: number
	lspActive: boolean
	diffWrapMode: "word" | "none"
	concealMarkdown: boolean
	customCommands: Map<string, CustomCommand>
	onSubmit: (text: string, clearFn?: () => void) => void
	onAbort: () => string | null
	onToggleThinking: () => void
	onCycleModel: () => void
	onCycleThinking: () => void
	exitHandlerRef: { current: () => void }
	editorOpenRef: { current: () => Promise<void> | void }
	setEditorTextRef: { current: (text: string) => void }
	getEditorTextRef: { current: () => string }
	showToastRef: { current: (title: string, message: string, variant?: "info" | "warning" | "success" | "error") => void }
	clearEditorRef: { current: () => void }
	onBeforeExit?: () => Promise<void>
	editor?: import("../../../config.js").EditorConfig
	lsp: LspManager
}

export function MainView(props: MainViewProps) {
	const { theme } = useTheme()
	const dimensions = useTerminalDimensions()
	let textareaRef: TextareaRenderable | undefined
	const lastCtrlC = { current: 0 }
	const branch = useGitStatus()
	const spinnerFrame = useSpinner(() => props.activityState)
	const renderer = useRenderer()
	const { toasts, pushToast } = useToastManager()
	const shownValidationKeys = new Set<string>()
	createEffect(() => {
		const issues = props.validationIssues ?? []
		const showList = issues.slice(0, 3)
		for (const issue of showList) {
			const key = `${issue.severity}:${issue.path}:${issue.message}`
			if (shownValidationKeys.has(key)) continue
			shownValidationKeys.add(key)
			console.error(`[marvin][extension][${issue.kind}] ${issue.path}: ${issue.message}`)
			pushToast(
				{
					title: issue.severity === "error" ? "Extension error" : "Extension warning",
					message: `${issue.path}: ${issue.message}`,
					variant: issue.severity === "error" ? "error" : "warning",
				},
				6000,
			)
		}
	})
	const { openBuffer, editFile } = useEditorBridge({
		editor: props.editor,
		renderer,
		pushToast,
		isResponding: () => props.isResponding,
		onSubmit: (text) => props.onSubmit(text),
	})

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
			setShowAutocomplete(false)
			setAutocompleteItems([])
			return
		}

		const result = autocompleteProvider.getSuggestions(lines, cursorLine, cursorCol)
		if (result && result.items.length > 0) {
			const prevPrefix = autocompletePrefix()
			const newItems = result.items.slice(0, 30)
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
		const cursor = textareaRef.logicalCursor
		const text = textareaRef.plainText
		const lines = text.split("\n")
		const result = autocompleteProvider.applyCompletion(lines, cursor.row, cursor.col, items[idx]!, autocompletePrefix())
		const newText = result.lines.join("\n")
		if (newText === text) {
			setShowAutocomplete(false)
			setAutocompleteItems([])
			return false
		}
		suppressNextAutocompleteUpdate = true
		textareaRef.replaceText(newText)
		textareaRef.editBuffer.setCursorToLineCol(result.cursorLine, result.cursorCol)
		setShowAutocomplete(false)
		setAutocompleteItems([])
		return true
	}

	onMount(() => {
		textareaRef?.focus()
	})

	const exitApp = async () => {
		try {
			renderer.destroy()
			await props.onBeforeExit?.()
		} finally {
			process.exit(0)
		}
	}
	props.exitHandlerRef.current = exitApp
	props.setEditorTextRef.current = (text: string) => textareaRef?.setText(text)
	props.getEditorTextRef.current = () => textareaRef?.plainText ?? ""
	props.clearEditorRef.current = () => {
		textareaRef?.clear()
		setIsBashMode(false)
	}
	props.showToastRef.current = (title, message, variant = "info") => {
		pushToast({ title, message, variant }, 3000)
	}

	const copySelectionToClipboard = () => {
		const sel = renderer.getSelection()
		if (!sel) return
		const text = sel.getSelectedText()
		if (!text || text.length === 0) return
		copyToClipboard(text)
		pushToast({ title: "Copied to clipboard", variant: "success" }, 1500)
		renderer.clearSelection()
	}

	const openEditorFromTui = async () => {
		if (!textareaRef) return
		setShowAutocomplete(false)
		setAutocompleteItems([])
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

	let prevContextWindow = props.contextWindow
	createEffect(() => {
		const newWindow = props.contextWindow
		const oldWindow = prevContextWindow
		prevContextWindow = newWindow
		if (oldWindow <= 0 || newWindow >= oldWindow) return

		const tokens = props.contextTokens
		if (tokens <= 0) return

		const usagePct = (tokens / newWindow) * 100
		const remaining = newWindow - tokens
		const formatK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

		if (usagePct > 100) {
			pushToast(
				{
					title: `Context overflow: ${formatK(tokens)}/${formatK(newWindow)}`,
					message: "Run /compact before continuing",
					variant: "error",
				},
				5000,
			)
		} else if (usagePct > 85) {
			pushToast(
				{
					title: `Context near limit: ${formatK(tokens)}/${formatK(newWindow)}`,
					message: `${formatK(remaining)} remaining`,
					variant: "warning",
				},
				4000,
			)
		}
	})

	const [expandedToolIds, setExpandedToolIds] = createSignal<Set<string>>(new Set())
	const isToolExpanded = (id: string) => expandedToolIds().has(id)
	const toggleToolExpanded = (id: string) =>
		setExpandedToolIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	const toggleLastToolExpanded = () => {
		const last = props.toolBlocks[props.toolBlocks.length - 1]
		if (last) toggleToolExpanded(last.id)
	}

	const [expandedThinkingIds, setExpandedThinkingIds] = createSignal<Set<string>>(new Set())
	const isThinkingExpanded = (id: string) => expandedThinkingIds().has(id)
	const toggleThinkingExpanded = (id: string) =>
		setExpandedThinkingIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})

	const handleKeyDown = createComposerKeyboardHandler({
		showAutocomplete,
		autocompleteItems,
		setAutocompleteIndex,
		setShowAutocomplete,
		applyAutocomplete,
		isResponding: () => props.isResponding,
		retryStatus: () => props.retryStatus,
		onAbort: props.onAbort,
		onToggleThinking: props.onToggleThinking,
		onCycleModel: props.onCycleModel,
		onCycleThinking: props.onCycleThinking,
		toggleLastToolExpanded,
		copySelectionToClipboard,
		clearEditor: () => textareaRef?.clear(),
		setEditorText: (text) => textareaRef?.setText(text),
		lastCtrlC,
		onExit: exitApp,
	})

	const handleComposerContentChange = () => {
		if (!textareaRef) return
		if (suppressNextAutocompleteUpdate) {
			suppressNextAutocompleteUpdate = false
			return
		}
		const text = textareaRef.plainText
		setIsBashMode(text.trimStart().startsWith("!"))
		const cursor = textareaRef.logicalCursor
		updateAutocomplete(text, cursor.row, cursor.col)
	}

	return (
		<box
			flexDirection="column"
			width={dimensions().width}
			height={dimensions().height}
			onMouseUp={() => {
				const sel = renderer.getSelection()
				if (sel && sel.getSelectedText()) copySelectionToClipboard()
			}}
		>
			<Header
				modelId={props.modelId}
				thinking={props.thinking}
				contextTokens={props.contextTokens}
				contextWindow={props.contextWindow}
				queueCounts={props.queueCounts}
				activityState={props.activityState}
				retryStatus={props.retryStatus}
				lspActive={props.lspActive}
				spinnerFrame={spinnerFrame()}
				lsp={props.lsp}
			/>
			<MessagePane
				messages={props.messages}
				toolBlocks={props.toolBlocks}
				thinkingVisible={props.thinkingVisible}
				diffWrapMode={props.diffWrapMode}
				concealMarkdown={props.concealMarkdown}
				isToolExpanded={isToolExpanded}
				toggleToolExpanded={toggleToolExpanded}
				isThinkingExpanded={isThinkingExpanded}
				toggleThinkingExpanded={toggleThinkingExpanded}
				onEditFile={handleEditFile}
			/>
			<Composer
				theme={theme}
				isBashMode={isBashMode}
				showAutocomplete={showAutocomplete}
				autocompleteItems={autocompleteItems}
				autocompleteIndex={autocompleteIndex}
				textareaRef={(ref) => {
					textareaRef = ref
					ref.focus()
				}}
				onContentChange={handleComposerContentChange}
				onSubmit={() => {
					if (!textareaRef) return
					props.onSubmit(textareaRef.plainText, () => {
						textareaRef?.clear()
						setIsBashMode(false)
					})
				}}
				onKeyDown={handleKeyDown}
				terminalWidth={() => dimensions().width}
			/>
			<Footer branch={branch()} bashMode={isBashMode()} />
			<ToastViewport toasts={toasts()} />
		</box>
	)
}

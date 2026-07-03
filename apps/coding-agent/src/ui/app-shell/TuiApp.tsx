import { ThemeProvider } from "@yeshwanthyk/open-tui"
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Effect, Fiber, Stream } from "effect"
import { useRuntime } from "../../runtime/context.js"
import type { LoadedSession, SessionTreeNode, SessionNodeEntry, SessionInfo } from "../../session-manager.js"
import { createSessionController, renderLoadedSessionView } from "@runtime/session/session-controller.js"
import type { PromptDeliveryMode, PromptQueueItem } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import { appendWithCap } from "@domain/messaging/content.js"
import type { UIShellMessage, UIMessage, ToolBlock } from "../../types.js"
import type { AppMessage } from "@yeshwanthyk/agent-core"
import { runShellCommand } from "../../shell-runner.js"
import { MainView } from "../features/main-view/MainView.js"
import { createAppStore } from "../state/app-store.js"
import { detectThemeMode } from "../theme-detect.js"
import { useAgentEvents } from "../../hooks/useAgentEvents.js"
import type { EventHandlerContext, ToolMeta } from "../../agent-events.js"
import { THINKING_LEVELS, type CommandContext } from "../../commands.js"
import { slashCommands } from "../../autocomplete-commands.js"
import { updateAppConfig } from "@yeshwanthyk/runtime-effect/config.js"
import { handleSlashInput } from "../features/composer/SlashCommandHandler.js"
import { createHookMessage, createHookUIContext, type HookMessage, type HookSessionContext, type CompletionResult } from "@yeshwanthyk/runtime-effect/hooks/index.js"
import { completeSimple, type Message } from "@yeshwanthyk/ai"
import { useModals } from "../hooks/useModals.js"
import { ModalContainer } from "../components/modals/ModalContainer.js"
import type { SearchSelectOption } from "../components/modals/search-select-options.js"
import { useWorkspaceSwitch, type VisibleSession } from "../../runtime/workspace-switch.js"
import { shouldStartFreshProjectSwitch } from "../../runtime/workspace-switch-state.js"
import {
	activeSessionLanes,
	archiveSessionLane,
	findActiveCursor,
	flushWorkspaceLanes,
	moveLaneCursor,
	readWorkspaceLanes,
	renameSessionLane,
	restoreSessionLane,
	scheduleWriteWorkspaceLanes,
	selectLane,
	upsertProjectLane,
	upsertSessionLane,
	type LaneCursor,
	type WorkspaceLanes,
} from "@yeshwanthyk/runtime-effect/workspace-lanes.js"
import { discoverWorkspaceProjects, type WorkspaceProject } from "@yeshwanthyk/runtime-effect/workspace-projects.js"
import { createScratchpadStore, type ScratchpadItem } from "@yeshwanthyk/runtime-effect/scratchpads.js"
import { TuiLaneKeyBindings, TuiLaneKeymapRoot, type LaneKeymapDirection, type LaneNavMode } from "./TuiLaneKeymap.js"
import { deriveLaneHeaderState } from "./lane-header-state.js"
import { createCommandPaletteOptions, parseCommandPaletteValue } from "./command-palette-options.js"
import { resolveModel, resolveProvider } from "@domain/commands/helpers.js"

const SHELL_INJECTION_PREFIX = "[Shell output]" as const

const textFromEntry = (entry: SessionNodeEntry): string => {
	if (entry.type === "custom") return `[custom:${entry.customType}]`
	const message = entry.message as { role?: string; content?: unknown; name?: string; toolName?: string }
	const role = message.role ?? "message"
	if (message.content === undefined) return role
	const text = typeof message.content === "string"
		? message.content
		: Array.isArray(message.content)
			? message.content
				.filter((part): part is { type: "text"; text: string } => Boolean(part) && part.type === "text")
				.map((part) => part.text)
				.join(" ")
			: ""
	const compact = text.replace(/\s+/g, " ").trim()
	return `${role}: ${compact || message.name || message.toolName || entry.id}`
}

const flattenTreeOptions = (
	nodes: SessionTreeNode[],
	activeLeafId: string | null,
): Array<{ id: string; label: string }> => {
	const activePath = new Set<string>()
	const markActivePath = (node: SessionTreeNode): boolean => {
		const active = node.entry.id === activeLeafId || node.children.some(markActivePath)
		if (active) activePath.add(node.entry.id)
		return active
	}
	for (const node of nodes) markActivePath(node)

	const rows: Array<{ id: string; label: string }> = []
	const walk = (node: SessionTreeNode, prefix: string, isLast: boolean, isRoot: boolean) => {
		const marker = activePath.has(node.entry.id) ? "*" : " "
		const connector = isRoot ? "" : isLast ? "`- " : "|- "
		rows.push({
			id: node.entry.id,
			label: `${marker} ${prefix}${connector}${textFromEntry(node.entry).slice(0, 100)} [${node.entry.id.slice(0, 8)}]`,
		})
		const childPrefix = prefix + (isRoot ? "" : isLast ? "   " : "|  ")
		node.children.forEach((child, index) => walk(child, childPrefix, index === node.children.length - 1, false))
	}
	nodes.forEach((node, index) => walk(node, "", index === nodes.length - 1, true))
	return rows
}

export interface TuiAppProps {
	initialSession: LoadedSession | null
	initialVisibleSession?: VisibleSession
	/** Initial prompt to submit on startup */
	initialPrompt?: string
	initialScratchpadId?: string
	initialSessionTitle?: string
	startNewSession?: boolean
	initialNavMode?: LaneNavMode
	active?: () => boolean
	activation?: () => TuiAppActivation
	onActivityChange?: (activity: TuiAppActivity) => void
}

export interface TuiAppActivation {
	seq: number
	initialSession: LoadedSession | null
	initialVisibleSession?: VisibleSession
	initialPrompt?: string
	initialScratchpadId?: string
	initialSessionTitle?: string
	startNewSession?: boolean
	initialNavMode?: LaneNavMode
}

export interface TuiAppActivity {
	isResponding: boolean
	sessionId: string | null
	sessionPath: string | null
}

export const TuiApp = ({ initialSession, initialVisibleSession, initialPrompt, initialScratchpadId, initialSessionTitle, startNewSession, initialNavMode, active, activation, onActivityChange }: TuiAppProps) => {
	const runtime = useRuntime()
	const {
		agent,
		sessionManager,
		hookRunner,
		toolByName,
		customCommands,
		lsp,
		config,
		codexTransport,
		getApiKey,
		sendRef,
		lspActiveRef,
		cycleModels,
		validationIssues,
	} = runtime

	const toolMetaByName = new Map<string, ToolMeta>()
	for (const [name, entry] of toolByName.entries()) {
		const renderCall = entry.renderCall && typeof entry.renderCall === 'function' 
			? (entry.renderCall as ToolMeta["renderCall"])
			: undefined
		const renderResult = entry.renderResult && typeof entry.renderResult === 'function'
			? (entry.renderResult as ToolMeta["renderResult"]) 
			: undefined
			
		toolMetaByName.set(name, {
			label: entry.label,
			source: entry.source,
			sourcePath: entry.sourcePath,
			renderCall,
			renderResult,
		})
	}

	const store = createAppStore({
		initialTheme: config.theme,
		initialModelId: config.modelId,
		initialThinking: config.thinking,
		initialContextWindow: config.model.contextWindow,
		initialProvider: config.provider,
	})

	let promptQueueItems: ReadonlyArray<PromptQueueItem> = []
	const promptQueue = {
		push: (_item: PromptQueueItem) => {},
		shift: () => {
			const item = promptQueueItems[0]
			if (item !== undefined) {
				promptQueueItems = promptQueueItems.slice(1)
				store.queueCounts.set({
					steer: promptQueueItems.filter((entry) => entry.mode === "steer").length,
					followUp: promptQueueItems.filter((entry) => entry.mode === "followUp").length,
				})
				Effect.runFork(runtime.promptQueue.acknowledgeHead(item))
			}
			return item
		},
		drainToScript: () => Effect.runSync(
			Effect.catchAll(runtime.sessionOrchestrator.drainToScript, () => Effect.succeed(null)),
		),
		clear: () => {
			Effect.runFork(runtime.promptQueue.clear)
		},
		size: () => promptQueueItems.length,
		peekAll: () => [...promptQueueItems],
		peek: () => promptQueueItems[0],
		counts: () => store.queueCounts.value(),
	}
	const modals = useModals()
	const workspaceSwitch = useWorkspaceSwitch()
	const scratchpadStore = createScratchpadStore(config.configDir)
	const [workspaceLanes, setWorkspaceLanes] = createSignal<WorkspaceLanes>(readWorkspaceLanes(config.configDir))
	const [navMode, setNavMode] = createSignal<LaneNavMode>(initialNavMode ?? "off")
	const laneHeaderState = createMemo(() => deriveLaneHeaderState(workspaceLanes(), navMode()))
	const configuredProjects = (): WorkspaceProject[] => discoverWorkspaceProjects(config.workspace.projectRoots)
	const scratchpads = (): ScratchpadItem[] => scratchpadStore.list()
	const preserveStickyLaneMode = () => navMode() === "sticky"
	const isAppActive = () => active?.() ?? true

	const queueFiber = Effect.runFork(
		Stream.runForEach(runtime.promptQueue.stateStream, (snapshot) =>
			Effect.sync(() => {
				promptQueueItems = snapshot.pending
				store.queueCounts.set(snapshot.counts)
			}),
		),
	)
	onCleanup(() => {
		Effect.runFork(Fiber.interrupt(queueFiber))
		void flushWorkspaceLanes(config.configDir)
	})

	const visibleSessionForLoaded = (session: LoadedSession, sessionPath?: string): VisibleSession => ({
		state: "loaded",
		cwd: session.metadata.cwd || sessionManager.projectCwd,
		sessionPath: sessionPath || sessionManager.listSessions().find((entry) => entry.id === session.metadata.id)?.path || "",
		sessionId: session.metadata.id,
		session,
	})
	const initialVisible = initialVisibleSession ?? (initialSession ? visibleSessionForLoaded(initialSession) : { state: "none" })
	const [visibleSession, setVisibleSession] = createSignal<VisibleSession>(initialVisible)
	const [activeMessages, setActiveMessagesSignal] = createSignal<UIMessage[]>([])
	const [activeToolBlocks, setActiveToolBlocksSignal] = createSignal<ToolBlock[]>([])
	const [activeContextTokens, setActiveContextTokensSignal] = createSignal(0)
	const [activeDisplayProvider, setActiveDisplayProviderSignal] = createSignal(config.provider)
	const [activeDisplayModelId, setActiveDisplayModelIdSignal] = createSignal(config.modelId)
	const [activeDisplayThinking, setActiveDisplayThinkingSignal] = createSignal(config.thinking)
	const [activeDisplayContextWindow, setActiveDisplayContextWindowSignal] = createSignal(config.model.contextWindow)

	const visibleCwd = () => {
		const visible = visibleSession()
		return visible.state === "none" ? sessionManager.projectCwd : visible.cwd
	}

	const isVisibleActiveSession = (visible: VisibleSession): boolean => {
		if (visible.state === "none") return sessionManager.sessionPath === null
		return visible.state === "loaded" &&
			visible.cwd === sessionManager.projectCwd &&
			visible.sessionPath === sessionManager.sessionPath &&
			visible.sessionId === sessionManager.sessionId
	}
	const isActiveSessionVisible = (): boolean => isVisibleActiveSession(visibleSession())

	const showActiveSessionView = () => {
		batch(() => {
			store.messages.set(() => activeMessages())
			store.toolBlocks.set(() => activeToolBlocks())
			store.contextTokens.set(activeContextTokens())
			store.currentProvider.set(activeDisplayProvider())
			store.displayModelId.set(activeDisplayModelId())
			store.displayThinking.set(activeDisplayThinking())
			store.displayContextWindow.set(activeDisplayContextWindow())
		})
	}

	const setActiveMessages = (updater: (prev: UIMessage[]) => UIMessage[]) => {
		setActiveMessagesSignal((prev) => {
			const next = updater(prev)
			if (isActiveSessionVisible()) store.messages.set(() => next)
			return next
		})
	}

	const setActiveToolBlocks = (updater: (prev: ToolBlock[]) => ToolBlock[]) => {
		setActiveToolBlocksSignal((prev) => {
			const next = updater(prev)
			if (isActiveSessionVisible()) store.toolBlocks.set(() => next)
			return next
		})
	}

	const setActiveContextTokens = (value: number) => {
		setActiveContextTokensSignal(value)
		if (isActiveSessionVisible()) store.contextTokens.set(value)
	}

	const setActiveDisplayProvider = (value: typeof config.provider) => {
		setActiveDisplayProviderSignal(value)
		if (isActiveSessionVisible()) store.currentProvider.set(value)
	}

	const setActiveDisplayModelId = (value: string) => {
		setActiveDisplayModelIdSignal(value)
		if (isActiveSessionVisible()) store.displayModelId.set(value)
	}

	const setActiveDisplayThinking = (value: typeof config.thinking) => {
		setActiveDisplayThinkingSignal(value)
		if (isActiveSessionVisible()) store.displayThinking.set(value)
	}

	const setActiveDisplayContextWindow = (value: number) => {
		setActiveDisplayContextWindowSignal(value)
		if (isActiveSessionVisible()) store.displayContextWindow.set(value)
	}

	const sessionController = createSessionController({
		initialProvider: config.provider,
		initialModel: config.model,
		initialModelId: config.modelId,
		initialThinking: config.thinking,
		agent,
		sessionManager,
		hookRunner,
		toolByName: toolMetaByName,
		setMessages: setActiveMessages,
		setContextTokens: setActiveContextTokens,
		setDisplayProvider: setActiveDisplayProvider,
		setDisplayModelId: setActiveDisplayModelId,
		setDisplayThinking: setActiveDisplayThinking,
		setDisplayContextWindow: setActiveDisplayContextWindow,
		shellInjectionPrefix: SHELL_INJECTION_PREFIX,
		submitPrompt: (text, options) => submitPrompt(text, options?.mode ?? "followUp"),
	})

	const cloneWorkspaceLanes = (value: WorkspaceLanes): WorkspaceLanes => JSON.parse(JSON.stringify(value)) as WorkspaceLanes

	const persistWorkspaceLanes = (next: WorkspaceLanes) => {
		scheduleWriteWorkspaceLanes(config.configDir, next)
		setWorkspaceLanes(next)
	}

	const getCurrentSessionInfo = (): SessionInfo | null => {
		const sessionId = sessionManager.sessionId
		const sessionPath = sessionManager.sessionPath
		if (!sessionId || !sessionPath) return null
		return sessionManager.findSession(sessionPath) ?? {
			id: sessionId,
			timestamp: Date.now(),
			path: sessionPath,
			provider: sessionController.currentProvider(),
			modelId: sessionController.currentModelId(),
			cwd: sessionManager.projectCwd,
		}
	}

	const syncCurrentSessionLane = (title?: string, options: { select?: boolean } = {}): LaneCursor | null => {
		const session = getCurrentSessionInfo()
		if (!session) return null
		const next = cloneWorkspaceLanes(workspaceLanes())
		const project = upsertProjectLane(next, sessionManager.projectCwd)
		const lane = upsertSessionLane(next, project, session, title)
		const shouldSelect = options.select ?? isActiveSessionVisible()
		const selected = shouldSelect ? selectLane(next, { project, session: lane }) : next
		persistWorkspaceLanes(selected)
		return { project, session: lane }
	}

	const seedCurrentProjectLanes = () => {
		const next = cloneWorkspaceLanes(workspaceLanes())
		const project = upsertProjectLane(next, sessionManager.projectCwd)
		for (const session of sessionManager.loadAllSessions()) {
			if (session.messageCount === 0 || session.firstMessage.startsWith("System context:")) continue
			const title = session.firstMessage.replace(/\s+/g, " ").trim().slice(0, 80) || session.id.slice(0, 8)
			upsertSessionLane(next, project, session, title)
		}
		persistWorkspaceLanes(next)
	}

	const applyLoadedSessionDisplay = (session: LoadedSession, contextTokens: number) => {
		const provider = resolveProvider(session.metadata.provider)
		const model = provider ? resolveModel(provider, session.metadata.modelId) : null
		batch(() => {
			if (provider) store.currentProvider.set(provider)
			store.displayModelId.set(model?.id ?? session.metadata.modelId)
			store.displayThinking.set(session.metadata.thinkingLevel)
			if (model) store.displayContextWindow.set(model.contextWindow)
			store.contextTokens.set(contextTokens)
		})
	}

	const applyVisibleSession = (nextVisible: VisibleSession) => {
		setVisibleSession(nextVisible)
		if (isVisibleActiveSession(nextVisible)) {
			showActiveSessionView()
			return
		}

		if (nextVisible.state === "loaded") {
			const view = renderLoadedSessionView(nextVisible.session.messages as AppMessage[], {
				toolByName: toolMetaByName,
				shellInjectionPrefix: SHELL_INJECTION_PREFIX,
			})
			batch(() => {
				store.messages.set(() => view.messages)
				store.toolBlocks.set([])
				store.cacheStats.set(null)
				store.retryStatus.set(null)
			})
			applyLoadedSessionDisplay(nextVisible.session, view.contextTokens)
			return
		}

		const messages: UIMessage[] = nextVisible.state === "missing"
			? [{
				id: `missing-${nextVisible.sessionPath}`,
				role: "assistant",
				content: `Session file missing: ${nextVisible.sessionPath}`,
			}]
			: []
		batch(() => {
			store.messages.set(() => messages)
			store.toolBlocks.set([])
			store.contextTokens.set(0)
			store.cacheStats.set(null)
			store.retryStatus.set(null)
			store.currentProvider.set(activeDisplayProvider())
			store.displayModelId.set(activeDisplayModelId())
			store.displayThinking.set(activeDisplayThinking())
			store.displayContextWindow.set(activeDisplayContextWindow())
		})
	}

	const markScratchpadTriggered = (id: string | undefined) => {
		if (!id || !sessionManager.sessionId) return
		try {
			scratchpadStore.markTriggered(id, sessionManager.sessionId)
		} catch {
			// Scratchpad startup should not block the session itself.
		}
	}

	onMount(() => {
		seedCurrentProjectLanes()
		if (startNewSession) {
			prepareFreshSession(initialSessionTitle)
			ensureSession()
		} else if (initialSession) {
			sessionController.restoreSession(initialSession)
			const nextVisible = initialVisibleSession ?? visibleSessionForLoaded(initialSession)
			setVisibleSession(nextVisible)
			showActiveSessionView()
			syncCurrentSessionLane()
		} else if (initialVisibleSession) {
			applyVisibleSession(initialVisibleSession)
		}
	})

	// Submit initial prompt after render settles
	onMount(() => {
		if (initialPrompt) {
			// Delay slightly to let UI initialize
			setTimeout(() => {
				void submitPrompt(initialPrompt, "followUp")
				setTimeout(() => markScratchpadTriggered(initialScratchpadId), 250)
			}, 50)
		}
	})

	let pendingSessionTitle: string | undefined
	let composerDraft = ""

	const ensureSession = () => {
		sessionController.ensureSession()
		if (sessionManager.sessionPath) {
			const loaded = sessionManager.loadSession(sessionManager.sessionPath)
			if (loaded && visibleSession().state === "none") {
				setVisibleSession(visibleSessionForLoaded(loaded, sessionManager.sessionPath))
				showActiveSessionView()
			}
		}
		syncCurrentSessionLane(pendingSessionTitle, { select: true })
		pendingSessionTitle = undefined
	}

	const prepareFreshSession = (title = "new session") => {
		pendingSessionTitle = title
		composerDraft = ""
		sessionController.clearSession()
		setVisibleSession({ state: "none" })
		batch(() => {
			setActiveMessagesSignal([])
			setActiveToolBlocksSignal([])
			setActiveContextTokensSignal(0)
			store.messages.set([])
			store.toolBlocks.set([])
			store.contextTokens.set(0)
			store.cacheStats.set(null)
			store.retryStatus.set(null)
		})
		agent.reset()
		void hookRunner.emit({ type: "session.clear", sessionId: null })
	}

	const startFreshSession = (title = "new session") => {
		prepareFreshSession(title)
		ensureSession()
	}

	let cycleIndex = cycleModels.findIndex(
		(entry) => entry.model.id === config.modelId && entry.provider === config.provider,
	)
	if (cycleIndex < 0) cycleIndex = 0

	const streamingMessageIdRef = { current: null as string | null }
	const retryConfig = { enabled: true, maxRetries: 3, baseDelayMs: 2000 }
	const retryablePattern =
		/overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error/i
	const retryState: { attempt: number; abortController: AbortController | null } = { 
		attempt: 0, 
		abortController: null 
	}

	lspActiveRef.setActive = store.lspActive.set

	const eventCtx: EventHandlerContext = {
		setMessages: setActiveMessages,
		setToolBlocks: setActiveToolBlocks,
		setActivityState: store.activityState.set,
		setIsResponding: store.isResponding.set,
		setContextTokens: setActiveContextTokens,
		setCacheStats: store.cacheStats.set,
		setRetryStatus: store.retryStatus.set,
		setTurnCount: store.turnCount.set,
		promptQueue,
		sessionManager,
		streamingMessageId: streamingMessageIdRef,
		retryConfig,
		retryablePattern,
		retryState,
		agent: {
			getMessages: () => agent.state.messages,
			replaceMessages: (messages: AppMessage[]) => agent.replaceMessages(messages),
			continue: agent.continue.bind(agent),
		},
		hookRunner,
		toolByName: toolMetaByName,
		getContextWindow: () => activeDisplayContextWindow(),
	}

	useAgentEvents({ agent, context: eventCtx })

	const handleThemeChange = (name: string) => {
		store.theme.set(name)
		void updateAppConfig({ configDir: config.configDir, configPath: config.configPath }, { theme: name })
	}

	const exitHandlerRef = { current: () => { void flushWorkspaceLanes(config.configDir).finally(() => process.exit(0)) } }
	const editorOpenRef = { current: async () => {} }
	const editFileRef = { current: async (_filePath: string, _line?: number) => {} }
	const setEditorTextRef = { current: (_text: string) => {} }
	const getEditorTextRef = { current: () => "" }
	const clearEditorRef = { current: () => {} }
	const showToastRef = { current: (_title: string, _message: string, _variant?: "info" | "warning" | "success" | "error") => {} }
	let wasAppActive = isAppActive()

	createEffect(() => {
		const nowActive = isAppActive()
		if (!wasAppActive && nowActive && composerDraft.length > 0) {
			setTimeout(() => setEditorTextRef.current(composerDraft), 0)
		}
		wasAppActive = nowActive
	})

	const handleBeforeExit = async () => {
		// Emit shutdown hook before exiting
		await hookRunner.emit({ type: "session.shutdown", sessionId: sessionManager.sessionId })
	}

	const activateVisibleSessionForSubmit = (): boolean => {
		const visible = visibleSession()
		if (visible.state === "missing") {
			showToastRef.current("Session missing", visible.sessionPath, "error")
			return false
		}

		if (visible.state === "loaded" && !isVisibleActiveSession(visible)) {
			if (store.isResponding.value()) {
				showToastRef.current("Session still running", "Wait for the active stream before sending here", "warning")
				return false
			}
			if (visible.cwd !== sessionManager.projectCwd) {
				showToastRef.current("Project not loaded", visible.cwd, "error")
				return false
			}
			const switched = sessionController.switchSession(visible.sessionPath)
			if (!switched) {
				applyVisibleSession({ state: "missing", cwd: visible.cwd, sessionPath: visible.sessionPath })
				return false
			}
			setVisibleSession(visible)
			showActiveSessionView()
			syncCurrentSessionLane(undefined, { select: true })
			return true
		}

		if (visible.state === "none") {
			if (store.isResponding.value() && sessionManager.sessionPath !== null) {
				showToastRef.current("Session still running", "Wait for the active stream before starting a new session", "warning")
				return false
			}
			ensureSession()
		}

		return true
	}

	const revealLiveSession = (): boolean => {
		if (isActiveSessionVisible()) return true
		const sessionPath = sessionManager.sessionPath
		if (!sessionPath) return false
		const loaded = sessionManager.loadSession(sessionPath)
		if (!loaded) return false
		setVisibleSession(visibleSessionForLoaded(loaded, sessionPath))
		showActiveSessionView()
		syncCurrentSessionLane(undefined, { select: true })
		return true
	}

	const submitPrompt = async (text: string, mode: PromptDeliveryMode = "followUp") => {
		const trimmed = text.trim()
		if (!trimmed) return
		if (!activateVisibleSessionForSubmit()) return

		let beforeStartResult: Awaited<ReturnType<typeof hookRunner.emitBeforeAgentStart>> | undefined
		try {
			beforeStartResult = await hookRunner.emitBeforeAgentStart(trimmed)
			const hookMsg = beforeStartResult?.message ? createHookMessage(beforeStartResult.message) : null
			if (hookMsg?.display) {
				const uiMsg: UIMessage = {
					id: crypto.randomUUID(),
					role: "assistant",
					content:
						typeof hookMsg.content === "string"
							? hookMsg.content
							: hookMsg.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(""),
					timestamp: hookMsg.timestamp,
				}
				store.messages.set((prev) => appendWithCap(prev, uiMsg))
			}
		} catch (err) {
			store.messages.set((prev) =>
				appendWithCap(prev, {
					id: crypto.randomUUID(),
					role: "assistant",
					content: `Hook error: ${err instanceof Error ? err.message : String(err)}`,
					timestamp: Date.now(),
				}),
			)
		}

		batch(() => {
			store.toolBlocks.set([])
			store.isResponding.set(true)
			store.activityState.set("thinking")
		})
		try {
			await Effect.runPromise(
				runtime.sessionOrchestrator.submitPrompt(trimmed, { mode, beforeStartResult }),
			)
			setTimeout(() => {
				if (!sessionManager.sessionId) return
				syncCurrentSessionLane(pendingSessionTitle)
				pendingSessionTitle = undefined
			}, 100)
		} catch (err) {
			batch(() => {
				store.messages.set((prev) =>
					appendWithCap(prev, {
						id: crypto.randomUUID(),
						role: "assistant",
						content: `Error: ${err instanceof Error ? err.message : String(err)}`,
					}),
				)
				store.isResponding.set(false)
				store.activityState.set("idle")
			})
		}
	}

	let lastActivationSeq = activation?.().seq ?? 0
	createEffect(() => {
		const next = activation?.()
		if (!next || next.seq === lastActivationSeq || !isAppActive()) return
		lastActivationSeq = next.seq
		setWorkspaceLanes(readWorkspaceLanes(config.configDir))
		if (next.initialNavMode) setNavMode(next.initialNavMode)
		if (next.startNewSession) {
			if (store.isResponding.value()) {
				showToastRef.current("Session still running", "Wait for the active stream before starting a new session", "warning")
				return
			}
			prepareFreshSession(next.initialSessionTitle)
			ensureSession()
		} else if (next.initialVisibleSession) {
			if (isVisibleActiveSession(next.initialVisibleSession)) {
				setVisibleSession(next.initialVisibleSession)
				showActiveSessionView()
			} else {
				applyVisibleSession(next.initialVisibleSession)
			}
		}
		if (next.initialPrompt) {
			const prompt = next.initialPrompt
			setTimeout(() => {
				void submitPrompt(prompt, "followUp")
				setTimeout(() => markScratchpadTriggered(next.initialScratchpadId), 250)
			}, 50)
		}
	})

	createEffect(() => {
		onActivityChange?.({
			isResponding: store.isResponding.value(),
			sessionId: sessionManager.sessionId,
			sessionPath: sessionManager.sessionPath,
		})
	})

	const steerHelper = async (text: string) => {
		const trimmed = text.trim()
		if (!trimmed) return
		if (store.isResponding.value()) {
			if (!revealLiveSession()) {
				showToastRef.current("Session still running", "Switch back to the live session before steering", "warning")
				return
			}
			await Effect.runPromise(runtime.sessionOrchestrator.submitPrompt(trimmed, { mode: "steer" }))
			return
		}
		await submitPrompt(trimmed, "steer")
	}

	const followUpHelper = async (text: string) => {
		const trimmed = text.trim()
		if (!trimmed) return
		if (store.isResponding.value()) {
			if (!revealLiveSession()) {
				showToastRef.current("Session still running", "Switch back to the live session before queueing follow-up", "warning")
				return
			}
			await Effect.runPromise(runtime.sessionOrchestrator.submitPrompt(trimmed, { mode: "followUp" }))
			return
		}
		await submitPrompt(trimmed, "followUp")
	}

	const sendUserMessageHelper = async (text: string, options?: { deliverAs?: PromptDeliveryMode }) => {
		const mode: PromptDeliveryMode = options?.deliverAs ?? "followUp"
		if (mode === "steer") {
			await steerHelper(text)
			return
		}
		await followUpHelper(text)
	}

	const cmdCtx: CommandContext = {
		agent,
		sessionManager,
		configDir: config.configDir,
		configPath: config.configPath,
		cwd: sessionManager.projectCwd,
		editor: config.editor,
		codexTransport,
		getApiKey,
		get currentProvider() {
			return sessionController.currentProvider()
		},
		get currentModelId() {
			return sessionController.currentModelId()
		},
		get currentThinking() {
			return sessionController.currentThinking()
		},
		setCurrentProvider: (p) => sessionController.setCurrentProvider(p),
		setCurrentModelId: (id) => sessionController.setCurrentModelId(id),
		setCurrentThinking: (t) => sessionController.setCurrentThinking(t),
		isResponding: store.isResponding.value,
		setIsResponding: store.isResponding.set,
		setActivityState: store.activityState.set,
		setMessages: store.messages.set,
		setToolBlocks: store.toolBlocks.set,
		setContextTokens: store.contextTokens.set,
		setCacheStats: store.cacheStats.set,
		setDisplayModelId: store.displayModelId.set,
		setDisplayThinking: store.displayThinking.set,
		setDisplayContextWindow: store.displayContextWindow.set,
		setTheme: handleThemeChange,
		openEditor: () => editorOpenRef.current(),
		clearEditor: () => clearEditorRef.current(),
		setEditorText: (text) => setEditorTextRef.current(text),
		onExit: () => exitHandlerRef.current(),
		hookRunner,
		submitPrompt: (text, options) => submitPrompt(text, options?.mode ?? "followUp"),
		steer: (text) => steerHelper(text),
		followUp: (text) => followUpHelper(text),
		sendUserMessage: (text, options) => sendUserMessageHelper(text, options),
		showSelect: modals.showSelect,
		showInput: modals.showInput,
		showTreeSelector: async () => {
			const rows = flattenTreeOptions(sessionManager.getTree(), sessionManager.getLeafId())
			if (rows.length === 0) return undefined
			const labels = rows.map((row) => row.label)
			const selected = await modals.showSelect("Session Tree", labels)
			if (selected === undefined) return undefined
			return rows[labels.indexOf(selected)]?.id
		},
		navigateTree: (entryId, options) => sessionController.navigateTree(entryId, options),
		switchSession: async (sessionPath: string) => {
			const loaded = sessionManager.loadSession(sessionPath)
			applyVisibleSession(loaded
				? visibleSessionForLoaded(loaded, sessionPath)
				: { state: "missing", cwd: sessionManager.projectCwd, sessionPath })
			return loaded !== null
		},
		archiveCurrentSession: () => archiveCurrentSession(),
		restoreArchivedSession: () => restoreArchivedSession(),
	}

	const builtInCommandNames = new Set(slashCommands.map((c) => c.name))

	const enqueueWhileResponding = (text: string, mode: PromptDeliveryMode) => {
		void sendUserMessageHelper(text, { deliverAs: mode }).catch((err) => {
			store.messages.set((prev) =>
				appendWithCap(prev, {
					id: crypto.randomUUID(),
					role: "assistant",
					content: `Error: ${err instanceof Error ? err.message : String(err)}`,
				}),
			)
		})
	}

	const handleSubmit = async (text: string, editorClearFn?: () => void) => {
		if (!text.trim()) return
		const clearSubmittedEditor = () => {
			editorClearFn?.()
			composerDraft = ""
		}

		if (text.startsWith("!")) {
			const shouldInject = text.startsWith("!!")
			const command = text.slice(shouldInject ? 2 : 1).trim()
			if (!command) return
			clearSubmittedEditor()
			ensureSession()

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
			store.messages.set((prev) => appendWithCap(prev, pendingMsg))

			const result = await runShellCommand(command, { timeout: 30000 })
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
			store.messages.set((prev) => prev.map((m) => (m.id === shellMsgId ? finalMsg : m)))

			sessionManager.appendMessage({
				role: "shell",
				command,
				output: result.output,
				exitCode: result.exitCode,
				truncated: result.truncated,
				tempFilePath: result.tempFilePath,
				timestamp: Date.now(),
			})

			if (shouldInject) {
				const injectionLines = [`${SHELL_INJECTION_PREFIX}`, `$ ${command}`, result.output]
				if (result.exitCode !== null && result.exitCode !== 0) injectionLines.push(`[exit ${result.exitCode}]`)
				if (result.truncated && result.tempFilePath) injectionLines.push(`[truncated, full output: ${result.tempFilePath}]`)
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

		if (text.startsWith("/")) {
			const trimmed = text.trim()
			const handled = await handleSlashInput(trimmed, {
				commandContext: cmdCtx,
				customCommands,
				builtInCommandNames,
				onExpand: async (expanded) => handleSubmit(expanded),
			})
			if (handled) {
				// Commands that need to clear input do so explicitly via ctx.clearEditor()
				return
			}
		}

		if (store.isResponding.value()) {
			if (!revealLiveSession()) {
				showToastRef.current("Session still running", "Switch back to the live session before steering", "warning")
				return
			}
			enqueueWhileResponding(text, "steer")
			clearSubmittedEditor()
			return
		}

		clearSubmittedEditor()
		await submitPrompt(text, "followUp")
	}

	// Initialize hook runner with full context
	const hookUIContext = createHookUIContext({
		setEditorText: (text) => {
			setEditorTextRef.current(text)
		},
		getEditorText: () => getEditorTextRef.current(),
		showSelect: modals.showSelect,
		showInput: modals.showInput,
		showConfirm: modals.showConfirm,
		showEditor: modals.showEditor,
		showNotify: (message, type = "info") => showToastRef.current(type, message, type)
	})

	const hookSessionContext: HookSessionContext = {
		summarize: async () => {
			// Trigger compaction through the /compact command flow
			await handleSlashInput("/compact", {
				commandContext: cmdCtx,
				customCommands,
				builtInCommandNames,
				onExpand: async (expanded) => handleSubmit(expanded),
			})
		},
		toast: (title, message, variant = "info") => showToastRef.current(title, message, variant),
		getTokenUsage: () => hookRunner["tokenUsage"],
		getContextLimit: () => hookRunner["contextLimit"],
		newSession: async (_opts) => {
			startFreshSession()
			return { cancelled: false, sessionId: sessionManager.sessionId ?? undefined }
		},
		getApiKey: async (model) => getApiKey(model.provider),
		complete: async (systemPrompt, userText) => {
			const model = agent.state.model
			const apiKey = getApiKey(model.provider)
			if (!apiKey) {
				return { text: "", stopReason: "error" as const }
			}
			try {
				const userMessage: Message = {
					role: "user",
					content: [{ type: "text", text: userText }],
					timestamp: Date.now(),
				}
				const result = await completeSimple(model, { systemPrompt, messages: [userMessage] }, { apiKey })
				const text = result.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n")
				// Map stopReason: stop -> end, length -> max_tokens, toolUse -> tool_use
				const stopMap: Record<string, CompletionResult["stopReason"]> = {
					stop: "end", length: "max_tokens", toolUse: "tool_use", error: "error", aborted: "aborted"
				}
				return { text, stopReason: stopMap[result.stopReason] ?? "end" }
			} catch (err) {
				return { text: err instanceof Error ? err.message : String(err), stopReason: "error" as const }
			}
		},
	}

	const sendMessageHandler = <T = unknown>(
		message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
		triggerTurn?: boolean | { triggerTurn?: boolean },
	) => {
		const shouldTriggerTurn = typeof triggerTurn === "object" ? triggerTurn.triggerTurn === true : triggerTurn === true
		const hookMessage = createHookMessage(message)
		// Add to UI messages if display is true
		if (hookMessage.display) {
			const uiMsg: UIMessage = {
				id: crypto.randomUUID(),
				role: "assistant", // Render hook messages as assistant for now
				content: typeof hookMessage.content === "string"
					? hookMessage.content
					: hookMessage.content.map(p => p.type === "text" ? p.text : "[image]").join(""),
				timestamp: hookMessage.timestamp,
			}
			store.messages.set((prev) => appendWithCap(prev, uiMsg))
		}
		// Persist hook message to session
		sessionManager.appendMessage(hookMessage)
		// Optionally trigger a new turn
		if (shouldTriggerTurn) {
			void handleSubmit(typeof hookMessage.content === "string" ? hookMessage.content : "")
		}
	}

	hookRunner.initialize({
		sendHandler: (text) => void handleSubmit(text),
		sendMessageHandler,
		sendUserMessageHandler: (text, options) => sendUserMessageHelper(text, options),
		steerHandler: (text) => steerHelper(text),
		followUpHandler: (text) => followUpHelper(text),
		isIdleHandler: () => !store.isResponding.value(),
		appendEntryHandler: (customType, data) => sessionManager.appendEntry(customType, data),
		getSessionId: () => sessionManager.sessionId,
		getModel: () => agent.state.model,
		uiContext: hookUIContext,
		sessionContext: hookSessionContext,
		hasUI: true,
	})

	sendRef.current = (text) => void handleSubmit(text)

	const handleAbort = (): string | null => {
		if (retryState.abortController) {
			retryState.abortController.abort()
			retryState.abortController = null
			retryState.attempt = 0
			store.retryStatus.set(null)
		}
		agent.abort()
		agent.clearMessageQueue()
		const restore = promptQueue.drainToScript()
		batch(() => {
			store.isResponding.set(false)
			store.activityState.set("idle")
		})
		return restore
	}

	const cycleModel = () => {
		if (cycleModels.length <= 1) return
		if (store.isResponding.value()) return
		cycleIndex = (cycleIndex + 1) % cycleModels.length
		const entry = cycleModels[cycleIndex]!
		sessionController.setCurrentProvider(entry.provider)
		sessionController.setCurrentModelId(entry.model.id)
		agent.setModel(entry.model)
		store.displayModelId.set(entry.model.id)
		store.displayContextWindow.set(entry.model.contextWindow)
		if (entry.thinking !== undefined) {
			sessionController.setCurrentThinking(entry.thinking)
			agent.setThinkingLevel(entry.thinking)
			store.displayThinking.set(entry.thinking)
		}
	}

	const cycleThinking = () => {
		const current = sessionController.currentThinking()
		const next = THINKING_LEVELS[(THINKING_LEVELS.indexOf(current) + 1) % THINKING_LEVELS.length]!
		sessionController.setCurrentThinking(next)
		agent.setThinkingLevel(next)
		store.displayThinking.set(next)
	}

	const switchToLane = async (cursor: LaneCursor, options?: { preserveLaneMode?: boolean }): Promise<boolean> => {
		const previous = workspaceLanes()
		const selected = selectLane(cloneWorkspaceLanes(previous), cursor)
		persistWorkspaceLanes(selected)
		if (cursor.project.cwd === sessionManager.projectCwd) {
			const loaded = sessionManager.loadSession(cursor.session.sessionPath)
			applyVisibleSession(loaded
				? visibleSessionForLoaded(loaded, cursor.session.sessionPath)
				: { state: "missing", cwd: cursor.project.cwd, sessionPath: cursor.session.sessionPath })
		} else {
			const result = await workspaceSwitch.switchTo({
				cwd: cursor.project.cwd,
				sessionPath: cursor.session.sessionPath,
				preserveLaneMode: options?.preserveLaneMode,
			})
			if (!result.switched) {
				persistWorkspaceLanes(previous)
				return false
			}
		}

		if (!options?.preserveLaneMode) setNavMode("off")
		return true
	}

	const navigateLane = (direction: LaneKeymapDirection) => {
		void (async () => {
			const preserveLaneMode = navMode() === "sticky"
			syncCurrentSessionLane()
			const cursor = moveLaneCursor(workspaceLanes(), direction)
			if (!cursor) return
			await switchToLane(cursor, { preserveLaneMode })
		})()
	}

	const projectTitleFor = (projectId: string): string =>
		workspaceLanes().projects.find((project) => project.id === projectId)?.title ?? projectId

	const laneSearchOption = (session: ReturnType<typeof activeSessionLanes>[number]): SearchSelectOption => {
		const projectTitle = projectTitleFor(session.projectId)
		const shortId = session.sessionId.slice(0, 8)
		const model = `${session.provider}/${session.modelId}`
		return {
			value: session.id,
			label: `${projectTitle} / ${session.title || shortId}`,
			description: `${shortId} | ${model}`,
			keywords: `${projectTitle} ${session.title} ${session.sessionId} ${session.sessionPath} ${model}`,
		}
	}

	const projectSearchOption = (project: WorkspaceProject): SearchSelectOption => ({
		value: project.cwd,
		label: project.title,
		description: project.cwd,
		keywords: `${project.title} ${project.cwd} ${project.root} project workspace folder`,
	})

	const scratchpadSearchOption = (item: ScratchpadItem): SearchSelectOption => ({
		value: item.id,
		label: item.title,
		description: item.bodyPreview || item.cwd,
		keywords: `${item.title} ${item.cwd} ${item.bodyPreview} ${item.tags.join(" ")} scratch scratchpad note`,
	})

	const pickConfiguredProject = async (title: string): Promise<WorkspaceProject | null> => {
		const projects = configuredProjects()
		if (projects.length === 0) {
			showToastRef.current("No project roots", "Add workspace.projectRoots in config", "warning")
			return null
		}
		const selected = await modals.showSearchSelect(title, projects.map(projectSearchOption), "project or folder")
		return selected ? projects.find((project) => project.cwd === selected) ?? null : null
	}

	const pickScratchpad = async (title: string): Promise<ScratchpadItem | null> => {
		const items = scratchpads()
		if (items.length === 0) {
			showToastRef.current("No scratchpads", "Create one with Open scratchpad first", "warning")
			return null
		}
		const selected = await modals.showSearchSelect(title, items.map(scratchpadSearchOption), "scratchpad or note")
		return selected ? items.find((item) => item.id === selected) ?? null : null
	}

	const titleFromScratchpadBody = (body: string): string => {
		const words = body.replace(/^#+\s*/g, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, 4)
		return words.join(" ").slice(0, 80) || "scratchpad note"
	}

	const saveScratchpadBody = (body: string, options?: { title?: string }) => {
		const trimmed = body.trim()
		if (!trimmed) {
			showToastRef.current("Nothing to save", "Scratchpad is empty", "warning")
			return null
		}
		const item = scratchpadStore.add({
			cwd: sessionManager.projectCwd,
			title: options?.title ?? titleFromScratchpadBody(trimmed),
			body: trimmed,
			source: { kind: "tui", ...(sessionManager.sessionId ? { sessionId: sessionManager.sessionId } : {}) },
		})
		showToastRef.current("Scratchpad saved", item.bodyPath, "success")
		return item
	}

	const captureScratchpad = () => {
		void (async () => {
			const initialText = getEditorTextRef.current()
			const body = await modals.showEditor("Scratchpad", initialText)
			if (body === undefined) return
			try {
				saveScratchpadBody(body)
			} catch (error) {
				showToastRef.current("Scratchpad failed", error instanceof Error ? error.message : String(error), "error")
			}
		})()
	}

	const switchToProject = async (project: WorkspaceProject, options?: { fresh?: boolean; preserveLaneMode?: boolean }): Promise<boolean> => {
		const fresh = shouldStartFreshProjectSwitch(workspaceLanes(), project.cwd, options?.fresh)
		if (project.cwd === sessionManager.projectCwd) {
			if (fresh) startFreshSession()
			return true
		}
		const result = await workspaceSwitch.switchTo({
			cwd: project.cwd,
			fresh,
			preserveLaneMode: options?.preserveLaneMode,
		})
		if (!result.switched) return false
		return true
	}

	const startSessionInProject = () => {
		void (async () => {
			const project = await pickConfiguredProject("New session in project")
			if (!project) return
			await switchToProject(project, { fresh: true, preserveLaneMode: preserveStickyLaneMode() })
		})()
	}

	const saveCurrentScratchpad = () => {
		void (async () => {
			const body = getEditorTextRef.current().trim()
			try {
				saveScratchpadBody(body)
			} catch (error) {
				showToastRef.current("Scratchpad failed", error instanceof Error ? error.message : String(error), "error")
			}
		})()
	}

	const openScratchpad = (id: string) => {
		try {
			const { item, body } = scratchpadStore.read(id)
			setEditorTextRef.current(body)
			showToastRef.current("Scratchpad loaded", item.title, "success")
		} catch (error) {
			showToastRef.current("Scratchpad failed", error instanceof Error ? error.message : String(error), "error")
		}
	}

	const openScratchpadPicker = () => {
		captureScratchpad()
	}

	const startScratchpad = async (id: string): Promise<void> => {
		let entry: { item: ScratchpadItem; body: string }
		try {
			entry = scratchpadStore.read(id)
		} catch (error) {
			showToastRef.current("Scratchpad failed", error instanceof Error ? error.message : String(error), "error")
			return
		}

		if (entry.item.cwd === sessionManager.projectCwd) {
			startFreshSession(entry.item.title)
			await submitPrompt(entry.body, "followUp")
			setTimeout(() => markScratchpadTriggered(entry.item.id), 250)
			return
		}

		const result = await workspaceSwitch.switchTo({
			cwd: entry.item.cwd,
			fresh: true,
			initialSessionTitle: entry.item.title,
			initialPrompt: entry.body,
			initialScratchpadId: entry.item.id,
			preserveLaneMode: preserveStickyLaneMode(),
		})
		if (!result.switched) {
			showToastRef.current("Scratchpad failed", `Could not switch to ${entry.item.cwd}`, "error")
		}
	}

	const startScratchpadPicker = () => {
		void (async () => {
			const item = await pickScratchpad("Start scratchpad")
			if (!item) return
			await startScratchpad(item.id)
		})()
	}

	const renameCurrentSession = () => {
		void (async () => {
			const current = syncCurrentSessionLane()
			if (!current) return
			const nextTitle = (await modals.showInput("Rename session", "session title", current.session.title))?.trim()
			if (!nextTitle || nextTitle === current.session.title) return
			const renamed = renameSessionLane(cloneWorkspaceLanes(workspaceLanes()), current.session.id, nextTitle)
			persistWorkspaceLanes(selectLane(renamed, { project: current.project, session: { ...current.session, title: nextTitle } }))
			showToastRef.current("Session renamed", nextTitle, "success")
		})()
	}

	const openCommandPalette = () => {
		void (async () => {
			syncCurrentSessionLane()
			const selected = await modals.showSearchSelect(
				"Command",
				createCommandPaletteOptions(workspaceLanes(), configuredProjects(), scratchpads()),
				"session, project, scratchpad, settings, archive, detach",
			)
			if (!selected) return
			const parsed = parseCommandPaletteValue(selected)
			if (!parsed) return
			if (parsed.type === "session") {
				const sessions = activeSessionLanes(workspaceLanes())
				const session = sessions.find((entry) => entry.id === parsed.sessionLaneId)
				const project = session ? workspaceLanes().projects.find((entry) => entry.id === session.projectId) : undefined
				if (!session || !project) return
				await switchToLane({ project, session }, { preserveLaneMode: preserveStickyLaneMode() })
				return
			}
			if (parsed.type === "project") {
				const project = configuredProjects().find((entry) => entry.cwd === parsed.cwd) ?? {
					cwd: parsed.cwd,
					title: parsed.cwd.split("/").filter(Boolean).at(-1) ?? parsed.cwd,
					root: parsed.cwd,
				}
				await switchToProject(project, { preserveLaneMode: preserveStickyLaneMode() })
				return
			}
			if (parsed.type === "scratchpad") {
				openScratchpad(parsed.id)
				return
			}
			switch (parsed.action) {
				case "settings":
					await editFileRef.current(config.configPath)
					return
				case "rename":
					renameCurrentSession()
					return
				case "newProjectSession":
					startSessionInProject()
					return
				case "saveScratchpad":
					saveCurrentScratchpad()
					return
				case "openScratchpad":
					openScratchpadPicker()
					return
				case "startScratchpad":
					startScratchpadPicker()
					return
				case "detach":
					exitHandlerRef.current()
					return
				case "archive":
					archiveCurrentSession()
					return
				case "restore":
					restoreArchivedSession()
					return
			}
		})()
	}

	const archiveCurrentSession = () => {
		void (async () => {
			const current = syncCurrentSessionLane()
			if (!current) return
			const archived = archiveSessionLane(cloneWorkspaceLanes(workspaceLanes()), current.session.id)
			const nextCursor = findActiveCursor(archived)
			if (!nextCursor) {
				persistWorkspaceLanes(archived)
				showToastRef.current("Session archived", "No active sessions left", "info")
				return
			}
			persistWorkspaceLanes(selectLane(archived, nextCursor))
			await switchToLane(nextCursor)
			showToastRef.current("Session archived", "Moved to next active session", "success")
		})()
	}

	const restoreArchivedSession = () => {
		void (async () => {
			const archivedSessions = workspaceLanes().sessions.filter((session) => session.archivedAt !== undefined)
			if (archivedSessions.length === 0) return
			const selected = await modals.showSearchSelect("Restore session", archivedSessions.map(laneSearchOption), "project, title, model, id")
			if (!selected) return
			const session = archivedSessions.find((entry) => entry.id === selected)
			const project = session ? workspaceLanes().projects.find((entry) => entry.id === session.projectId) : undefined
			if (!session || !project) return
			const restored = restoreSessionLane(cloneWorkspaceLanes(workspaceLanes()), session.id)
			persistWorkspaceLanes(selectLane(restored, { project, session: { ...session, archivedAt: undefined } }))
			await switchToLane({ project, session: { ...session, archivedAt: undefined } })
			showToastRef.current("Session restored", "Returned to active lanes", "success")
		})()
	}

	const themeMode = detectThemeMode()

	return (
		<Show when={isAppActive()}>
		<TuiLaneKeymapRoot>
			<TuiLaneKeyBindings
				navMode={navMode}
				setNavMode={setNavMode}
				keymap={config.keymap.lanes}
				modalOpen={() => modals.modalState() !== null}
				isResponding={store.isResponding.value}
				onNavigate={navigateLane}
				onJump={openCommandPalette}
				onArchive={archiveCurrentSession}
				onRestore={restoreArchivedSession}
				onDetach={() => exitHandlerRef.current()}
			/>
			<ThemeProvider mode={themeMode} themeName={store.theme.value()} onThemeChange={handleThemeChange}>
			<MainView
				validationIssues={validationIssues}
				messages={store.messages.value()}
				toolBlocks={store.toolBlocks.value()}
				isResponding={store.isResponding.value()}
				activityState={store.activityState.value()}
				thinkingVisible={store.thinkingVisible.value()}
				modelId={store.displayModelId.value()}
				thinking={store.displayThinking.value()}
				provider={store.currentProvider.value()}
				contextTokens={store.contextTokens.value()}
				contextWindow={store.displayContextWindow.value()}
				queueCounts={store.queueCounts.value()}
				retryStatus={store.retryStatus.value()}
				turnCount={store.turnCount.value()}
				lspActive={store.lspActive.value()}
				lane={laneHeaderState()}
				diffWrapMode={store.diffWrapMode.value()}
				concealMarkdown={store.concealMarkdown.value()}
				customCommands={customCommands}
				cwd={visibleCwd()}
				onSubmit={handleSubmit}
				onAbort={handleAbort}
				onToggleThinking={() => store.thinkingVisible.set((v) => !v)}
				onCycleModel={cycleModel}
				onCycleThinking={cycleThinking}
				exitHandlerRef={exitHandlerRef}
				editorOpenRef={editorOpenRef}
				editFileRef={editFileRef}
				setEditorTextRef={setEditorTextRef}
				getEditorTextRef={getEditorTextRef}
				showToastRef={showToastRef}
				clearEditorRef={clearEditorRef}
				onComposerChange={(text) => { composerDraft = text }}
				onBeforeExit={handleBeforeExit}
				editor={config.editor}
				lsp={lsp}
			/>
			<ModalContainer modalState={modals.modalState()} onClose={modals.closeModal} />
			</ThemeProvider>
		</TuiLaneKeymapRoot>
		</Show>
	)
}

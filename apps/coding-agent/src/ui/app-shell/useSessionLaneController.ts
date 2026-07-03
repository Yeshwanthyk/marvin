import { batch, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { Accessor, Setter } from "solid-js"
import { createSessionController, renderLoadedSessionView } from "@runtime/session/session-controller.js"
import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import {
	flushWorkspaceLanes,
	readWorkspaceLanes,
	scheduleWriteWorkspaceLanes,
	selectLane,
	upsertProjectLane,
	upsertSessionLane,
	type LaneCursor,
	type WorkspaceLanes,
} from "@yeshwanthyk/runtime-effect/workspace-lanes.js"
import type { LoadedSession, SessionInfo } from "../../session-manager.js"
import type { EventHandlerContext, ToolMeta } from "../../agent-events.js"
import type { useRuntime } from "../../runtime/context.js"
import type { VisibleSession } from "../../runtime/workspace-switch.js"
import type { UIMessage, ToolBlock } from "../../types.js"
import { resolveModel, resolveProvider } from "@domain/commands/helpers.js"
import { deriveLaneHeaderState } from "./lane-header-state.js"
import type { LaneNavMode } from "./TuiLaneKeymap.js"
import type { createAppStore } from "../state/app-store.js"

type RuntimeContext = ReturnType<typeof useRuntime>
type AppStore = ReturnType<typeof createAppStore>
type Provider = RuntimeContext["config"]["provider"]
type Thinking = RuntimeContext["config"]["thinking"]
type LaneHeaderState = ReturnType<typeof deriveLaneHeaderState>

export interface UseSessionLaneControllerDeps {
	initialSession: LoadedSession | null
	initialVisibleSession?: VisibleSession
	initialSessionTitle?: string
	startNewSession?: boolean
	initialNavMode?: LaneNavMode
	config: RuntimeContext["config"]
	agent: RuntimeContext["agent"]
	sessionManager: RuntimeContext["sessionManager"]
	hookRunner: RuntimeContext["hookRunner"]
	toolMetaByName: Map<string, ToolMeta>
	store: AppStore
	shellInjectionPrefix: string
	submitPrompt: (text: string, options?: { mode?: PromptDeliveryMode }) => Promise<void>
}

export interface SessionLaneController {
	sessionController: ReturnType<typeof createSessionController>
	workspaceLanes: Accessor<WorkspaceLanes>
	setWorkspaceLanes: Setter<WorkspaceLanes>
	refreshWorkspaceLanes: () => void
	navMode: Accessor<LaneNavMode>
	setNavMode: Setter<LaneNavMode>
	laneHeaderState: Accessor<LaneHeaderState>
	visibleSession: Accessor<VisibleSession>
	setVisibleSession: Setter<VisibleSession>
	visibleSessionForLoaded: (session: LoadedSession, sessionPath?: string) => VisibleSession
	visibleCwd: () => string
	isVisibleActiveSession: (visible: VisibleSession) => boolean
	isActiveSessionVisible: () => boolean
	showActiveSessionView: () => void
	setActiveMessages: EventHandlerContext["setMessages"]
	setActiveToolBlocks: EventHandlerContext["setToolBlocks"]
	setActiveContextTokens: EventHandlerContext["setContextTokens"]
	setActiveDisplayProvider: (value: Provider) => void
	setActiveDisplayModelId: (value: string) => void
	setActiveDisplayThinking: (value: Thinking) => void
	setActiveDisplayContextWindow: (value: number) => void
	activeDisplayContextWindow: () => number
	cloneWorkspaceLanes: (value: WorkspaceLanes) => WorkspaceLanes
	persistWorkspaceLanes: (next: WorkspaceLanes) => void
	getCurrentSessionInfo: () => SessionInfo | null
	syncCurrentSessionLane: (title?: string, options?: { select?: boolean }) => LaneCursor | null
	seedCurrentProjectLanes: () => void
	applyLoadedSessionDisplay: (session: LoadedSession, contextTokens: number) => void
	applyVisibleSession: (nextVisible: VisibleSession) => void
	ensureSession: () => void
	prepareFreshSession: (title?: string) => void
	startFreshSession: (title?: string) => void
	getPendingSessionTitle: () => string | undefined
	clearPendingSessionTitle: () => void
}

export const useSessionLaneController = ({
	initialSession,
	initialVisibleSession,
	initialSessionTitle,
	startNewSession,
	initialNavMode,
	config,
	agent,
	sessionManager,
	hookRunner,
	toolMetaByName,
	store,
	shellInjectionPrefix,
	submitPrompt,
}: UseSessionLaneControllerDeps): SessionLaneController => {
	const [workspaceLanes, setWorkspaceLanes] = createSignal<WorkspaceLanes>(readWorkspaceLanes(config.configDir))
	const [navMode, setNavMode] = createSignal<LaneNavMode>(initialNavMode ?? "off")
	const laneHeaderState = createMemo(() => deriveLaneHeaderState(workspaceLanes(), navMode()))

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
	let pendingSessionTitle: string | undefined

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

	const setActiveDisplayProvider = (value: Provider) => {
		setActiveDisplayProviderSignal(value)
		if (isActiveSessionVisible()) store.currentProvider.set(value)
	}

	const setActiveDisplayModelId = (value: string) => {
		setActiveDisplayModelIdSignal(value)
		if (isActiveSessionVisible()) store.displayModelId.set(value)
	}

	const setActiveDisplayThinking = (value: Thinking) => {
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
		shellInjectionPrefix,
		submitPrompt,
	})

	const cloneWorkspaceLanes = (value: WorkspaceLanes): WorkspaceLanes => structuredClone(value)

	const persistWorkspaceLanes = (next: WorkspaceLanes) => {
		scheduleWriteWorkspaceLanes(config.configDir, next)
		setWorkspaceLanes(next)
	}

	const refreshWorkspaceLanes = () => {
		setWorkspaceLanes(readWorkspaceLanes(config.configDir))
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
			const view = renderLoadedSessionView(nextVisible.session.messages, {
				toolByName: toolMetaByName,
				shellInjectionPrefix,
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

	onCleanup(() => {
		void flushWorkspaceLanes(config.configDir)
	})

	return {
		sessionController,
		workspaceLanes,
		setWorkspaceLanes,
		refreshWorkspaceLanes,
		navMode,
		setNavMode,
		laneHeaderState,
		visibleSession,
		setVisibleSession,
		visibleSessionForLoaded,
		visibleCwd,
		isVisibleActiveSession,
		isActiveSessionVisible,
		showActiveSessionView,
		setActiveMessages,
		setActiveToolBlocks,
		setActiveContextTokens,
		setActiveDisplayProvider,
		setActiveDisplayModelId,
		setActiveDisplayThinking,
		setActiveDisplayContextWindow,
		activeDisplayContextWindow,
		cloneWorkspaceLanes,
		persistWorkspaceLanes,
		getCurrentSessionInfo,
		syncCurrentSessionLane,
		seedCurrentProjectLanes,
		applyLoadedSessionDisplay,
		applyVisibleSession,
		ensureSession,
		prepareFreshSession,
		startFreshSession,
		getPendingSessionTitle: () => pendingSessionTitle,
		clearPendingSessionTitle: () => {
			pendingSessionTitle = undefined
		},
	}
}

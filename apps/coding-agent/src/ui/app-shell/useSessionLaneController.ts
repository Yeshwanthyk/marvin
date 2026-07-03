import { batch, createMemo, createSignal, onMount } from "solid-js"
import type { Accessor, Setter } from "solid-js"
import { randomUUID } from "node:crypto"
import { createSessionController, renderLoadedSessionView } from "@runtime/session/session-controller.js"
import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import {
	createSessionLaneInput,
	type InsertPosition,
	type LaneCursorV2,
	type LaneId,
	type SessionLaneInput,
	type WorkspaceLanePatch,
	type WorkspaceLaneStore,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
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
	laneStore: WorkspaceLaneStore
	workspaceLanes: Accessor<WorkspaceLanesV2>
	shellInjectionPrefix: string
	submitPrompt: (text: string, options?: { mode?: PromptDeliveryMode }) => Promise<void>
}

export interface SessionLaneController {
	sessionController: ReturnType<typeof createSessionController>
	workspaceLanes: Accessor<WorkspaceLanesV2>
	laneStore: WorkspaceLaneStore
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
	getCurrentSessionInfo: () => SessionInfo | null
	syncCurrentSessionLane: (title?: string, options?: { select?: boolean }) => LaneCursorV2 | null
	seedCurrentProjectLanes: () => void
	applyLoadedSessionDisplay: (session: LoadedSession, contextTokens: number) => void
	applyVisibleSession: (nextVisible: VisibleSession) => void
	ensureSession: () => void
	prepareFreshSession: (title?: string) => void
	startFreshSession: (title?: string) => void
	getPendingSessionTitle: () => string | undefined
	clearPendingSessionTitle: () => void
}

export interface SessionLaneSyncPatchInput {
	readonly lanes: WorkspaceLanesV2
	readonly cwd: string
	readonly session: SessionInfo
	readonly title?: string
	readonly laneId: LaneId
	readonly select?: boolean
}

const projectTitle = (cwd: string): string => {
	const normalized = cwd.replace(/\/+$/, "")
	return normalized.split("/").filter(Boolean).at(-1) ?? normalized
}

export const findSessionLaneId = (
	lanes: WorkspaceLanesV2,
	projectId: string,
	session: SessionInfo,
): LaneId | undefined => {
	const order = lanes.sessionOrderByProject[projectId] ?? []
	for (const laneId of order) {
		const lane = lanes.sessionsById[laneId]
		if (!lane) continue
		if (lane.sessionPath === session.path || lane.sessionId === session.id) return laneId
	}
	for (const lane of Object.values(lanes.sessionsById)) {
		if (lane.projectId !== projectId) continue
		if (lane.sessionPath === session.path || lane.sessionId === session.id) return lane.laneId
	}
	return undefined
}

const preserveExistingInsert = (
	lanes: WorkspaceLanesV2,
	projectId: string,
	laneId: LaneId,
): InsertPosition | undefined => {
	const index = (lanes.sessionOrderByProject[projectId] ?? []).indexOf(laneId)
	return index >= 0 ? { type: "index", projectId, index } : undefined
}

export const createSessionLaneSyncPatches = ({
	lanes,
	cwd,
	session,
	title,
	laneId,
	select,
}: SessionLaneSyncPatchInput): WorkspaceLanePatch[] => {
	const now = new Date().toISOString()
	const insert = preserveExistingInsert(lanes, cwd, laneId)
	const existing = lanes.sessionsById[laneId]
	const sessionInput: SessionLaneInput = createSessionLaneInput({
		laneId,
		projectId: cwd,
		sessionId: session.id,
		sessionPath: session.path,
		title: title ?? existing?.title ?? session.id.slice(0, 8),
		provider: session.provider,
		modelId: session.modelId,
		createdAt: existing?.createdAt ?? new Date(session.timestamp).toISOString(),
		updatedAt: now,
	})
	const patches: WorkspaceLanePatch[] = [
		{
			type: "upsertProject",
			project: {
				id: cwd,
				cwd,
				title: lanes.projectsById[cwd]?.title ?? projectTitle(cwd),
				createdAt: lanes.projectsById[cwd]?.createdAt ?? now,
				updatedAt: now,
			},
		},
		insert
			? { type: "upsertSession", session: sessionInput, insert }
			: { type: "upsertSession", session: sessionInput },
	]
	if (select === true) patches.push({ type: "select", projectId: cwd, laneId })
	return patches
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
	laneStore,
	workspaceLanes,
	shellInjectionPrefix,
	submitPrompt,
}: UseSessionLaneControllerDeps): SessionLaneController => {
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

	const syncCurrentSessionLane = (title?: string, options: { select?: boolean } = {}): LaneCursorV2 | null => {
		const session = getCurrentSessionInfo()
		if (!session) return null
		const lanes = workspaceLanes()
		const selectedLaneId = lanes.selection?.projectId === sessionManager.projectCwd ? lanes.selection.laneId : undefined
		const selectedLane = selectedLaneId ? lanes.sessionsById[selectedLaneId] : undefined
		const emptySelectedLaneId = selectedLane?.sessionPath === null ? selectedLane.laneId : undefined
		const existingLaneId = findSessionLaneId(lanes, sessionManager.projectCwd, session)
		const laneId = existingLaneId ?? emptySelectedLaneId ?? randomUUID()
		const patches = createSessionLaneSyncPatches({
			lanes,
			cwd: sessionManager.projectCwd,
			session,
			title,
			laneId,
			select: options.select ?? isActiveSessionVisible(),
		})
		const next = laneStore.transact(patches)
		const project = next.projectsById[sessionManager.projectCwd]
		const lane = next.sessionsById[laneId]
		if (!project || !lane) return null
		const shouldSelect = options.select ?? isActiveSessionVisible()
		const sessionIndex = (next.sessionOrderByProject[project.id] ?? []).indexOf(lane.laneId)
		const projectIndex = next.projectOrder.indexOf(project.id)
		if (shouldSelect && next.selection?.laneId !== lane.laneId) {
			laneStore.dispatch({ type: "select", projectId: project.id, laneId: lane.laneId })
		}
		return { project, session: lane, projectIndex: Math.max(0, projectIndex), sessionIndex: Math.max(0, sessionIndex) }
	}

	const seedCurrentProjectLanes = () => {
		const lanes = workspaceLanes()
		const now = new Date().toISOString()
		const patches: WorkspaceLanePatch[] = [{
			type: "upsertProject",
			project: {
				id: sessionManager.projectCwd,
				cwd: sessionManager.projectCwd,
				updatedAt: now,
			},
		}]
		for (const session of sessionManager.loadAllSessions()) {
			if (session.messageCount === 0 || session.firstMessage.startsWith("System context:")) continue
			const title = session.firstMessage.replace(/\s+/g, " ").trim().slice(0, 80) || session.id.slice(0, 8)
			const existingLaneId = findSessionLaneId(lanes, sessionManager.projectCwd, session)
			const laneId = existingLaneId ?? randomUUID()
			const insert = preserveExistingInsert(lanes, sessionManager.projectCwd, laneId)
			const sessionInput = createSessionLaneInput({
				laneId,
				projectId: sessionManager.projectCwd,
				sessionId: session.id,
				sessionPath: session.path,
				title,
				provider: session.provider,
				modelId: session.modelId,
				createdAt: new Date(session.timestamp).toISOString(),
				updatedAt: now,
			})
			patches.push(insert
				? { type: "upsertSession", session: sessionInput, insert }
				: { type: "upsertSession", session: sessionInput })
		}
		laneStore.transact(patches)
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

	return {
		sessionController,
		workspaceLanes,
		laneStore,
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

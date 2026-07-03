import { ThemeProvider } from "@yeshwanthyk/open-tui"
import { createEffect, createSignal, onMount, Show } from "solid-js"
import type { Accessor } from "solid-js"
import { useRuntime } from "../../runtime/context.js"
import type { SessionActor } from "../../runtime/session-actor.js"
import type { LoadedSession, SessionTreeNode, SessionNodeEntry } from "../../session-manager.js"
import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import { appendWithCap } from "@domain/messaging/content.js"
import type { UIShellMessage } from "../../types.js"
import type { AppMessage } from "@yeshwanthyk/agent-core"
import { runShellCommand } from "../../shell-runner.js"
import { createAppStore } from "../state/app-store.js"
import { detectThemeMode } from "../theme-detect.js"
import type { ToolMeta } from "../../agent-events.js"
import type { CommandContext } from "../../commands.js"
import { slashCommands } from "../../autocomplete-commands.js"
import { updateAppConfig } from "@yeshwanthyk/runtime-effect/config.js"
import { handleSlashInput } from "../features/composer/SlashCommandHandler.js"
import { useModals } from "../hooks/useModals.js"
import { ModalContainer } from "../components/modals/ModalContainer.js"
import type { SearchSelectOption } from "../components/modals/search-select-options.js"
import { useWorkspaceSwitch, type VisibleSession } from "../../runtime/workspace-switch.js"
import {
	activeSessionsForProject,
	findActiveCursorV2,
	type LaneCursorV2,
	type SessionLaneV2,
	type WorkspaceLaneStore,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import type { WorkspaceProject } from "@yeshwanthyk/runtime-effect/workspace-projects.js"
import { createScratchpadStore } from "@yeshwanthyk/runtime-effect/scratchpads.js"
import { TuiLaneKeyBindings, TuiLaneKeymapRoot, type LaneKeymapDirection, type LaneMoveDirection, type LaneNavMode } from "./TuiLaneKeymap.js"
import { createCommandPaletteOptions, parseCommandPaletteValue } from "./command-palette-options.js"
import { canMoveFocusedSessionAcrossProject } from "./lane-actions.js"
import { createOverviewOptions, parseOverviewValue } from "./overview-options.js"
import { useHookBridge } from "./useHookBridge.js"
import { usePromptSubmission } from "./usePromptSubmission.js"
import { useSessionLaneController } from "./useSessionLaneController.js"
import { useScratchpadActions } from "./useScratchpadActions.js"
import { useWorkspaceProjectDiscovery } from "./useWorkspaceProjectDiscovery.js"
import type { HostNotification, SessionActivity } from "./activity-index.js"
import { SessionView } from "./SessionView.js"

const SHELL_INJECTION_PREFIX = "[Shell output]" as const

const activeSessionLanesV2 = (lanes: WorkspaceLanesV2): SessionLaneV2[] =>
	lanes.projectOrder.flatMap((projectId) => activeSessionsForProject(lanes, projectId))

const activeProjectIdsV2 = (lanes: WorkspaceLanesV2): string[] =>
	lanes.projectOrder.filter((projectId) => lanes.projectsById[projectId]?.archivedAt === undefined)

const textFromEntry = (entry: SessionNodeEntry): string => {
	if (entry.type === "custom") return `[custom:${entry.customType}]`
	const message = entry.message
	const content = "content" in message ? message.content : undefined
	const role = message.role ?? "message"
	if (content === undefined) return role
	const text = typeof content === "string"
		? content
		: Array.isArray(content)
			? content
				.map((part) => {
					if (typeof part !== "object" || part === null) return ""
					if (Reflect.get(part, "type") !== "text") return ""
					const value = Reflect.get(part, "text")
					return typeof value === "string" ? value : ""
				})
				.filter((value) => value.length > 0)
				.join(" ")
			: ""
	const compact = text.replace(/\s+/g, " ").trim()
	const fallbackName = "name" in message && typeof message.name === "string" ? message.name : undefined
	const fallbackToolName = "toolName" in message && typeof message.toolName === "string" ? message.toolName : undefined
	return `${role}: ${compact || fallbackName || fallbackToolName || entry.id}`
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
	laneStore: WorkspaceLaneStore
	workspaceLanes: Accessor<WorkspaceLanesV2>
	hostNotifications?: Accessor<readonly HostNotification[]>
	activityEntries?: Accessor<readonly SessionActivity[]>
	acknowledgeHostNotification?: (id: string) => void
	focusedActor?: Accessor<SessionActor | null>
	canStartPrompt?: () => { ok: true } | { ok: false; maxStreaming: number }
	removeLaneActor?: (laneId: string) => Promise<void>
	active?: () => boolean
	onActivityChange?: (activity: TuiAppActivity) => void
	onExit?: () => void
}

export interface TuiAppActivity {
	isResponding: boolean
	sessionId: string | null
	sessionPath: string | null
	sessionTitle?: string
	lastError: string | null
	tokenCount: number
	lastObservedAt: number
}

export const TuiApp = ({ initialSession, initialVisibleSession, initialPrompt, initialScratchpadId, initialSessionTitle, startNewSession, initialNavMode, laneStore, workspaceLanes, hostNotifications, activityEntries, acknowledgeHostNotification, focusedActor, canStartPrompt, removeLaneActor, active, onActivityChange, onExit }: TuiAppProps) => {
	const runtime = useRuntime()
	const {
		agent,
		sessionManager,
		hookRunner,
		toolByName,
		customCommands,
		config,
		codexTransport,
		getApiKey,
		sendRef,
		cycleModels,
		validationIssues,
	} = runtime

	const toolMetaByName = new Map<string, ToolMeta>()
	const refreshToolMeta = () => {
		toolMetaByName.clear()
		for (const [name, entry] of toolByName.entries()) {
			const renderCall = entry.renderCall && typeof entry.renderCall === "function"
				? (entry.renderCall as ToolMeta["renderCall"])
				: undefined
			const renderResult = entry.renderResult && typeof entry.renderResult === "function"
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
	}
	refreshToolMeta()

	const store = createAppStore({
		initialTheme: config.theme,
		initialModelId: config.modelId,
		initialThinking: config.thinking,
		initialContextWindow: config.model.contextWindow,
		initialProvider: config.provider,
	})

	const modals = useModals()
	const workspaceSwitch = useWorkspaceSwitch()
	const scratchpadStore = createScratchpadStore(config.configDir)
	const { projects: configuredProjects } = useWorkspaceProjectDiscovery({
		projectRoots: () => config.workspace.projectRoots,
	})
	const isAppActive = () => active?.() ?? true
	const showToastRef = { current: (_title: string, _message: string, _variant?: "info" | "warning" | "success" | "error") => {} }
	const [lastError, setLastError] = createSignal<string | null>(null)
	let submitPromptImpl = async (_text: string, _mode: PromptDeliveryMode = "followUp") => {}

	const laneController = useSessionLaneController({
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
		activityEntries,
		shellInjectionPrefix: SHELL_INJECTION_PREFIX,
		submitPrompt: (text, options) => submitPromptImpl(text, options?.mode ?? "followUp"),
	})
	const {
		sessionController,
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
		activeDisplayContextWindow,
		syncCurrentSessionLane,
		applyVisibleSession,
		ensureSession,
		prepareFreshSession: prepareFreshSessionBase,
		startFreshSession: startFreshSessionBase,
		getPendingSessionTitle,
		clearPendingSessionTitle,
	} = laneController
	const preserveStickyLaneMode = () => navMode() === "sticky"

	createEffect(() => {
		const actor = focusedActor?.()
		refreshToolMeta()
		const projection = actor?.projection
		if (!projection) return
		store.messages.set(() => projection.messages())
		store.toolBlocks.set(() => projection.toolBlocks())
		store.contextTokens.set(projection.contextTokens())
		store.isResponding.set(projection.isResponding())
		store.activityState.set(projection.activityState())
		store.retryStatus.set(projection.retryStatus())
		store.currentProvider.set(config.provider)
		store.displayModelId.set(config.modelId)
		store.displayThinking.set(config.thinking)
		store.displayContextWindow.set(config.model.contextWindow)
	})

	const promptSubmission = usePromptSubmission({
		runtime,
		hookRunner,
		sessionManager,
		store,
		activateVisibleSessionForSubmit: () => activateVisibleSessionForSubmit(),
		revealLiveSession: () => revealLiveSession(),
		syncCurrentSessionLane: (title, options) => syncCurrentSessionLane(title, options),
		getPendingSessionTitle,
		clearPendingSessionTitle,
		showToast: (title, message, variant) => showToastRef.current(title, message, variant),
		activeKey: () => focusedActor?.()?.laneId ?? sessionManager.projectCwd,
		canStartPrompt,
	})
	const {
		promptQueue,
		submitPrompt,
		steerHelper,
		followUpHelper,
		sendUserMessageHelper,
		enqueueWhileResponding,
	} = promptSubmission
	submitPromptImpl = submitPrompt

	const markScratchpadTriggered = (id: string | undefined) => {
		if (!id || !sessionManager.sessionId) return
		try {
			scratchpadStore.markTriggered(id, sessionManager.sessionId)
		} catch {
			// Scratchpad startup should not block the session itself.
		}
	}

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

	let composerDraft = ""
	const prepareFreshSession = (title?: string) => {
		composerDraft = ""
		prepareFreshSessionBase(title)
	}
	const startFreshSession = (title?: string) => {
		composerDraft = ""
		startFreshSessionBase(title)
	}

	const handleThemeChange = (name: string) => {
		store.theme.set(name)
		void updateAppConfig({ configDir: config.configDir, configPath: config.configPath }, { theme: name })
	}

	const exitHandlerRef = { current: () => { onExit?.() ?? process.exit(0) } }
	const editorOpenRef = { current: async () => {} }
	const editFileRef = { current: async (_filePath: string, _line?: number) => {} }
	const setEditorTextRef = { current: (_text: string) => {} }
	const getEditorTextRef = { current: () => "" }
	const clearEditorRef = { current: () => {} }
	const composerSelectionActiveRef = { current: () => false }
	const {
		scratchpads,
		saveCurrentScratchpad,
		openScratchpad,
		openScratchpadPicker,
		startScratchpadPicker,
	} = useScratchpadActions({
		scratchpadStore,
		sessionManager,
		modals,
		getEditorText: () => getEditorTextRef.current(),
		setEditorText: (text) => setEditorTextRef.current(text),
		showToast: (title, message, variant) => showToastRef.current(title, message, variant),
		switchToFreshWorkspace: async (cwd, options) => {
			const result = await workspaceSwitch.switchTo({
				cwd,
				fresh: true,
				initialSessionTitle: options.title,
				initialPrompt: options.prompt,
				initialScratchpadId: options.scratchpadId,
				preserveLaneMode: preserveStickyLaneMode(),
			})
			if (!result.switched) return false
			applyVisibleSession(result.visibleSession)
			prepareFreshSession(options.title)
			if (options.prompt) {
				await submitPrompt(options.prompt, "followUp")
				setTimeout(() => markScratchpadTriggered(options.scratchpadId), 250)
			}
			return true
		},
	})
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

	createEffect(() => {
		const sessionId = sessionManager.sessionId
		const sessionPath = sessionManager.sessionPath
		const lane = Object.values(workspaceLanes().sessionsById).find((entry) =>
			(sessionPath !== null && entry.sessionPath === sessionPath) ||
			(sessionId !== null && entry.sessionId === sessionId)
		)
		onActivityChange?.({
			isResponding: store.isResponding.value(),
			sessionId,
			sessionPath,
			...(lane?.title ? { sessionTitle: lane.title } : {}),
			lastError: lastError(),
			tokenCount: store.contextTokens.value(),
			lastObservedAt: Date.now(),
		})
	})

	const currentCwd = () => sessionManager.projectCwd
	const cmdCtx: CommandContext = {
		agent,
		sessionManager,
		get configDir() {
			return config.configDir
		},
		get configPath() {
			return config.configPath
		},
		get cwd() {
			return currentCwd()
		},
		get editor() {
			return config.editor
		},
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

			const result = await runShellCommand(command, { timeout: 30000, cwd: currentCwd() })
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

	useHookBridge({
		agent,
		sessionManager,
		hookRunner,
		getApiKey,
		customCommands,
		builtInCommandNames,
		cmdCtx,
		sessionController,
		setMessages: store.messages.set,
		setEditorText: (text) => setEditorTextRef.current(text),
		getEditorText: () => getEditorTextRef.current(),
		showSelect: modals.showSelect,
		showInput: modals.showInput,
		showConfirm: modals.showConfirm,
		showEditor: modals.showEditor,
		showToast: (title, message, variant) => showToastRef.current(title, message, variant),
		startFreshSession,
		handleSubmit,
		sendUserMessage: sendUserMessageHelper,
		steer: steerHelper,
		followUp: followUpHelper,
		isResponding: store.isResponding.value,
		activeKey: () => focusedActor?.()?.laneId ?? sessionManager.projectCwd,
	})

	sendRef.current = (text) => void handleSubmit(text)

	const switchToLane = async (cursor: LaneCursorV2, options?: { preserveLaneMode?: boolean }): Promise<boolean> => {
		const sessionPath = cursor.session.sessionPath
		if (sessionPath === null) {
			showToastRef.current("Session unavailable", "Lane has no session file yet", "warning")
			return false
		}
		const previousSelection = workspaceLanes().selection
		laneStore.dispatch({ type: "select", projectId: cursor.project.id, laneId: cursor.session.laneId })
		const result = await workspaceSwitch.switchTo({
			cwd: cursor.project.cwd,
			laneId: cursor.session.laneId,
			sessionPath,
			preserveLaneMode: options?.preserveLaneMode,
		})
		if (!result.switched) {
			if (previousSelection) laneStore.dispatch({ type: "select", projectId: previousSelection.projectId, laneId: previousSelection.laneId })
			return false
		}
		applyVisibleSession(result.visibleSession)

		if (!options?.preserveLaneMode) setNavMode("off")
		return true
	}

	const navigateLane = (direction: LaneKeymapDirection) => {
		void (async () => {
			const preserveLaneMode = navMode() === "sticky"
			syncCurrentSessionLane()
			const next = laneStore.dispatch({ type: "focus", direction })
			const cursor = findActiveCursorV2(next)
			if (!cursor) return
			await switchToLane(cursor, { preserveLaneMode })
		})()
	}

	const moveFocusedLane = (direction: LaneMoveDirection) => {
		void (async () => {
			const current = syncCurrentSessionLane()
			if (!current) return
			if ((direction === "up" || direction === "down") && !canMoveFocusedSessionAcrossProject(focusedActor?.()?.status(), store.isResponding.value())) {
				showToastRef.current("Session still running", "Wait for the stream before moving it to another project", "warning")
				return
			}
			const patch = direction === "left" || direction === "right"
				? { type: "reorderSession" as const, laneId: current.session.laneId, direction }
				: { type: "moveSessionToProject" as const, laneId: current.session.laneId, direction }
			const next = laneStore.dispatch(patch)
			if (direction === "up" || direction === "down") await removeLaneActor?.(current.session.laneId)
			const cursor = findActiveCursorV2(next, next.selection)
			if (!cursor) return
			await switchToLane(cursor)
		})()
	}

	const startSessionNextToFocus = () => {
		void (async () => {
			const previous = syncCurrentSessionLane()
			startFreshSession("new session")
			const current = syncCurrentSessionLane(undefined, { select: true })
			if (!previous || !current || previous.session.laneId === current.session.laneId) return
			laneStore.transact([
				{ type: "upsertSession", session: current.session, insert: { type: "after", laneId: previous.session.laneId } },
				{ type: "select", projectId: current.project.id, laneId: current.session.laneId },
			])
		})()
	}

	const jumpToProjectIndex = (index: number) => {
		void (async () => {
			syncCurrentSessionLane()
			const lanes = workspaceLanes()
			const projectId = activeProjectIdsV2(lanes)[index]
			const project = projectId ? lanes.projectsById[projectId] : undefined
			if (!project) return
			const activeSessions = activeSessionsForProject(lanes, project.id)
			if (activeSessions.length === 0) {
				await switchToProject({ cwd: project.cwd, title: project.title, root: project.cwd }, { fresh: true })
				return
			}
			const remembered = lanes.focusByProject[project.id]
			const rememberedLaneId = remembered?.focusedLaneId && activeSessions.some((session) => session.laneId === remembered.focusedLaneId)
				? remembered.focusedLaneId
				: activeSessions[Math.min(Math.max(remembered?.focusedColumn ?? 0, 0), activeSessions.length - 1)]?.laneId
			const laneId = rememberedLaneId ?? activeSessions[0]?.laneId
			if (!laneId) return
			const selected = laneStore.dispatch({ type: "select", projectId: project.id, laneId })
			const cursor = findActiveCursorV2(selected, { projectId: project.id, laneId })
			if (!cursor) return
			await switchToLane(cursor, { preserveLaneMode: preserveStickyLaneMode() })
		})()
	}

	const openOverview = () => {
		void (async () => {
			syncCurrentSessionLane()
			const lanes = workspaceLanes()
			const selected = await modals.showSearchSelect(
				"Overview",
				createOverviewOptions(lanes, activityEntries?.() ?? []),
				"project, title, status, model, id",
			)
			if (!selected) return
			const parsed = parseOverviewValue(selected)
			if (!parsed) return
			const session = lanes.sessionsById[parsed.laneId]
			const project = session ? lanes.projectsById[session.projectId] : undefined
			if (!session || !project || session.archivedAt !== undefined) return
			const projectIndex = lanes.projectOrder.indexOf(project.id)
			const sessionIndex = (lanes.sessionOrderByProject[project.id] ?? []).indexOf(session.laneId)
			await switchToLane({ project, session, projectIndex: Math.max(0, projectIndex), sessionIndex: Math.max(0, sessionIndex) }, { preserveLaneMode: preserveStickyLaneMode() })
		})()
	}

	const projectTitleFor = (projectId: string): string =>
		workspaceLanes().projectsById[projectId]?.title ?? projectId

	const laneSearchOption = (session: SessionLaneV2): SearchSelectOption => {
		const projectTitle = projectTitleFor(session.projectId)
		const shortId = (session.sessionId ?? session.laneId).slice(0, 8)
		const model = `${session.provider}/${session.modelId}`
		return {
			value: session.laneId,
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

	const pickConfiguredProject = async (title: string): Promise<WorkspaceProject | null> => {
		const projects = configuredProjects()
		if (projects.length === 0) {
			showToastRef.current("No project roots", "Add workspace.projectRoots in config", "warning")
			return null
		}
		const selected = await modals.showSearchSelect(title, projects.map(projectSearchOption), "project or folder")
		return selected ? projects.find((project) => project.cwd === selected) ?? null : null
	}

	const switchToProject = async (project: WorkspaceProject, options?: { fresh?: boolean; preserveLaneMode?: boolean }): Promise<boolean> => {
		const fresh = options?.fresh === true || activeSessionsForProject(workspaceLanes(), project.cwd).length === 0
		const result = await workspaceSwitch.switchTo({
			cwd: project.cwd,
			fresh,
			initialSessionTitle: fresh ? "new session" : undefined,
			preserveLaneMode: options?.preserveLaneMode,
		})
		if (!result.switched) return false
		applyVisibleSession(result.visibleSession)
		if (fresh) prepareFreshSession()
		return true
	}

	const startSessionInProject = () => {
		void (async () => {
			const project = await pickConfiguredProject("New session in project")
			if (!project) return
			await switchToProject(project, { fresh: true, preserveLaneMode: preserveStickyLaneMode() })
		})()
	}


	const renameCurrentSession = () => {
		void (async () => {
			const current = syncCurrentSessionLane()
			if (!current) return
			const nextTitle = (await modals.showInput("Rename session", "session title", current.session.title))?.trim()
			if (!nextTitle || nextTitle === current.session.title) return
			laneStore.transact([
				{ type: "renameSession", laneId: current.session.laneId, title: nextTitle },
				{ type: "select", projectId: current.project.id, laneId: current.session.laneId },
			])
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
				const lanes = workspaceLanes()
				const session = activeSessionLanesV2(lanes).find((entry) => entry.laneId === parsed.sessionLaneId)
				const project = session ? lanes.projectsById[session.projectId] : undefined
				if (!session || !project) return
				const projectIndex = lanes.projectOrder.indexOf(project.id)
				const sessionIndex = (lanes.sessionOrderByProject[project.id] ?? []).indexOf(session.laneId)
				await switchToLane({ project, session, projectIndex: Math.max(0, projectIndex), sessionIndex: Math.max(0, sessionIndex) }, { preserveLaneMode: preserveStickyLaneMode() })
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
			const archived = laneStore.dispatch({ type: "archiveSession", laneId: current.session.laneId })
			const nextCursor = findActiveCursorV2(archived)
			if (!nextCursor) {
				showToastRef.current("Session archived", "No active sessions left", "info")
				return
			}
			await switchToLane(nextCursor)
			showToastRef.current("Session archived", "Moved to next active session", "success")
		})()
	}

	const restoreArchivedSession = () => {
		void (async () => {
			const archivedSessions = Object.values(workspaceLanes().sessionsById).filter((session) => session.archivedAt !== undefined)
			if (archivedSessions.length === 0) return
			const selected = await modals.showSearchSelect("Restore session", archivedSessions.map(laneSearchOption), "project, title, model, id")
			if (!selected) return
			const session = archivedSessions.find((entry) => entry.laneId === selected)
			const project = session ? workspaceLanes().projectsById[session.projectId] : undefined
			if (!session || !project) return
			const restored = laneStore.transact([
				{ type: "restoreSession", laneId: session.laneId },
				{ type: "select", projectId: project.id, laneId: session.laneId },
			])
			const restoredSession = restored.sessionsById[session.laneId]
			const restoredProject = restored.projectsById[project.id]
			if (!restoredSession || !restoredProject) return
			const projectIndex = restored.projectOrder.indexOf(restoredProject.id)
			const sessionIndex = (restored.sessionOrderByProject[restoredProject.id] ?? []).indexOf(restoredSession.laneId)
			await switchToLane({
				project: restoredProject,
				session: restoredSession,
				projectIndex: Math.max(0, projectIndex),
				sessionIndex: Math.max(0, sessionIndex),
			})
			showToastRef.current("Session restored", "Returned to active lanes", "success")
		})()
	}

	const themeMode = detectThemeMode()

	return (
		<TuiLaneKeymapRoot>
			<ThemeProvider mode={themeMode} themeName={store.theme.value()} onThemeChange={handleThemeChange}>
			<SessionView
				store={store}
				agent={agent}
				sessionManager={sessionManager}
				hookRunner={hookRunner}
				customCommands={customCommands}
				config={config}
				cycleModels={cycleModels}
				validationIssues={validationIssues}
				toolMetaByName={toolMetaByName}
				sessionController={sessionController}
				setActiveMessages={setActiveMessages}
				setActiveToolBlocks={setActiveToolBlocks}
				setActiveContextTokens={setActiveContextTokens}
				activeDisplayContextWindow={activeDisplayContextWindow}
				projection={() => focusedActor?.()?.projection ?? null}
				promptQueue={promptQueue}
				setLastError={setLastError}
				laneHeaderState={laneHeaderState}
				visibleCwd={visibleCwd}
				active={isAppActive}
				onSubmit={handleSubmit}
				hostNotifications={hostNotifications}
				acknowledgeHostNotification={acknowledgeHostNotification}
				exitHandlerRef={exitHandlerRef}
				editorOpenRef={editorOpenRef}
				editFileRef={editFileRef}
				setEditorTextRef={setEditorTextRef}
				getEditorTextRef={getEditorTextRef}
				showToastRef={showToastRef}
				clearEditorRef={clearEditorRef}
				composerSelectionActiveRef={composerSelectionActiveRef}
				onComposerChange={(text) => { composerDraft = text }}
				onBeforeExit={handleBeforeExit}
			/>
			<Show when={isAppActive()}>
			<TuiLaneKeyBindings
				navMode={navMode}
				setNavMode={setNavMode}
				keymap={config.keymap.lanes}
				modalOpen={() => modals.modalState() !== null}
				isResponding={store.isResponding.value}
				shouldOwnShiftArrows={() => !composerSelectionActiveRef.current()}
				onNavigate={navigateLane}
				onMove={moveFocusedLane}
				onOverview={openOverview}
				onNewSession={startSessionNextToFocus}
				onRename={renameCurrentSession}
				onJumpProject={jumpToProjectIndex}
				onJump={openCommandPalette}
				onArchive={archiveCurrentSession}
				onRestore={restoreArchivedSession}
				onDetach={() => exitHandlerRef.current()}
			/>
			<ModalContainer modalState={modals.modalState()} onClose={modals.closeModal} />
			</Show>
			</ThemeProvider>
		</TuiLaneKeymapRoot>
	)
}

import { ThemeProvider } from "@yeshwanthyk/open-tui"
import { batch, createEffect, createSignal, onMount, Show } from "solid-js"
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
import { loadCockpitSessionIndex, saveCockpitTitleOverlay } from "../../runtime/cockpit-ingest.js"
import {
	cockpitJumpCommand,
	cockpitTranscriptPreview,
	isExternalLaneId,
	writePiRenameRpc,
} from "../../runtime/cockpit-actions.js"
import { TuiLaneKeyBindings, TuiLaneKeymapRoot, type LaneKeymapDirection, type LaneMoveDirection, type LaneNavMode } from "./TuiLaneKeymap.js"
import { createCommandPaletteOptions, parseCommandPaletteValue } from "./command-palette-options.js"
import { formatChord } from "./lane-header-state.js"
import { canMoveFocusedSessionAcrossProject, cursorForLaneId, moveLaneToCloud, pullLaneBackFromCloud, selectedLaneCursor } from "./lane-actions.js"
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

const firstKey = (keys: readonly string[]): string => keys[0] ?? ""

const shortcutValue = (action: string): string => `shortcut:${action}`

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
	clearFocusedRuntime?: () => void
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

export const TuiApp = ({ initialSession, initialVisibleSession, initialPrompt, initialScratchpadId, initialSessionTitle, startNewSession, initialNavMode, laneStore, workspaceLanes, hostNotifications, activityEntries, acknowledgeHostNotification, focusedActor, canStartPrompt, removeLaneActor, clearFocusedRuntime, active, onActivityChange, onExit }: TuiAppProps) => {
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
		syncCurrentSessionLane: syncCurrentSessionLaneBase,
		applyVisibleSession,
		ensureSession,
		prepareFreshSession: prepareFreshSessionBase,
		startFreshSession: startFreshSessionBase,
		getPendingSessionTitle,
		clearPendingSessionTitle,
	} = laneController
	const preserveStickyLaneMode = () => navMode() === "sticky"
	const refreshFocusedActorDescriptor = (cursor: LaneCursorV2 | null) => {
		const actor = focusedActor?.()
		if (!actor || !cursor || actor.laneId !== cursor.session.laneId) return
		actor.updateDescriptor({
			laneId: cursor.session.laneId,
			projectId: cursor.project.id,
			cwd: cursor.project.cwd,
			sessionId: cursor.session.sessionId,
			sessionPath: cursor.session.sessionPath,
			...(cursor.session.location !== undefined ? { location: cursor.session.location } : {}),
			initialTitle: cursor.session.title,
		})
	}
	const syncCurrentSessionLane = (title?: string, options: { select?: boolean } = {}): LaneCursorV2 | null => {
		const cursor = syncCurrentSessionLaneBase(title, options)
		refreshFocusedActorDescriptor(cursor)
		return cursor
	}

	createEffect(() => {
		const actor = focusedActor?.()
		refreshToolMeta()
		const projection = actor?.projection
		if (!projection) {
			batch(() => {
				store.isResponding.set(false)
				store.activityState.set("idle")
				store.queueCounts.set({ steer: 0, followUp: 0 })
				store.retryStatus.set(null)
			})
			return
		}
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
	let pendingLaneSwitch: Promise<boolean> | null = null
	let submitInFlight = false
	const runPendingLaneSwitch = (
		operation: () => Promise<boolean>,
		onError?: (error: unknown) => void,
	): Promise<boolean> => {
		if (pendingLaneSwitch) return Promise.resolve(false)
		const pending = operation().catch((error: unknown) => {
			onError?.(error)
			return false
		}).finally(() => {
			if (pendingLaneSwitch === pending) pendingLaneSwitch = null
		})
		pendingLaneSwitch = pending
		return pending
	}
	const waitForPendingLaneSwitch = async (): Promise<boolean> => {
		const pending = pendingLaneSwitch
		return pending ? pending : true
	}
	const restoreSelection = (selection: WorkspaceLanesV2["selection"] | undefined) => {
		if (selection) laneStore.dispatch({ type: "select", projectId: selection.projectId, laneId: selection.laneId })
	}
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
			return runPendingLaneSwitch(async () => {
				const previousSelection = workspaceLanes().selection
				let result: Awaited<ReturnType<typeof workspaceSwitch.switchTo>>
				try {
					result = await workspaceSwitch.switchTo({
						cwd,
						fresh: true,
						initialSessionTitle: options.title,
						initialPrompt: options.prompt,
						initialScratchpadId: options.scratchpadId,
						preserveLaneMode: preserveStickyLaneMode(),
					})
				} catch (error) {
					restoreSelection(previousSelection)
					throw error
				}
				if (!result.switched) {
					restoreSelection(previousSelection)
					return false
				}
				applyVisibleSession(result.visibleSession)
				prepareFreshSession(options.title)
				if (options.prompt) {
					await submitPrompt(options.prompt, "followUp")
					setTimeout(() => markScratchpadTriggered(options.scratchpadId), 250)
				}
				return true
			}, (error) => {
				showToastRef.current("Workspace switch failed", error instanceof Error ? error.message : String(error), "error")
			})
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

	const handleSubmit = async (text: string, editorClearFn?: () => void, options: { skipSubmitLock?: boolean } = {}) => {
		if (!text.trim()) return
		const ownsSubmitLock = options.skipSubmitLock !== true
		if (ownsSubmitLock) {
			if (submitInFlight) return
			submitInFlight = true
		}
		try {
			if (!(await waitForPendingLaneSwitch())) return
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
					onExpand: async (expanded) => handleSubmit(expanded, undefined, { skipSubmitLock: true }),
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
		} finally {
			if (ownsSubmitLock) submitInFlight = false
		}
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

	const switchToLaneInner = async (cursor: LaneCursorV2, options?: { preserveLaneMode?: boolean; rollbackSelection?: WorkspaceLanesV2["selection"] }): Promise<boolean> => {
		const sessionPath = cursor.session.sessionPath
		if (sessionPath === null) {
			showToastRef.current("Session unavailable", "Lane has no session file yet", "warning")
			return false
		}
		const previousSelection = options?.rollbackSelection ?? workspaceLanes().selection
		laneStore.dispatch({ type: "select", projectId: cursor.project.id, laneId: cursor.session.laneId })
		let result: Awaited<ReturnType<typeof workspaceSwitch.switchTo>>
		try {
			result = await workspaceSwitch.switchTo({
				cwd: cursor.project.cwd,
				laneId: cursor.session.laneId,
				sessionPath,
				preserveLaneMode: options?.preserveLaneMode,
			})
		} catch (error) {
			restoreSelection(previousSelection)
			throw error
		}
		if (!result.switched) {
			restoreSelection(previousSelection)
			return false
		}
		applyVisibleSession(result.visibleSession)

		if (!options?.preserveLaneMode) setNavMode("off")
		return true
	}

	const switchToLane = async (cursor: LaneCursorV2, options?: { preserveLaneMode?: boolean; rollbackSelection?: WorkspaceLanesV2["selection"] }): Promise<boolean> => {
		return runPendingLaneSwitch(() => switchToLaneInner(cursor, options))
	}

	const navigateLane = (direction: LaneKeymapDirection) => {
		void runPendingLaneSwitch(async () => {
			const preserveLaneMode = navMode() === "sticky"
			syncCurrentSessionLane()
			const rollbackSelection = workspaceLanes().selection
			const next = laneStore.dispatch({ type: "focus", direction })
			const cursor = findActiveCursorV2(next)
			if (!cursor) return false
			return switchToLaneInner(cursor, { preserveLaneMode, rollbackSelection })
		})
	}

	const moveFocusedLane = (direction: LaneMoveDirection) => {
		void runPendingLaneSwitch(async () => {
			const current = syncCurrentSessionLane()
			if (!current) return false
			if ((direction === "up" || direction === "down") && !canMoveFocusedSessionAcrossProject(focusedActor?.()?.status(), store.isResponding.value())) {
				showToastRef.current("Session still running", "Wait for the stream before moving it to another project", "warning")
				return false
			}
			const rollbackSelection = workspaceLanes().selection
			const patch = direction === "left" || direction === "right"
				? { type: "reorderSession" as const, laneId: current.session.laneId, direction }
				: { type: "moveSessionToProject" as const, laneId: current.session.laneId, direction }
				const inversePatch = direction === "left" || direction === "right"
					? { type: "reorderSession" as const, laneId: current.session.laneId, direction: direction === "left" ? "right" as const : "left" as const }
					: { type: "moveSessionToProject" as const, laneId: current.session.laneId, direction: direction === "up" ? "down" as const : "up" as const }
				const next = laneStore.dispatch(patch)
				const cursor = findActiveCursorV2(next, next.selection)
				if (!cursor) {
					laneStore.dispatch(inversePatch)
					restoreSelection(rollbackSelection)
					return false
				}
				let switched = false
				try {
					if (direction === "up" || direction === "down") await removeLaneActor?.(current.session.laneId)
					switched = await switchToLaneInner(cursor, { rollbackSelection })
				} catch (error) {
					laneStore.dispatch(inversePatch)
					restoreSelection(rollbackSelection)
					if (direction === "up" || direction === "down") {
						try {
							await switchToLaneInner(current, { rollbackSelection })
						} catch {
							// Preserve the original move failure; selection/order has already been restored.
						}
					}
					throw error
				}
				if (!switched) {
					laneStore.dispatch(inversePatch)
					restoreSelection(rollbackSelection)
					if (direction === "up" || direction === "down") {
						try {
							await switchToLaneInner(current, { rollbackSelection })
						} catch {
							// Preserve the false switch result; selection/order has already been restored.
						}
					}
					return false
				}
				return true
			})
	}

	const startSessionNextToFocus = () => {
		void runPendingLaneSwitch(async () => {
			const previous = syncCurrentSessionLane()
			const previousSelection = workspaceLanes().selection
			let result: Awaited<ReturnType<typeof workspaceSwitch.switchTo>>
			try {
				result = await workspaceSwitch.switchTo({
					cwd: currentCwd(),
					fresh: true,
					initialSessionTitle: "new session",
					preserveLaneMode: preserveStickyLaneMode(),
				})
			} catch (error) {
				restoreSelection(previousSelection)
				throw error
			}
			if (!result.switched) {
				restoreSelection(previousSelection)
				return false
			}
			applyVisibleSession(result.visibleSession)
			prepareFreshSession("new session")
			const current = selectedLaneCursor(workspaceLanes())
			if (!previous || !current || previous.session.laneId === current.session.laneId) return true
			laneStore.transact([
				{ type: "upsertSession", session: current.session, insert: { type: "after", laneId: previous.session.laneId } },
				{ type: "select", projectId: current.project.id, laneId: current.session.laneId },
			])
			return true
		}, (error) => {
			showToastRef.current("New session failed", error instanceof Error ? error.message : String(error), "error")
		})
	}

	const jumpToProjectIndex = (index: number) => {
		void runPendingLaneSwitch(async () => {
			syncCurrentSessionLane()
			const lanes = workspaceLanes()
			const projectId = activeProjectIdsV2(lanes)[index]
			const project = projectId ? lanes.projectsById[projectId] : undefined
			if (!project) return false
			const activeSessions = activeSessionsForProject(lanes, project.id)
			if (activeSessions.length === 0) {
				return switchToProjectInner({ cwd: project.cwd, title: project.title, root: project.cwd }, { fresh: true })
			}
			const remembered = lanes.focusByProject[project.id]
			const rememberedLaneId = remembered?.focusedLaneId && activeSessions.some((session) => session.laneId === remembered.focusedLaneId)
				? remembered.focusedLaneId
				: activeSessions[Math.min(Math.max(remembered?.focusedColumn ?? 0, 0), activeSessions.length - 1)]?.laneId
			const laneId = rememberedLaneId ?? activeSessions[0]?.laneId
			if (!laneId) return false
			const rollbackSelection = workspaceLanes().selection
			const selected = laneStore.dispatch({ type: "select", projectId: project.id, laneId })
			const cursor = findActiveCursorV2(selected, { projectId: project.id, laneId })
			if (!cursor) return false
			return switchToLaneInner(cursor, { preserveLaneMode: preserveStickyLaneMode(), rollbackSelection })
		})
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

	const switchToProjectInner = async (project: WorkspaceProject, options?: { fresh?: boolean; preserveLaneMode?: boolean }): Promise<boolean> => {
		const fresh = options?.fresh === true || activeSessionsForProject(workspaceLanes(), project.cwd).length === 0
		const previousSelection = workspaceLanes().selection
		let result: Awaited<ReturnType<typeof workspaceSwitch.switchTo>>
		try {
			result = await workspaceSwitch.switchTo({
				cwd: project.cwd,
				fresh,
				initialSessionTitle: fresh ? "new session" : undefined,
				preserveLaneMode: options?.preserveLaneMode,
			})
		} catch (error) {
			restoreSelection(previousSelection)
			throw error
		}
		if (!result.switched) {
			restoreSelection(previousSelection)
			return false
		}
		applyVisibleSession(result.visibleSession)
		if (fresh) prepareFreshSession()
		return true
	}

	const switchToProject = async (project: WorkspaceProject, options?: { fresh?: boolean; preserveLaneMode?: boolean }): Promise<boolean> => {
		return runPendingLaneSwitch(() => switchToProjectInner(project, options))
	}

	const startSessionInProject = () => {
		void (async () => {
			const project = await pickConfiguredProject("New session in project")
			if (!project) return
			await switchToProject(project, { fresh: true, preserveLaneMode: preserveStickyLaneMode() })
		})()
	}

	const cockpitMetaForLane = (laneId: string) => loadCockpitSessionIndex(config.configDir)[laneId]

	const cursorForLane = (laneId: string): LaneCursorV2 | null => {
		return cursorForLaneId(workspaceLanes(), laneId)
	}

	const refreshLocalLaneBinding = async (laneId: string): Promise<void> => {
		const cursor = cursorForLane(laneId)
		if (!cursor || cursor.session.location?.kind === "cloud") return
		await switchToLane(cursor, { preserveLaneMode: preserveStickyLaneMode() })
	}

	const moveCurrentLaneToCloud = () => {
		void (async () => {
			const current = syncCurrentSessionLane()
			if (!current) return
			const result = await moveLaneToCloud({
				cursor: current,
				laneStore,
				actor: focusedActor?.() ?? null,
				isResponding: store.isResponding.value(),
			})
			if (!result.ok) {
				await refreshLocalLaneBinding(current.session.laneId)
				showToastRef.current("Move to cloud failed", result.reason, "error")
				return
			}
			clearFocusedRuntime?.()
			showToastRef.current("Moved to cloud", result.url ?? result.beamId, "success")
		})()
	}

	const pullCurrentLaneFromCloud = () => {
		void (async () => {
			const current = selectedLaneCursor(workspaceLanes())
			if (!current) return
			const result = await pullLaneBackFromCloud({
				cursor: current,
				laneStore,
			})
			if (!result.ok) {
				showToastRef.current("Pull back failed", result.reason, "error")
				return
			}
			showToastRef.current("Pulled back", result.beamId, "success")
			await refreshLocalLaneBinding(current.session.laneId)
		})()
	}

	const jumpToExternalAgent = () => {
		void (async () => {
			const current = syncCurrentSessionLane()
			if (!current || !isExternalLaneId(current.session.laneId)) return
			const command = cockpitJumpCommand(cockpitMetaForLane(current.session.laneId))
			if (!command.ok) {
				showToastRef.current("Cannot jump to external agent", command.reason, "warning")
				return
			}
			const proc = Bun.spawn([...command.value], { stdout: "ignore", stderr: "pipe" })
			const code = await proc.exited
			if (code === 0) {
				showToastRef.current("Focused external agent", current.session.title || current.session.laneId, "success")
				return
			}
			const stderr = new TextDecoder().decode(await new Response(proc.stderr).arrayBuffer()).trim()
			showToastRef.current("External agent jump failed", stderr || `tmux exited ${code}`, "error")
		})()
	}

	const previewExternalTranscript = () => {
		void (async () => {
			const current = syncCurrentSessionLane()
			if (!current || !isExternalLaneId(current.session.laneId)) return
			const preview = cockpitTranscriptPreview(cockpitMetaForLane(current.session.laneId))
			if (!preview.ok) {
				showToastRef.current("No transcript preview", preview.reason, "warning")
				return
			}
			await modals.showEditor(`Transcript / ${current.session.title || current.session.laneId}`, preview.value)
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
			if (isExternalLaneId(current.session.laneId)) {
				saveCockpitTitleOverlay(config.configDir, current.session.laneId, nextTitle)
				const meta = cockpitMetaForLane(current.session.laneId)
				if (meta?.cli === "pi") {
					const rpc = writePiRenameRpc(config.configDir, meta, nextTitle)
					if (!rpc.ok) {
						showToastRef.current("Pi rename RPC skipped", rpc.reason, "warning")
					}
				}
			}
			showToastRef.current("Session renamed", nextTitle, "success")
		})()
	}

	const laneShortcutOptions = (): SearchSelectOption[] => {
		const lanesKeymap = config.keymap.lanes
		const prefix = formatChord(firstKey(lanesKeymap.prefixKey))
		const prefixed = (keys: readonly string[]) => [prefix, formatChord(firstKey(keys))].filter(Boolean).join(" ")
		const command = formatChord(firstKey(lanesKeymap.bindings.jump))
		return [
			{
				value: shortcutValue("focus"),
				label: "Focus lane",
				description: `${prefix} then arrows/hjkl`,
				keywords: "lane focus arrows hjkl",
			},
			{
				value: shortcutValue("focusGlobal"),
				label: "Focus lane globally",
				description: "Shift+arrows",
				keywords: "lane focus global shift arrows",
			},
			{
				value: shortcutValue("move"),
				label: "Move agent",
				description: `${prefix} then Shift+arrows`,
				keywords: "lane move agent session shift arrows",
			},
			{
				value: shortcutValue("newAgent"),
				label: "New agent",
				description: prefixed(lanesKeymap.bindings.newSession),
				keywords: "new agent session lane",
			},
			{
				value: shortcutValue("rename"),
				label: "Rename agent",
				description: prefixed(lanesKeymap.bindings.rename),
				keywords: "rename agent session title",
			},
			{
				value: shortcutValue("overview"),
				label: "Overview",
				description: prefixed(lanesKeymap.bindings.overview),
				keywords: "overview lanes projects sessions agents",
			},
			{
				value: shortcutValue("project"),
				label: "Open project",
				description: `${prefix} then 1-9`,
				keywords: "project jump open workspace 1 2 3 4 5 6 7 8 9",
			},
			{
				value: shortcutValue("newAgentProject"),
				label: "New agent in project...",
				description: command,
				keywords: "new agent session project workspace folder",
			},
			{
				value: shortcutValue("shortcuts"),
				label: "Shortcuts",
				description: prefixed(lanesKeymap.bindings.help),
				keywords: "shortcuts keybinds help keyboard",
			},
		]
	}

	const openLaneShortcuts = () => {
		void (async () => {
			const selected = await modals.showSearchSelect("Shortcuts", laneShortcutOptions(), "new agent, project, shortcuts")
			switch (selected) {
				case shortcutValue("newAgent"):
					startSessionNextToFocus()
					return
				case shortcutValue("newAgentProject"):
					startSessionInProject()
					return
				case shortcutValue("rename"):
					renameCurrentSession()
					return
				case shortcutValue("overview"):
					openOverview()
					return
			}
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
				case "moveToCloud":
					moveCurrentLaneToCloud()
					return
				case "pullFromCloud":
					pullCurrentLaneFromCloud()
					return
				case "jumpExternal":
					jumpToExternalAgent()
					return
				case "previewExternal":
					previewExternalTranscript()
					return
			}
		})()
	}

	const archiveCurrentSession = () => {
		void runPendingLaneSwitch(async () => {
			const current = syncCurrentSessionLane()
			if (!current) return false
			const rollbackSelection = workspaceLanes().selection
			const archived = laneStore.dispatch({ type: "archiveSession", laneId: current.session.laneId })
			const nextCursor = findActiveCursorV2(archived)
			if (!nextCursor) {
				showToastRef.current("Session archived", "No active sessions left", "info")
				return true
			}
			let switched = false
			try {
				switched = await switchToLaneInner(nextCursor, { rollbackSelection })
			} catch (error) {
				laneStore.dispatch({ type: "restoreSession", laneId: current.session.laneId, projectId: current.project.id })
				restoreSelection(rollbackSelection)
				throw error
			}
			if (!switched) {
				laneStore.dispatch({ type: "restoreSession", laneId: current.session.laneId, projectId: current.project.id })
				restoreSelection(rollbackSelection)
				return false
			}
			if (switched) showToastRef.current("Session archived", "Moved to next active session", "success")
			return switched
		})
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
			const switched = await runPendingLaneSwitch(async () => {
				const rollbackSelection = workspaceLanes().selection
				const restored = laneStore.transact([
					{ type: "restoreSession", laneId: session.laneId },
					{ type: "select", projectId: project.id, laneId: session.laneId },
				])
				const restoredSession = restored.sessionsById[session.laneId]
				const restoredProject = restored.projectsById[project.id]
				if (!restoredSession || !restoredProject) return false
				const projectIndex = restored.projectOrder.indexOf(restoredProject.id)
				const sessionIndex = (restored.sessionOrderByProject[restoredProject.id] ?? []).indexOf(restoredSession.laneId)
				let switched = false
				try {
					switched = await switchToLaneInner({
						project: restoredProject,
						session: restoredSession,
						projectIndex: Math.max(0, projectIndex),
						sessionIndex: Math.max(0, sessionIndex),
					}, { rollbackSelection })
				} catch (error) {
					laneStore.dispatch({ type: "archiveSession", laneId: session.laneId })
					restoreSelection(rollbackSelection)
					throw error
				}
				if (!switched) {
					laneStore.dispatch({ type: "archiveSession", laneId: session.laneId })
					restoreSelection(rollbackSelection)
					return false
				}
				return true
			})
			if (switched) showToastRef.current("Session restored", "Returned to active lanes", "success")
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
				onHelp={openLaneShortcuts}
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

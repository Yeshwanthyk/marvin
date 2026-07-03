import { render } from "@opentui/solid"
import { RuntimeProvider } from "../../runtime/context.js"
import { createRuntime, type RuntimeInitArgs } from "@runtime/factory.js"
import type { LoadedSession } from "../../session-manager.js"
import { selectSession as selectSessionOpen } from "../../session-picker.js"
import { TuiApp, type TuiAppActivation, type TuiAppActivity } from "@ui/app-shell/TuiApp.js"
import {
	applyTuiActivityTransition,
	createActivityIndex,
	createNotificationService,
} from "@ui/app-shell/activity-index.js"
import { WorkspaceSwitchProvider, type VisibleSession, type WorkspaceSwitchController, type WorkspaceSwitchRequest } from "../../runtime/workspace-switch.js"
import { shouldStartFreshWorkspaceSession } from "../../runtime/workspace-switch-state.js"
import { createEffect, createSignal, Index, onCleanup } from "solid-js"
import type { RuntimeContext } from "../../runtime/factory.js"
import {
	createWorkspaceLaneStore,
	loadWorkspaceLanesV2,
	type WorkspaceLaneStore,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"

interface RunTuiArgs extends RuntimeInitArgs {
	continueSession?: boolean
	resumeSession?: boolean
	/** Session ID (UUID, prefix, or path) to load directly */
	session?: string
	/** Initial prompt to submit on startup */
	prompt?: string
}

interface RuntimeHostState {
	activeCwd: string
	slots: RuntimeSlot[]
}

interface RuntimeSlot {
	cwd: string
	runtime: RuntimeContext
	activation: TuiAppActivation
	isResponding: boolean
	lastViewedAt: number
	lastActivityAt: number
}

const MAX_IDLE_RUNTIMES = 4
const IDLE_RUNTIME_TTL_MS = 10 * 60 * 1000

const visibleSessionForLoaded = (
	runtime: RuntimeContext,
	session: LoadedSession,
	sessionPath?: string,
): VisibleSession => {
	const resolvedPath = sessionPath || runtime.sessionManager.listSessions().find((entry) => entry.id === session.metadata.id)?.path || ""
	return {
		state: "loaded",
		cwd: runtime.sessionManager.projectCwd,
		sessionPath: resolvedPath,
		sessionId: session.metadata.id,
		session,
	}
}

function TuiRuntimeHost(props: { args?: RunTuiArgs; initialRuntime: RuntimeContext; initialSession: LoadedSession | null; initialPrompt?: string }) {
	let nextActivationSeq = 1
	const pendingSlots = new Map<string, Promise<RuntimeSlot>>()
	const initialCwd = props.initialRuntime.sessionManager.projectCwd
	const [workspaceLanes, setWorkspaceLanes] = createSignal<WorkspaceLanesV2>(loadWorkspaceLanesV2(props.initialRuntime.config.configDir).lanes)
	const laneStore: WorkspaceLaneStore = createWorkspaceLaneStore(props.initialRuntime.config.configDir, (lanes) => {
		setWorkspaceLanes(lanes)
	})
	const activityIndex = createActivityIndex()
	const notificationService = createNotificationService()
	setWorkspaceLanes(laneStore.lanes())
	const initialActivation: TuiAppActivation = {
		seq: 0,
		initialSession: props.initialSession,
		...(props.initialSession ? { initialVisibleSession: visibleSessionForLoaded(props.initialRuntime, props.initialSession) } : {}),
		...(props.initialPrompt !== undefined ? { initialPrompt: props.initialPrompt } : {}),
	}
	const [state, setState] = createSignal<RuntimeHostState>({
		activeCwd: initialCwd,
		slots: [{
			cwd: initialCwd,
			runtime: props.initialRuntime,
			activation: initialActivation,
			isResponding: false,
			lastViewedAt: Date.now(),
			lastActivityAt: Date.now(),
		}],
	})

	let closed = false
	const closeRuntime = (runtime: RuntimeContext) => {
		if (closed) return
		void runtime.close()
	}

	const closeHost = () => {
		void laneStore.flush().finally(() => {
			closed = true
			for (const slot of state().slots) {
				void slot.runtime.close()
			}
			process.exit(0)
		})
	}

	const runtimeArgsFor = (cwd: string): RuntimeInitArgs => {
		const { continueSession: _continueSession, resumeSession: _resumeSession, session: _session, prompt: _prompt, ...runtimeArgs } = props.args ?? {}
		return { ...runtimeArgs, cwd }
	}

	const createSlot = async (cwd: string): Promise<RuntimeSlot> => {
		const runtime = await createRuntime(runtimeArgsFor(cwd), "tui")
		const now = Date.now()
		return {
			cwd,
			runtime,
			activation: { seq: nextActivationSeq++, initialSession: null },
			isResponding: false,
			lastViewedAt: now,
			lastActivityAt: now,
		}
	}

	const findSlot = (cwd: string): RuntimeSlot | undefined => state().slots.find((slot) => slot.cwd === cwd)

	const getOrCreateSlot = async (cwd: string): Promise<RuntimeSlot> => {
		const existing = findSlot(cwd)
		if (existing) return existing
		const pending = pendingSlots.get(cwd)
		if (pending) return pending
		const creating = createSlot(cwd).then((created) => {
			setState((prev) => prev.slots.some((slot) => slot.cwd === cwd)
				? prev
				: { ...prev, slots: [...prev.slots, created] })
			return created
		}).finally(() => {
			pendingSlots.delete(cwd)
		})
		pendingSlots.set(cwd, creating)
		return creating
	}

	const loadRequestedSession = (runtime: RuntimeContext, request: WorkspaceSwitchRequest): LoadedSession | null => {
		if (request.sessionPath) return runtime.sessionManager.loadSession(request.sessionPath)
		if (request.fresh) return null
		return runtime.sessionManager.loadLatest()
	}

	const visibleSessionForRequest = (
		runtime: RuntimeContext,
		request: WorkspaceSwitchRequest,
		loaded: LoadedSession | null,
	): VisibleSession => {
		if (request.sessionPath) {
			return loaded
				? visibleSessionForLoaded(runtime, loaded, request.sessionPath)
				: { state: "missing", cwd: request.cwd, sessionPath: request.sessionPath }
		}
		return loaded ? visibleSessionForLoaded(runtime, loaded) : { state: "none" }
	}

	const evictIdleRuntimes = () => {
		const now = Date.now()
		const current = state()
		const idleHidden = current.slots
			.filter((slot) =>
				slot.cwd !== current.activeCwd &&
				!slot.isResponding
			)
			.sort((a, b) => a.lastViewedAt - b.lastViewedAt)
		const overflow = Math.max(0, current.slots.length - MAX_IDLE_RUNTIMES)
		const expired = idleHidden.filter((slot) => now - slot.lastActivityAt >= IDLE_RUNTIME_TTL_MS)
		const toClose = new Set([...expired, ...idleHidden.slice(0, overflow)].map((slot) => slot.cwd))
		if (toClose.size === 0) return
		const closing = current.slots.filter((slot) => toClose.has(slot.cwd))
		setState((prev) => ({ ...prev, slots: prev.slots.filter((slot) => !toClose.has(slot.cwd)) }))
		for (const slot of closing) closeRuntime(slot.runtime)
	}

	createEffect(() => {
		const selected = workspaceLanes().selection
		if (selected) activityIndex.patch(selected.laneId, { unread: false })
	})

	const updateSlotActivity = (cwd: string, activity: TuiAppActivity) => {
		let transition: { wasResponding: boolean; isFocused: boolean } | undefined
		setState((prev) => {
			let changed = false
			const slots = prev.slots.map((slot) => {
				if (slot.cwd !== cwd) return slot
				transition = {
					wasResponding: slot.isResponding,
					isFocused: prev.activeCwd === cwd,
				}
				if (
					slot.isResponding === activity.isResponding &&
					slot.lastActivityAt === activity.lastObservedAt
				) return slot
				changed = true
				return {
					...slot,
					isResponding: activity.isResponding,
					lastActivityAt: activity.lastObservedAt,
				}
			})
			return changed ? { ...prev, slots } : prev
		})
		if (!transition) return
		applyTuiActivityTransition({
			activity,
			projectId: cwd,
			laneStore,
			activityIndex,
			notifications: notificationService,
			wasResponding: transition.wasResponding,
			isFocused: transition.isFocused,
			now: activity.lastObservedAt,
		})
	}

	const controller: WorkspaceSwitchController = {
		currentCwd: () => state().activeCwd,
		switchTo: async (request: WorkspaceSwitchRequest) => {
			const slot = await getOrCreateSlot(request.cwd)
			const loaded = loadRequestedSession(slot.runtime, request)
			const visibleSession = visibleSessionForRequest(slot.runtime, request, loaded)
			const now = Date.now()
			const activation: TuiAppActivation = {
				seq: nextActivationSeq++,
				initialSession: loaded,
				initialVisibleSession: visibleSession,
				...(request.initialPrompt !== undefined ? { initialPrompt: request.initialPrompt } : {}),
				...(request.initialScratchpadId !== undefined ? { initialScratchpadId: request.initialScratchpadId } : {}),
				...(request.initialSessionTitle !== undefined ? { initialSessionTitle: request.initialSessionTitle } : {}),
				startNewSession: shouldStartFreshWorkspaceSession(request, loaded),
				initialNavMode: request.preserveLaneMode ? "sticky" : undefined,
			}

			setState((prev) => ({
				activeCwd: request.cwd,
				slots: prev.slots.map((entry) => entry.cwd === request.cwd
					? { ...entry, activation, lastViewedAt: now, lastActivityAt: now }
					: entry),
			}))
			queueMicrotask(evictIdleRuntimes)
			return { switched: true, session: loaded, visibleSession }
		},
	}

	onCleanup(() => {
		closed = true
		void laneStore.flush()
		for (const slot of state().slots) {
			void slot.runtime.close()
		}
	})

	return (
		<WorkspaceSwitchProvider controller={controller}>
			<Index each={state().slots}>
				{(slot) => (
					<RuntimeProvider runtime={slot().runtime}>
						<TuiApp
							initialSession={slot().activation.initialSession}
							initialVisibleSession={slot().activation.initialVisibleSession}
							initialPrompt={slot().activation.initialPrompt}
							initialScratchpadId={slot().activation.initialScratchpadId}
							initialSessionTitle={slot().activation.initialSessionTitle}
							startNewSession={slot().activation.startNewSession}
							initialNavMode={slot().activation.initialNavMode}
							laneStore={laneStore}
							workspaceLanes={workspaceLanes}
							hostNotifications={notificationService.notifications}
							acknowledgeHostNotification={(id) => notificationService.acknowledge(id)}
							active={() => state().activeCwd === slot().cwd}
							activation={() => slot().activation}
							onActivityChange={(activity) => updateSlotActivity(slot().cwd, activity)}
							onExit={closeHost}
						/>
					</RuntimeProvider>
				)}
			</Index>
		</WorkspaceSwitchProvider>
	)
}

export const runTuiOpen = async (args?: RunTuiArgs) => {
	const runtime = await createRuntime(args, "tui")
	const { sessionManager } = runtime
	let initialSession: LoadedSession | null = null

	// Direct session loading via --session flag takes priority
	if (args?.session) {
		const sessionInfo = sessionManager.findSession(args.session)
		if (sessionInfo === null) {
			process.stderr.write(`Session not found: ${args.session}\n`)
			process.exit(1)
		}
		initialSession = sessionManager.loadSession(sessionInfo.path)
	}

	if (args?.resumeSession && !initialSession) {
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
			<TuiRuntimeHost args={args} initialRuntime={runtime} initialSession={initialSession} initialPrompt={args?.prompt} />
		),
		{ targetFps: 30, exitOnCtrlC: false, useKittyKeyboard: {} },
	)
}

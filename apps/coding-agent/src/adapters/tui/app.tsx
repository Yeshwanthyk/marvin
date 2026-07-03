import { randomUUID } from "node:crypto"
import { render } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { createProjectRuntimeBundle, type ProjectRuntimeBundle, type SessionActorDescriptor } from "@yeshwanthyk/runtime-effect/project-bundle.js"
import { createHookUIContext } from "@yeshwanthyk/runtime-effect/hooks/index.js"
import { createJsonlOwnershipIndex } from "@yeshwanthyk/runtime-effect/session/jsonl-ownership.js"
import { SessionManager } from "@yeshwanthyk/runtime-effect/session-manager.js"
import {
	createSessionLaneInput,
	createWorkspaceLaneStore,
	loadWorkspaceLanesV2,
	type LaneId,
	type WorkspaceLaneStore,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { RuntimeProvider } from "../../runtime/context.js"
import { createRuntime, type RuntimeInitArgs, type RuntimeContext } from "@runtime/factory.js"
import { createFocusedRuntimeFacade, type FocusedRuntimeBinding } from "../../runtime/focused-runtime.js"
import { createSessionActorRegistry } from "../../runtime/session-actor-registry.js"
import type { SessionActor } from "../../runtime/session-actor.js"
import type { LoadedSession } from "../../session-manager.js"
import { selectSession as selectSessionOpen } from "../../session-picker.js"
import { TuiApp } from "@ui/app-shell/TuiApp.js"
import {
	createActivityIndex,
	createNotificationService,
} from "@ui/app-shell/activity-index.js"
import { createFocusController } from "@ui/app-shell/focus-controller.js"
import { WorkspaceSwitchProvider, type VisibleSession, type WorkspaceSwitchController, type WorkspaceSwitchRequest } from "../../runtime/workspace-switch.js"

interface RunTuiArgs extends RuntimeInitArgs {
	continueSession?: boolean
	resumeSession?: boolean
	/** Session ID (UUID, prefix, or path) to load directly */
	session?: string
	/** Initial prompt to submit on startup */
	prompt?: string
}

const projectTitle = (cwd: string): string => {
	const normalized = cwd.replace(/\/+$/, "")
	return normalized.split("/").filter(Boolean).at(-1) ?? normalized
}

const runtimeArgsFor = (args: RunTuiArgs | undefined, cwd: string): RuntimeInitArgs => {
	const { continueSession: _continueSession, resumeSession: _resumeSession, session: _session, prompt: _prompt, ...runtimeArgs } = args ?? {}
	return { ...runtimeArgs, cwd }
}

const sessionPathForLoaded = (
	sessionManager: SessionManager,
	session: LoadedSession,
): string | null =>
	sessionManager.listSessions().find((entry) => entry.id === session.metadata.id)?.path ?? null

const visibleSessionForLoaded = (
	cwd: string,
	session: LoadedSession,
	sessionPath: string,
): VisibleSession => ({
	state: "loaded",
	cwd,
	sessionPath,
	sessionId: session.metadata.id,
	session,
})

const descriptorForLane = (
	lanes: WorkspaceLanesV2,
	laneId: LaneId,
): SessionActorDescriptor | null => {
	const session = lanes.sessionsById[laneId]
	if (!session) return null
	const project = lanes.projectsById[session.projectId]
	if (!project) return null
	return {
		laneId: session.laneId,
		projectId: project.id,
		cwd: project.cwd,
		sessionId: session.sessionId,
		sessionPath: session.sessionPath,
		initialTitle: session.title,
	}
}

const ensureLaneForSession = (
	laneStore: WorkspaceLaneStore,
	lanes: WorkspaceLanesV2,
	cwd: string,
	config: RuntimeContext["config"],
	session: LoadedSession | null,
	sessionPath: string | null,
	options: { laneId?: LaneId; title?: string; select?: boolean } = {},
): LaneId => {
	const now = new Date().toISOString()
	const existing = Object.values(lanes.sessionsById).find((entry) =>
		entry.projectId === cwd &&
		((sessionPath !== null && entry.sessionPath === sessionPath) ||
			(session !== null && entry.sessionId === session.metadata.id))
	)
	const selectedEmptyLane = options.laneId ? lanes.sessionsById[options.laneId] : undefined
	const laneId = existing?.laneId ?? (selectedEmptyLane?.sessionPath === null ? selectedEmptyLane.laneId : undefined) ?? options.laneId ?? randomUUID()
	const createdAt = session ? new Date(session.metadata.timestamp).toISOString() : now
	const title = options.title ?? existing?.title ?? session?.metadata.id.slice(0, 8) ?? "new session"
	const provider = session?.metadata.provider ?? config.provider
	const modelId = session?.metadata.modelId ?? config.modelId
	const patches = [
		{
			type: "upsertProject" as const,
			project: {
				id: cwd,
				cwd,
				title: lanes.projectsById[cwd]?.title ?? projectTitle(cwd),
				createdAt: lanes.projectsById[cwd]?.createdAt ?? now,
				updatedAt: now,
			},
		},
		{
			type: "upsertSession" as const,
			session: createSessionLaneInput({
				laneId,
				projectId: cwd,
				sessionId: session?.metadata.id ?? null,
				sessionPath,
				title,
				provider,
				modelId,
				createdAt,
				updatedAt: now,
			}),
		},
	]
	const selectPatch = options.select === false ? [] : [{ type: "select" as const, projectId: cwd, laneId }]
	laneStore.transact([...patches, ...selectPatch])
	return laneId
}

function TuiRuntimeHost(props: { args?: RunTuiArgs; initialRuntime: RuntimeContext; initialSession: LoadedSession | null; initialPrompt?: string }) {
	const initialCwd = props.initialRuntime.sessionManager.projectCwd
	const sendRef = props.initialRuntime.sendRef
	const ownership = createJsonlOwnershipIndex()
	const [workspaceLanes, setWorkspaceLanes] = createSignal<WorkspaceLanesV2>(loadWorkspaceLanesV2(props.initialRuntime.config.configDir).lanes)
	const laneStore: WorkspaceLaneStore = createWorkspaceLaneStore(props.initialRuntime.config.configDir, (lanes) => {
		setWorkspaceLanes(lanes)
	})
	const activityIndex = createActivityIndex()
	const notificationService = createNotificationService()
	const bundleCache = new Map<string, Promise<ProjectRuntimeBundle>>()
	const actorSubscriptions = new Map<LaneId, () => void>()
	const [, setFocusedLaneId] = createSignal<LaneId | null>(null)
	const [focusedBinding, setFocusedBinding] = createSignal<FocusedRuntimeBinding | null>(null)
	const [initialReady, setInitialReady] = createSignal(false)
	setWorkspaceLanes(laneStore.lanes())

	const getBundle = (descriptor: SessionActorDescriptor): Promise<ProjectRuntimeBundle> => {
		const existing = bundleCache.get(descriptor.projectId)
		if (existing) return existing
		const creating = createProjectRuntimeBundle({
			...runtimeArgsFor(props.args, descriptor.cwd),
			projectId: descriptor.projectId,
			cwd: descriptor.cwd,
			hasUI: false,
			sendRef,
			jsonlOwnership: ownership,
		})
		bundleCache.set(descriptor.projectId, creating)
		return creating
	}

	const registry = createSessionActorRegistry({
		getBundle,
		getUiPolicy: (descriptor, focused) => {
			const notify = (title: string, message: string, variant: "info" | "warning" | "success" | "error" = "warning") => {
				notificationService.enqueue({
					laneId: descriptor.laneId,
					projectId: descriptor.projectId,
					level: variant === "success" ? "info" : variant,
					title,
					message,
				})
			}
			const hookUIContext = createHookUIContext({
				setEditorText: () => notify("Hook needs focus", `Hook tried to edit composer in ${descriptor.cwd}`),
				getEditorText: () => "",
				showSelect: async (title) => {
					notify("Hook needs focus", `${title} requested in ${descriptor.cwd}`)
					return undefined
				},
				showInput: async (title) => {
					notify("Hook needs focus", `${title} requested in ${descriptor.cwd}`)
					return undefined
				},
				showConfirm: async (title) => {
					notify("Hook needs focus", `${title} requested in ${descriptor.cwd}`)
					return false
				},
				showEditor: async (title) => {
					notify("Hook needs focus", `${title} requested in ${descriptor.cwd}`)
					return undefined
				},
				showNotify: (message, type = "info") => notify("Hook notification", message, type),
			})
			return {
				adapter: "tui",
				hasUI: focused,
				sendRef,
				hookUIContext,
				notify,
			}
		},
	})
	const focusController = createFocusController({
		laneStore,
		workspaceLanes,
		registry,
		setFocusedLaneId,
	})

	const focusedRuntime = createFocusedRuntimeFacade(() => focusedBinding(), sendRef)
	const idleSweepTimer = setInterval(() => {
		void registry.sweepIdle()
	}, 60_000)

	const loadForRequest = async (request: WorkspaceSwitchRequest): Promise<{ loaded: LoadedSession | null; sessionPath: string | null }> => {
		const bundle = await createProjectRuntimeBundle({
			...runtimeArgsFor(props.args, request.cwd),
			projectId: request.cwd,
			cwd: request.cwd,
			hasUI: false,
			sendRef,
		})
		const manager = new SessionManager(bundle.config.configDir, request.cwd)
		try {
			if (request.sessionPath) {
				return { loaded: manager.loadSession(request.sessionPath), sessionPath: request.sessionPath }
			}
			if (request.fresh) return { loaded: null, sessionPath: null }
			const loaded = manager.loadLatest()
			return { loaded, sessionPath: loaded ? sessionPathForLoaded(manager, loaded) : null }
		} finally {
			await bundle.close()
		}
	}

	const focusLane = async (laneId: LaneId): Promise<SessionActor | null> => {
		const actor = await focusController.focusLane(laneId)
		if (!actor) return null
		watchActorActivity(actor)
		const descriptor = descriptorForLane(workspaceLanes(), laneId)
		const services = actor.services()
		if (!descriptor || !services) return null
		const bundle = await getBundle(descriptor)
		setFocusedBinding({
			bundle,
			services,
			sendRef,
			close: async () => {
				await actor.close()
			},
		})
		setFocusedLaneId(laneId)
		activityIndex.patch(laneId, { unread: false })
		return actor
	}

	const watchActorActivity = (actor: SessionActor) => {
		if (actorSubscriptions.has(actor.laneId)) return
		const unsubscribe = actor.projection.subscribe((event) => {
			const now = Date.now()
			const lanes = laneStore.lanes()
			const lane = lanes.sessionsById[actor.laneId]
			const project = lane ? lanes.projectsById[lane.projectId] : undefined
			const isFocused = lanes.selection?.laneId === actor.laneId
			if (event.type === "agent_start") {
				activityIndex.patch(actor.laneId, {
					status: "streaming",
					isResponding: true,
					lastActivityAt: now,
					unread: !isFocused,
				})
				return
			}
			if (event.type !== "agent_end") return
			activityIndex.patch(actor.laneId, {
				status: "completed",
				isResponding: false,
				lastActivityAt: now,
				lastCompletedAt: now,
				tokenCount: actor.projection.contextTokens(),
				unread: !isFocused,
			})
			if (!isFocused && lane) {
				notificationService.enqueue({
					laneId: actor.laneId,
					projectId: lane.projectId,
					level: "success",
					title: "Session complete",
					message: `${project?.title ?? lane.projectId} / ${lane.title}`,
				})
			}
		})
		actorSubscriptions.set(actor.laneId, unsubscribe)
	}

	const removeLaneActor = async (laneId: LaneId): Promise<void> => {
		const unsubscribe = actorSubscriptions.get(laneId)
		if (unsubscribe) {
			unsubscribe()
			actorSubscriptions.delete(laneId)
		}
		await registry.remove(laneId)
	}

	const ensureInitialFocus = async () => {
		const initialPath = props.initialSession ? sessionPathForLoaded(props.initialRuntime.sessionManager, props.initialSession) : null
		const laneId = ensureLaneForSession(
			laneStore,
			laneStore.lanes(),
			initialCwd,
			props.initialRuntime.config,
			props.initialSession,
			initialPath,
			{ title: props.initialSession?.metadata.id.slice(0, 8), select: true },
		)
		await focusLane(laneId)
		setInitialReady(true)
	}

	createEffect(() => {
		const selected = workspaceLanes().selection
		if (selected) activityIndex.patch(selected.laneId, { unread: false })
	})

	void ensureInitialFocus()

	const closeHost = () => {
		void laneStore.flush().finally(() => {
			void Promise.all([
				props.initialRuntime.close(),
				Promise.resolve(clearInterval(idleSweepTimer)),
				...Array.from(actorSubscriptions.values()).map((unsubscribe) => {
					unsubscribe()
					return Promise.resolve()
				}),
				...registry.list().map((actor) => actor.close()),
				...Array.from(bundleCache.values()).map((bundle) => bundle.then((entry) => entry.close())),
			]).finally(() => process.exit(0))
		})
	}

	const controller: WorkspaceSwitchController = {
		currentCwd: () => focusedBinding()?.services.sessionManager.projectCwd ?? initialCwd,
		switchTo: async (request: WorkspaceSwitchRequest) => {
			const { loaded, sessionPath } = await loadForRequest(request)
			const laneId = ensureLaneForSession(
				laneStore,
				laneStore.lanes(),
				request.cwd,
				props.initialRuntime.config,
				loaded,
				sessionPath,
				{
					laneId: request.laneId,
					title: request.initialSessionTitle,
					select: true,
				},
			)
			const actor = await focusLane(laneId)
			if (!actor) return { switched: false, session: loaded, visibleSession: { state: "none" } }
			const visibleSession = request.sessionPath
				? loaded && sessionPath
					? visibleSessionForLoaded(request.cwd, loaded, sessionPath)
					: { state: "missing" as const, cwd: request.cwd, sessionPath: request.sessionPath }
				: loaded && sessionPath
					? visibleSessionForLoaded(request.cwd, loaded, sessionPath)
					: { state: "none" as const }
			return { switched: true, session: loaded, visibleSession }
		},
	}

	onCleanup(() => {
		void laneStore.flush()
		clearInterval(idleSweepTimer)
		void props.initialRuntime.close()
		for (const unsubscribe of actorSubscriptions.values()) unsubscribe()
		for (const actor of registry.list()) void actor.close()
		for (const bundle of bundleCache.values()) void bundle.then((entry) => entry.close())
	})

	return (
		<Show when={initialReady()}>
			<WorkspaceSwitchProvider controller={controller}>
				<RuntimeProvider runtime={focusedRuntime}>
					<TuiApp
						initialSession={props.initialSession}
						initialVisibleSession={props.initialSession && props.initialRuntime.sessionManager.sessionPath
							? visibleSessionForLoaded(initialCwd, props.initialSession, props.initialRuntime.sessionManager.sessionPath)
							: undefined}
						initialPrompt={props.initialPrompt}
						laneStore={laneStore}
						workspaceLanes={workspaceLanes}
						hostNotifications={notificationService.notifications}
						activityEntries={activityIndex.entries}
						acknowledgeHostNotification={(id) => notificationService.acknowledge(id)}
						focusedActor={focusController.focusedActor}
						canStartPrompt={() => {
							const laneId = focusController.focusedLaneId()
							if (laneId === null) return { ok: true }
							const admission = registry.canStartStream(laneId)
							return admission.type === "accepted"
								? { ok: true }
								: { ok: false, maxStreaming: admission.maxStreaming }
						}}
						removeLaneActor={removeLaneActor}
						active={() => true}
						onExit={closeHost}
					/>
				</RuntimeProvider>
			</WorkspaceSwitchProvider>
		</Show>
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

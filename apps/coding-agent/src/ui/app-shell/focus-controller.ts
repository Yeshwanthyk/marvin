import type { Accessor, Setter } from "solid-js"
import type { SessionActorDescriptor } from "@yeshwanthyk/runtime-effect/project-bundle.js"
import type { LaneCursorV2, LaneId, WorkspaceLaneStore, WorkspaceLanesV2 } from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import type { SessionActorRegistry } from "../../runtime/session-actor-registry.js"
import type { SessionActor } from "../../runtime/session-actor.js"

export interface FocusController {
	readonly focusedLaneId: Accessor<LaneId | null>
	readonly focusedActor: Accessor<SessionActor | null>
	focusLane(laneId: LaneId): Promise<SessionActor | null>
	focusCursor(cursor: LaneCursorV2): Promise<SessionActor | null>
}

export interface FocusControllerOptions {
	readonly laneStore: WorkspaceLaneStore
	readonly workspaceLanes: Accessor<WorkspaceLanesV2>
	readonly registry: SessionActorRegistry
	readonly setFocusedLaneId: Setter<LaneId | null>
	readonly protectedLaneIds?: Accessor<readonly LaneId[]>
}

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
		...(session.location !== undefined ? { location: session.location } : {}),
		initialTitle: session.title,
	}
}

export const createFocusController = ({
	laneStore,
	workspaceLanes,
	registry,
	setFocusedLaneId,
	protectedLaneIds,
}: FocusControllerOptions): FocusController => {
	const focusLane = async (laneId: LaneId): Promise<SessionActor | null> => {
			const lanes = workspaceLanes()
			const descriptor = descriptorForLane(lanes, laneId)
			if (!descriptor) return null
			const previousSelection = lanes.selection
			const previousLaneId = previousSelection?.laneId
			const previousActor = previousLaneId && previousLaneId !== laneId ? registry.get(previousLaneId) : null
			laneStore.dispatch({ type: "select", projectId: descriptor.projectId, laneId })
			previousActor?.refreshUiPolicy(false)
			const actor = registry.getOrCreate(descriptor)
		actor.bindView({ isFocused: () => workspaceLanes().selection?.laneId === laneId })
		if (descriptor.location?.kind === "cloud") {
			setFocusedLaneId(laneId)
			actor.projection.clearUnread()
			return actor
		}
		const excludeLaneIds = Array.from(new Set([
			...(protectedLaneIds?.() ?? []),
			previousLaneId,
				laneId,
			].filter((entry): entry is LaneId => entry !== undefined)))
			let result: Awaited<ReturnType<SessionActorRegistry["hydrate"]>>
			try {
				result = await registry.hydrate(laneId, "focus", { excludeLaneIds })
			} catch (error) {
				if (previousSelection && previousSelection.laneId !== laneId) {
					laneStore.dispatch({ type: "select", projectId: previousSelection.projectId, laneId: previousSelection.laneId })
					actor.refreshUiPolicy(false)
					previousActor?.refreshUiPolicy(true)
					setFocusedLaneId(previousSelection.laneId)
				}
				throw error
			}
			if (result.type === "stream-limit-reached") return result.actor
			setFocusedLaneId(laneId)
			actor.projection.clearUnread()
			return actor
	}

	return {
		focusedLaneId: () => workspaceLanes().selection?.laneId ?? null,
		focusedActor: () => {
			const laneId = workspaceLanes().selection?.laneId
			return laneId ? registry.get(laneId) : null
		},
		focusLane,
		focusCursor: (cursor) => focusLane(cursor.session.laneId),
	}
}

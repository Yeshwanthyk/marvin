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
		initialTitle: session.title,
	}
}

export const createFocusController = ({
	laneStore,
	workspaceLanes,
	registry,
	setFocusedLaneId,
}: FocusControllerOptions): FocusController => {
	const focusLane = async (laneId: LaneId): Promise<SessionActor | null> => {
		const lanes = workspaceLanes()
		const descriptor = descriptorForLane(lanes, laneId)
		if (!descriptor) return null
		const previousLaneId = lanes.selection?.laneId
		const previousActor = previousLaneId && previousLaneId !== laneId ? registry.get(previousLaneId) : null
		laneStore.dispatch({ type: "select", projectId: descriptor.projectId, laneId })
		previousActor?.refreshUiPolicy(false)
		const actor = registry.getOrCreate(descriptor)
		actor.bindView({ isFocused: () => workspaceLanes().selection?.laneId === laneId })
		const result = await registry.hydrate(laneId, "focus")
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

import { createSignal } from "solid-js"
import { randomUUID } from "node:crypto"
import type { Accessor } from "solid-js"
import type {
	LaneId,
	WorkspaceLaneStore,
	WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"

export type ActivityStatus = "cold" | "warm" | "streaming" | "queued" | "completed" | "errored" | "suspended"
export type HostNotificationLevel = "info" | "success" | "warning" | "error"

export interface SessionActivity {
	readonly laneId: LaneId
	readonly status: ActivityStatus
	readonly isResponding: boolean
	readonly unread: boolean
	readonly lastActivityAt: number
	readonly lastCompletedAt?: number
	readonly lastError?: string
	readonly tokenCount?: number
}

export type SessionActivityPatch =
	Partial<Omit<SessionActivity, "laneId" | "lastError">> & { readonly lastError?: string | null }

export interface ActivityIndex {
	get(laneId: LaneId): SessionActivity | undefined
	patch(laneId: LaneId, patch: SessionActivityPatch): void
	listActive(): readonly SessionActivity[]
	readonly entries: Accessor<readonly SessionActivity[]>
}

export interface HostNotification {
	readonly id: string
	readonly laneId: LaneId
	readonly projectId: string
	readonly level: HostNotificationLevel
	readonly title: string
	readonly message: string
	readonly createdAt: number
}

export interface HostNotificationInput {
	readonly laneId: LaneId
	readonly projectId: string
	readonly level: HostNotificationLevel
	readonly title: string
	readonly message: string
}

export interface NotificationService {
	enqueue(notification: HostNotificationInput): HostNotification
	acknowledge(id: string): void
	list(): readonly HostNotification[]
	readonly notifications: Accessor<readonly HostNotification[]>
}

export interface ActivityLaneLookup {
	readonly projectId: string
	readonly sessionId: string | null
	readonly sessionPath: string | null
}

export interface TuiActivityTransitionInput {
	readonly activity: {
		readonly isResponding: boolean
		readonly sessionId: string | null
		readonly sessionPath: string | null
		readonly sessionTitle?: string
		readonly lastError: string | null
		readonly tokenCount: number
	}
	readonly projectId: string
	readonly laneStore: WorkspaceLaneStore
	readonly activityIndex: ActivityIndex
	readonly notifications: NotificationService
	readonly wasResponding: boolean
	readonly isFocused: boolean
	readonly now: number
}

export const createActivityIndex = (): ActivityIndex => {
	const [entries, setEntries] = createSignal<readonly SessionActivity[]>([])
	const byLaneId = new Map<LaneId, SessionActivity>()

	const writeEntries = () => {
		setEntries(Array.from(byLaneId.values()).sort((a, b) => b.lastActivityAt - a.lastActivityAt))
	}

	return {
		entries,
		get: (laneId) => byLaneId.get(laneId),
		patch: (laneId, patch) => {
			const previous = byLaneId.get(laneId)
			const next: SessionActivity = {
				laneId,
				status: patch.status ?? previous?.status ?? "warm",
				isResponding: patch.isResponding ?? previous?.isResponding ?? false,
				unread: patch.unread ?? previous?.unread ?? false,
				lastActivityAt: patch.lastActivityAt ?? previous?.lastActivityAt ?? Date.now(),
				...(patch.lastCompletedAt !== undefined
					? { lastCompletedAt: patch.lastCompletedAt }
					: previous?.lastCompletedAt !== undefined
						? { lastCompletedAt: previous.lastCompletedAt }
						: {}),
				...(patch.lastError === null
					? {}
					: patch.lastError !== undefined
						? { lastError: patch.lastError }
						: previous?.lastError
							? { lastError: previous.lastError }
							: {}),
				...(patch.tokenCount !== undefined
					? { tokenCount: patch.tokenCount }
					: previous?.tokenCount !== undefined
						? { tokenCount: previous.tokenCount }
						: {}),
			}
			byLaneId.set(laneId, next)
			writeEntries()
		},
		listActive: () => entries(),
	}
}

export const createNotificationService = (): NotificationService => {
	const [notifications, setNotifications] = createSignal<readonly HostNotification[]>([])
	return {
		notifications,
		enqueue: (notification) => {
			const created: HostNotification = {
				id: randomUUID(),
				createdAt: Date.now(),
				...notification,
			}
			setNotifications((prev) => [...prev, created])
			return created
		},
		acknowledge: (id) => {
			setNotifications((prev) => prev.filter((notification) => notification.id !== id))
		},
		list: () => notifications(),
	}
}

export const resolveActivityLaneId = (
	lanes: WorkspaceLanesV2,
	lookup: ActivityLaneLookup,
): LaneId | undefined => {
	const order = lanes.sessionOrderByProject[lookup.projectId] ?? []
	for (const laneId of order) {
		const lane = lanes.sessionsById[laneId]
		if (!lane) continue
		if (lookup.sessionPath !== null && lane.sessionPath === lookup.sessionPath) return lane.laneId
		if (lookup.sessionId !== null && lane.sessionId === lookup.sessionId) return lane.laneId
	}
	for (const lane of Object.values(lanes.sessionsById)) {
		if (lane.projectId !== lookup.projectId) continue
		if (lookup.sessionPath !== null && lane.sessionPath === lookup.sessionPath) return lane.laneId
		if (lookup.sessionId !== null && lane.sessionId === lookup.sessionId) return lane.laneId
	}
	return undefined
}

export const applyTuiActivityTransition = ({
	activity,
	projectId,
	laneStore,
	activityIndex,
	notifications,
	wasResponding,
	isFocused,
	now,
}: TuiActivityTransitionInput): LaneId | undefined => {
	const laneId = resolveActivityLaneId(laneStore.lanes(), {
		projectId,
		sessionId: activity.sessionId,
		sessionPath: activity.sessionPath,
	})
	if (laneId === undefined) return undefined

	const completed = wasResponding && !activity.isResponding
	const status: ActivityStatus = activity.isResponding
		? "streaming"
		: completed && activity.lastError !== null
			? "errored"
			: completed
				? "completed"
				: "warm"
	activityIndex.patch(laneId, {
		status,
		isResponding: activity.isResponding,
		lastActivityAt: now,
		...(completed ? { lastCompletedAt: now } : {}),
		lastError: activity.lastError,
		tokenCount: activity.tokenCount,
		...(completed && !isFocused ? { unread: true } : {}),
	})

	if (completed && !isFocused) {
		const lanes = laneStore.lanes()
		const lane = lanes.sessionsById[laneId]
		const project = lane ? lanes.projectsById[lane.projectId] : undefined
		const title = activity.sessionTitle ?? lane?.title ?? "Session"
		notifications.enqueue({
			laneId,
			projectId,
			level: activity.lastError === null ? "success" : "error",
			title: activity.lastError === null ? "Session complete" : "Session failed",
			message: `${project?.title ?? projectId} / ${title}${activity.lastError === null ? "" : `: ${activity.lastError}`}`,
		})
	}

	return laneId
}

import type { SearchSelectOption } from "../components/modals/search-select-options.js"
import {
	activeSessionsForProject,
	type LaneId,
	type SessionLaneV2,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import type { SessionActivity } from "./activity-index.js"

export interface OverviewSelection {
	type: "session"
	laneId: LaneId
}

const SESSION_PREFIX = "overview:session:" as const

const activityRank = (activity?: SessionActivity): number => {
	if (!activity) return 5
	if (activity.isResponding || activity.status === "streaming") return 0
	if (activity.status === "queued") return 1
	if (activity.unread) return 2
	if (activity.status === "errored") return 3
	if (activity.status === "completed") return 4
	return 5
}

const activityLabel = (activity?: SessionActivity): string => {
	if (!activity) return "warm"
	if (activity.isResponding || activity.status === "streaming") return activity.unread ? "streaming unread" : "streaming"
	if (activity.status === "queued") return activity.unread ? "queued unread" : "queued"
	if (activity.status === "errored") return activity.unread ? "errored unread" : "errored"
	if (activity.status === "completed") return activity.unread ? "done unread" : "done"
	if (activity.unread) return `${activity.status} unread`
	return activity.status
}

const activityGlyph = (activity?: SessionActivity): string => {
	const label = activityLabel(activity)
	if (label.includes("streaming")) return "●"
	if (label.includes("queued")) return "◌"
	if (label.includes("unread")) return "•"
	if (label.includes("errored")) return "!"
	return " "
}

const overviewSessionValue = (laneId: LaneId): string => `${SESSION_PREFIX}${laneId}`

export const parseOverviewValue = (value: string): OverviewSelection | null => {
	if (!value.startsWith(SESSION_PREFIX)) return null
	const laneId = value.slice(SESSION_PREFIX.length)
	return laneId.length > 0 ? { type: "session", laneId } : null
}

export const createOverviewOptions = (
	lanes: WorkspaceLanesV2,
	activities: readonly SessionActivity[] = [],
): SearchSelectOption[] => {
	const activityByLaneId = new Map(activities.map((activity) => [activity.laneId, activity]))
	const projectIds = lanes.projectOrder.filter((projectId) => lanes.projectsById[projectId]?.archivedAt === undefined)
	const rows: Array<{
		readonly session: SessionLaneV2
		readonly projectIndex: number
		readonly sessionIndex: number
		readonly sessionCount: number
		readonly activity?: SessionActivity
	}> = []

	projectIds.forEach((projectId, projectOffset) => {
		const sessions = activeSessionsForProject(lanes, projectId)
		sessions.forEach((session, sessionOffset) => {
			rows.push({
				session,
				projectIndex: projectOffset + 1,
				sessionIndex: sessionOffset + 1,
				sessionCount: sessions.length,
				activity: activityByLaneId.get(session.laneId),
			})
		})
	})

	return rows
		.sort((a, b) => activityRank(a.activity) - activityRank(b.activity)
			|| a.projectIndex - b.projectIndex
			|| a.sessionIndex - b.sessionIndex)
		.map(({ session, projectIndex, sessionIndex, sessionCount, activity }) => {
			const project = lanes.projectsById[session.projectId]
			const projectTitle = project?.title ?? session.projectId
			const projectCount = Math.max(1, projectIds.length)
			const shortId = (session.sessionId ?? session.laneId).slice(0, 8)
			const title = session.title || shortId
			const model = `${session.provider}/${session.modelId}`
			const position = `${projectIndex}/${projectCount} ${sessionIndex}/${sessionCount}`
			const status = activityLabel(activity)
			return {
				value: overviewSessionValue(session.laneId),
				label: `${activityGlyph(activity)} ${projectTitle} ${position}  ${title}`.trimStart(),
				description: `${status} | ${model} | ${shortId}`,
				keywords: `${projectTitle} ${title} ${position} ${status} ${session.sessionId} ${session.sessionPath} ${model} overview lane project session`,
			}
		})
}

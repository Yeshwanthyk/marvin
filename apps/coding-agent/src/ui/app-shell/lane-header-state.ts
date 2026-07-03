import {
	activeSessionsForProject,
	findActiveCursorV2,
	type LaneCursorV2,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import type { SessionActivity } from "./activity-index.js"
import { isExternalLaneId } from "../../runtime/cockpit-actions.js"

export type LaneHeaderMode = "off" | "sticky" | "oneshot" | "prefix"

export interface LaneHeaderCurrent {
	projectTitle: string
	sessionTitle: string
	sessionShortId: string
	projectIndex: number
	projectCount: number
	sessionIndex: number
	sessionCount: number
	previousSessionTitle?: string
	nextSessionTitle?: string
	previousProjectTitle?: string
	nextProjectTitle?: string
	external: boolean
}

export interface LaneHeaderState {
	mode: LaneHeaderMode
	current: LaneHeaderCurrent | null
	archivedCount: number
	activity: LaneHeaderActivity
}

export interface LaneHeaderActivity {
	runningAbove: number
	runningBelow: number
	unreadAbove: number
	unreadBelow: number
	runningHere: number
	unreadHere: number
}

export interface LaneHeaderDisplay {
	active: boolean
	badge: "" | "lane" | "next" | "prefix"
	summary: string
	position: string
	adjacent: string
	activityBadges: string
	hint: string
}

const toHeaderCurrent = (lanes: WorkspaceLanesV2, cursor: LaneCursorV2): LaneHeaderCurrent => {
	const sessions = activeSessionsForProject(lanes, cursor.project.id)
	const sessionIndex = sessions.findIndex((session) => session.laneId === cursor.session.laneId)
	const projects = lanes.projectOrder.filter((projectId) => lanes.projectsById[projectId]?.archivedAt === undefined)
	const projectIndex = projects.indexOf(cursor.project.id)
	const previousSession = sessions[sessionIndex - 1]
	const nextSession = sessions[sessionIndex + 1]
	const previousProjectId = projects[projectIndex - 1]
	const nextProjectId = projects[projectIndex + 1]
	const shortId = (cursor.session.sessionId ?? cursor.session.laneId).slice(0, 8)
	return {
		projectTitle: cursor.project.title,
		sessionTitle: cursor.session.title || shortId,
		sessionShortId: shortId,
		projectIndex: projectIndex >= 0 ? projectIndex + 1 : 1,
		projectCount: Math.max(1, projects.length),
		sessionIndex: sessionIndex >= 0 ? sessionIndex + 1 : 1,
		sessionCount: Math.max(1, sessions.length),
		...(previousSession ? { previousSessionTitle: previousSession.title || (previousSession.sessionId ?? previousSession.laneId).slice(0, 8) } : {}),
		...(nextSession ? { nextSessionTitle: nextSession.title || (nextSession.sessionId ?? nextSession.laneId).slice(0, 8) } : {}),
		...(previousProjectId ? { previousProjectTitle: lanes.projectsById[previousProjectId]?.title ?? previousProjectId } : {}),
		...(nextProjectId ? { nextProjectTitle: lanes.projectsById[nextProjectId]?.title ?? nextProjectId } : {}),
		external: isExternalLaneId(cursor.session.laneId),
	}
}

const emptyActivity = (): LaneHeaderActivity => ({
	runningAbove: 0,
	runningBelow: 0,
	unreadAbove: 0,
	unreadBelow: 0,
	runningHere: 0,
	unreadHere: 0,
})

const deriveActivity = (
	lanes: WorkspaceLanesV2,
	cursor: LaneCursorV2 | null,
	activities: readonly SessionActivity[],
): LaneHeaderActivity => {
	if (!cursor || activities.length === 0) return emptyActivity()
	const projects = lanes.projectOrder.filter((projectId) => lanes.projectsById[projectId]?.archivedAt === undefined)
	const currentProjectIndex = projects.indexOf(cursor.project.id)
	const result = emptyActivity()
	for (const activity of activities) {
		if (activity.laneId === cursor.session.laneId) continue
		const session = lanes.sessionsById[activity.laneId]
		if (!session || session.archivedAt !== undefined) continue
		const projectIndex = projects.indexOf(session.projectId)
		if (projectIndex < 0) continue
		const isRunning = activity.isResponding || activity.status === "streaming" || activity.status === "queued"
		if (projectIndex < currentProjectIndex) {
			if (isRunning) result.runningAbove += 1
			if (activity.unread) result.unreadAbove += 1
			continue
		}
		if (projectIndex > currentProjectIndex) {
			if (isRunning) result.runningBelow += 1
			if (activity.unread) result.unreadBelow += 1
			continue
		}
		if (isRunning) result.runningHere += 1
		if (activity.unread) result.unreadHere += 1
	}
	return result
}

export const deriveLaneHeaderState = (
	lanes: WorkspaceLanesV2,
	mode: LaneHeaderMode,
	activities: readonly SessionActivity[] = [],
): LaneHeaderState => {
	const cursor = findActiveCursorV2(lanes)
	return {
		mode,
		current: cursor ? toHeaderCurrent(lanes, cursor) : null,
		archivedCount: Object.values(lanes.sessionsById).filter((session) => session.archivedAt !== undefined).length,
		activity: deriveActivity(lanes, cursor, activities),
	}
}

const activityBadges = (activity: LaneHeaderActivity): string => {
	const parts: string[] = []
	if (activity.runningAbove > 0) parts.push(`↑${activity.runningAbove}●`)
	if (activity.runningBelow > 0) parts.push(`↓${activity.runningBelow}●`)
	if (activity.unreadAbove > 0) parts.push(`↑${activity.unreadAbove}•`)
	if (activity.unreadBelow > 0) parts.push(`↓${activity.unreadBelow}•`)
	if (activity.runningHere > 0) parts.push(`↔${activity.runningHere}●`)
	if (activity.unreadHere > 0) parts.push(`↔${activity.unreadHere}•`)
	return parts.join(" ")
}

export const laneHeaderDisplay = (state: LaneHeaderState): LaneHeaderDisplay => {
	const active = state.mode !== "off"
	const badge = state.mode === "oneshot" ? "next" : state.mode === "sticky" ? "lane" : state.mode === "prefix" ? "prefix" : ""
	const hint = state.mode === "oneshot"
		? "next move"
		: state.mode === "sticky"
			? "enter exits"
			: state.mode === "prefix"
				? "arrows focus · shift move · n new · $ rename · o overview"
				: ""
	const current = state.current
	if (!current) {
		return {
			active,
			badge,
			summary: active ? "no session selected" : "",
			position: "",
			adjacent: "",
			activityBadges: activityBadges(state.activity),
			hint,
		}
	}
	const projectTitle = current.external ? `ext ${current.projectTitle}` : current.projectTitle
	const position = `${projectTitle} ${current.projectIndex}/${current.projectCount} · ${current.sessionIndex}/${current.sessionCount}`
	const adjacentParts = [
		current.previousSessionTitle ? `←${current.previousSessionTitle}` : "",
		current.nextSessionTitle ? `→${current.nextSessionTitle}` : "",
		current.previousProjectTitle ? `↑${current.previousProjectTitle}` : "",
		current.nextProjectTitle ? `↓${current.nextProjectTitle}` : "",
	].filter(Boolean)
	return {
		active,
		badge,
		summary: `${position} · ${current.sessionTitle}`,
		position,
		adjacent: adjacentParts.join(" "),
		activityBadges: activityBadges(state.activity),
		hint,
	}
}

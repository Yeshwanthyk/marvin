import {
	activeSessionsForProject,
	findActiveCursor,
	type LaneCursor,
	type WorkspaceLanes,
} from "@yeshwanthyk/runtime-effect/workspace-lanes.js"

export type LaneHeaderMode = "off" | "sticky" | "oneshot"

export interface LaneHeaderCurrent {
	projectTitle: string
	sessionTitle: string
	sessionShortId: string
	sessionIndex: number
	sessionCount: number
}

export interface LaneHeaderState {
	mode: LaneHeaderMode
	current: LaneHeaderCurrent | null
	archivedCount: number
}

export interface LaneHeaderDisplay {
	active: boolean
	badge: "" | "lane" | "next"
	summary: string
	hint: string
}

const toHeaderCurrent = (lanes: WorkspaceLanes, cursor: LaneCursor): LaneHeaderCurrent => {
	const sessions = activeSessionsForProject(lanes, cursor.project.id)
	const sessionIndex = sessions.findIndex((session) => session.id === cursor.session.id)
	return {
		projectTitle: cursor.project.title,
		sessionTitle: cursor.session.title || cursor.session.sessionId.slice(0, 8),
		sessionShortId: cursor.session.sessionId.slice(0, 8),
		sessionIndex: sessionIndex >= 0 ? sessionIndex + 1 : 1,
		sessionCount: Math.max(1, sessions.length),
	}
}

export const deriveLaneHeaderState = (lanes: WorkspaceLanes, mode: LaneHeaderMode): LaneHeaderState => {
	const cursor = findActiveCursor(lanes)
	return {
		mode,
		current: cursor ? toHeaderCurrent(lanes, cursor) : null,
		archivedCount: lanes.sessions.filter((session) => session.archivedAt !== undefined).length,
	}
}

export const laneHeaderDisplay = (state: LaneHeaderState): LaneHeaderDisplay => {
	const active = state.mode !== "off"
	const badge = state.mode === "oneshot" ? "next" : state.mode === "sticky" ? "lane" : ""
	const hint = state.mode === "oneshot" ? "next move" : state.mode === "sticky" ? "enter exits" : ""
	const current = state.current
	if (!current) {
		return {
			active,
			badge,
			summary: active ? "no session selected" : "",
			hint,
		}
	}
	const count = current.sessionCount > 1 ? ` ${current.sessionIndex}/${current.sessionCount}` : ""
	return {
		active,
		badge,
		summary: `${current.projectTitle} · ${current.sessionTitle}${count}`,
		hint,
	}
}

import {
	activeSessionsForProject,
	findActiveCursorV2,
	type LaneCursorV2,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"

export type LaneHeaderMode = "off" | "sticky" | "oneshot" | "prefix"

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
	badge: "" | "lane" | "next" | "prefix"
	summary: string
	hint: string
}

const toHeaderCurrent = (lanes: WorkspaceLanesV2, cursor: LaneCursorV2): LaneHeaderCurrent => {
	const sessions = activeSessionsForProject(lanes, cursor.project.id)
	const sessionIndex = sessions.findIndex((session) => session.laneId === cursor.session.laneId)
	const shortId = (cursor.session.sessionId ?? cursor.session.laneId).slice(0, 8)
	return {
		projectTitle: cursor.project.title,
		sessionTitle: cursor.session.title || shortId,
		sessionShortId: shortId,
		sessionIndex: sessionIndex >= 0 ? sessionIndex + 1 : 1,
		sessionCount: Math.max(1, sessions.length),
	}
}

export const deriveLaneHeaderState = (lanes: WorkspaceLanesV2, mode: LaneHeaderMode): LaneHeaderState => {
	const cursor = findActiveCursorV2(lanes)
	return {
		mode,
		current: cursor ? toHeaderCurrent(lanes, cursor) : null,
		archivedCount: Object.values(lanes.sessionsById).filter((session) => session.archivedAt !== undefined).length,
	}
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

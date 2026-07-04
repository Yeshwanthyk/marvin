import {
	activeSessionsForProject,
	findActiveCursorV2,
	type LaneCursorV2,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { DEFAULT_KEYMAP_CONFIG, type LaneKeymapConfig } from "@yeshwanthyk/runtime-effect/config.js"
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
	cloudBeamId?: string
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
	sessionTitle: string
	adjacent: string
	activityBadges: string
	hint: string
	navHelp: string
}

export interface LaneHeaderLine {
	primary: string
	navHelp: string
}

export interface LaneHeaderLineOptions {
	width: number
	leftWidth: number
	keymap?: LaneKeymapConfig
}

const HEADER_PRIMARY_CHROME_WIDTH = 8
const HEADER_NAV_CHROME_WIDTH = 4

export const laneHeaderVisibleWidth = (text: string): number => Array.from(text).length

const truncateHeaderText = (text: string, maxWidth: number, ellipsis = "…"): string => {
	if (maxWidth <= 0) return ""
	if (laneHeaderVisibleWidth(text) <= maxWidth) return text
	const ellipsisWidth = laneHeaderVisibleWidth(ellipsis)
	if (maxWidth <= ellipsisWidth) return ellipsis.slice(0, maxWidth)
	let result = ""
	let width = 0
	for (const char of text) {
		const charWidth = laneHeaderVisibleWidth(char)
		if (width + charWidth + ellipsisWidth > maxWidth) break
		result += char
		width += charWidth
	}
	return `${result}${ellipsis}`
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
		...(cursor.session.location?.kind === "cloud" ? { cloudBeamId: cursor.session.location.beamId } : {}),
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

const chordKeyLabels: Record<string, string> = {
	left: "←",
	right: "→",
	up: "↑",
	down: "↓",
	return: "↵",
	enter: "↵",
	escape: "Esc",
	esc: "Esc",
	space: "Space",
	tab: "Tab",
}

const chordModifierLabels: Record<string, string> = {
	ctrl: "⌃",
	control: "⌃",
	shift: "⇧",
	alt: "⌥",
	option: "⌥",
	meta: "⌘",
	mod: "⌘",
	super: "⌘",
	cmd: "⌘",
	command: "⌘",
}

export const formatChord = (chord: string): string => {
	const parts = chord.toLowerCase().split("+").filter((part) => part.length > 0)
	const key = parts.at(-1) ?? chord
	const modifiers = parts.slice(0, -1).map((part) => chordModifierLabels[part] ?? part)
	const keyLabel = chordKeyLabels[key] ?? key
	return [...modifiers, keyLabel].join("")
}

const firstChord = (keys: readonly string[]): string => keys[0] ? formatChord(keys[0]) : ""

const commandChord = (keys: readonly string[]): string => {
	const preferred = keys.find((key) => key === "mod+k" || key === "super+k" || key === "meta+k" || key === "cmd+k")
	return preferred ? formatChord(preferred) : firstChord(keys)
}

const stickyExitHint = (keymap: LaneKeymapConfig): string => {
	const activation = keymap.activation
	if (activation.behavior === "sticky") return `${firstChord(activation.exit)} exits`.trim()
	if (activation.behavior === "toggle") return `${firstChord(activation.exit)} exits`.trim()
	return `${firstChord(activation.cancel)} cancels`.trim()
}

const moveChordSummary = (keymap: LaneKeymapConfig): string => {
	const moves = [
		keymap.bindings.moveSessionPrev[0],
		keymap.bindings.moveSessionNext[0],
		keymap.bindings.moveProjectPrev[0],
		keymap.bindings.moveProjectNext[0],
	]
	if (moves.every((key, index) => key === `shift+${(["left", "right", "up", "down"] as const)[index]}`)) return "⇧arrows"
	return moves.filter((key): key is string => key !== undefined).map(formatChord).join("/")
}

const projectJumpSummary = (keymap: LaneKeymapConfig): string => {
	const jumps = [
		keymap.bindings.jumpProject1[0],
		keymap.bindings.jumpProject2[0],
		keymap.bindings.jumpProject3[0],
		keymap.bindings.jumpProject4[0],
		keymap.bindings.jumpProject5[0],
		keymap.bindings.jumpProject6[0],
		keymap.bindings.jumpProject7[0],
		keymap.bindings.jumpProject8[0],
		keymap.bindings.jumpProject9[0],
	]
	if (jumps.every((key, index) => key === String(index + 1))) return "1-9"
	return jumps.filter((key): key is string => key !== undefined).map(formatChord).join("/")
}

const prefixHelp = (keymap: LaneKeymapConfig): string => [
	"arrows focus",
	`${moveChordSummary(keymap)} move`.trim(),
	`${firstChord(keymap.bindings.newSession)} new`.trim(),
	`${firstChord(keymap.bindings.rename)} rename`.trim(),
	`${firstChord(keymap.bindings.overview)} overview`.trim(),
	`${projectJumpSummary(keymap)} project`.trim(),
].filter((part) => part.length > 0).join(" · ")

const idleHint = (keymap: LaneKeymapConfig): string => [
	`${firstChord(keymap.prefixKey)} lanes`.trim(),
	`${commandChord(keymap.bindings.jump)} commands`.trim(),
].filter((part) => part.length > 0).join(" · ")

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

export const laneHeaderDisplay = (state: LaneHeaderState, keymap: LaneKeymapConfig = DEFAULT_KEYMAP_CONFIG.lanes): LaneHeaderDisplay => {
	const active = state.mode !== "off"
	const badge = state.mode === "oneshot" ? "next" : state.mode === "sticky" ? "lane" : state.mode === "prefix" ? "prefix" : ""
	const hint = state.mode === "oneshot"
		? "next move"
		: state.mode === "sticky"
			? stickyExitHint(keymap)
			: state.mode === "prefix"
				? "Esc cancels"
				: idleHint(keymap)
	const navHelp = state.mode === "prefix" ? prefixHelp(keymap) : state.mode === "sticky" ? "arrows focus" : ""
	const current = state.current
	if (!current) {
		return {
			active,
			badge,
			summary: active ? "no session selected" : "",
			position: "",
			sessionTitle: "",
			adjacent: "",
			activityBadges: activityBadges(state.activity),
			hint,
			navHelp,
		}
	}
	const projectTitle = current.external ? `ext ${current.projectTitle}` : current.projectTitle
	const sessionTitle = current.cloudBeamId ? `☁ ${current.sessionTitle}` : current.sessionTitle
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
		summary: `${position} · ${sessionTitle}`,
		position,
		sessionTitle,
		adjacent: active ? adjacentParts.join(" ") : "",
		activityBadges: activityBadges(state.activity),
		hint,
		navHelp,
	}
}

const withSuffix = (prefix: string, suffix: string): string => {
	if (prefix.length === 0) return suffix
	if (suffix.length === 0) return prefix
	return `${prefix}  ${suffix}`
}

const appendPart = (line: string, separator: string, part: string): string =>
	part.length > 0 ? `${line}${separator}${part}` : line

export const laneHeaderLine = (
	state: LaneHeaderState,
	options: LaneHeaderLineOptions,
): LaneHeaderLine => {
	const display = laneHeaderDisplay(state, options.keymap)
	const maxWidth = Math.max(0, options.width - options.leftWidth - HEADER_PRIMARY_CHROME_WIDTH)
	const navHelpWidth = Math.max(0, options.width - HEADER_NAV_CHROME_WIDTH)
	if (maxWidth <= 0) return { primary: "", navHelp: truncateHeaderText(display.navHelp, navHelpWidth, "…") }

	const badge = display.badge ? `${display.badge} ` : ""
	const base = display.position ? `${badge}${display.position}` : `${badge}${display.summary}`.trim()
	const suffix = [display.activityBadges, display.hint].filter((part) => part.length > 0).join("  ")
	if (base.length === 0) {
		return {
			primary: truncateHeaderText(suffix, maxWidth, "…"),
			navHelp: truncateHeaderText(display.navHelp, navHelpWidth, "…"),
		}
	}

	const suffixBudget = suffix.length > 0
		? Math.min(laneHeaderVisibleWidth(suffix), Math.max(0, Math.floor(maxWidth * 0.36)))
		: 0
	const renderedSuffix = suffixBudget > 0 ? truncateHeaderText(suffix, suffixBudget, "…") : ""
	const suffixWidth = renderedSuffix.length > 0 ? laneHeaderVisibleWidth(`  ${renderedSuffix}`) : 0
	const baseWidth = laneHeaderVisibleWidth(base)
	const titleSeparator = " · "
	const titleBudget = Math.max(0, maxWidth - baseWidth - suffixWidth - laneHeaderVisibleWidth(titleSeparator))
	const title = titleBudget >= 4 && display.sessionTitle.length > 0
		? truncateHeaderText(display.sessionTitle, titleBudget, "…")
		: ""

	let primary = base
	if (title.length > 0) primary = appendPart(primary, titleSeparator, title)

	const adjacent = display.adjacent
	const adjacentBudget = Math.max(0, maxWidth - laneHeaderVisibleWidth(primary) - suffixWidth - 2)
	if (adjacentBudget >= 8 && adjacent.length > 0) {
		primary = appendPart(primary, "  ", truncateHeaderText(adjacent, adjacentBudget, "…"))
	}

	primary = withSuffix(primary, renderedSuffix)
	if (laneHeaderVisibleWidth(primary) > maxWidth) primary = withSuffix(base, renderedSuffix)
	if (laneHeaderVisibleWidth(primary) > maxWidth) primary = truncateHeaderText(primary, maxWidth, "…")

	return {
		primary,
		navHelp: truncateHeaderText(display.navHelp, navHelpWidth, "…"),
	}
}

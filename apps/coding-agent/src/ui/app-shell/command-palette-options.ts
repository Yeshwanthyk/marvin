import type { SearchSelectOption } from "../components/modals/search-select-options.js"
import {
	activeSessionsForProject,
	type SessionLaneV2,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import type { WorkspaceProject } from "@yeshwanthyk/runtime-effect/workspace-projects.js"
import type { ScratchpadItem } from "@yeshwanthyk/runtime-effect/scratchpads.js"
import { isExternalLaneId } from "../../runtime/cockpit-actions.js"

export type CommandPaletteAction =
	| "settings"
	| "rename"
	| "newProjectSession"
	| "saveScratchpad"
	| "openScratchpad"
	| "startScratchpad"
	| "detach"
	| "archive"
	| "restore"
	| "moveToCloud"
	| "pullFromCloud"
	| "jumpExternal"
	| "previewExternal"

export type CommandPaletteSelection =
	| { type: "action"; action: CommandPaletteAction }
	| { type: "session"; sessionLaneId: string }
	| { type: "project"; cwd: string }
	| { type: "scratchpad"; id: string }

const ACTION_PREFIX = "action:" as const
const SESSION_PREFIX = "session:" as const
const PROJECT_PREFIX = "project:" as const
const SCRATCHPAD_PREFIX = "scratchpad:" as const
const ACTIONS: CommandPaletteAction[] = [
	"settings",
	"rename",
	"newProjectSession",
	"saveScratchpad",
	"openScratchpad",
	"startScratchpad",
	"detach",
	"archive",
	"restore",
	"moveToCloud",
	"pullFromCloud",
	"jumpExternal",
	"previewExternal",
]

const isCommandPaletteAction = (value: string): value is CommandPaletteAction =>
	(ACTIONS as string[]).includes(value)

export const commandActionValue = (action: CommandPaletteAction): string => `${ACTION_PREFIX}${action}`
export const commandSessionValue = (sessionLaneId: string): string => `${SESSION_PREFIX}${sessionLaneId}`
export const commandProjectValue = (cwd: string): string => `${PROJECT_PREFIX}${cwd}`
export const commandScratchpadValue = (id: string): string => `${SCRATCHPAD_PREFIX}${id}`

export const parseCommandPaletteValue = (value: string): CommandPaletteSelection | null => {
	if (value.startsWith(ACTION_PREFIX)) {
		const action = value.slice(ACTION_PREFIX.length)
		if (isCommandPaletteAction(action)) {
			return { type: "action", action }
		}
		return null
	}
	if (value.startsWith(SESSION_PREFIX)) {
		const sessionLaneId = value.slice(SESSION_PREFIX.length)
		return sessionLaneId.length > 0 ? { type: "session", sessionLaneId } : null
	}
	if (value.startsWith(PROJECT_PREFIX)) {
		const cwd = value.slice(PROJECT_PREFIX.length)
		return cwd.length > 0 ? { type: "project", cwd } : null
	}
	if (value.startsWith(SCRATCHPAD_PREFIX)) {
		const id = value.slice(SCRATCHPAD_PREFIX.length)
		return id.length > 0 ? { type: "scratchpad", id } : null
	}
	return null
}

const projectTitleFor = (lanes: WorkspaceLanesV2, projectId: string): string =>
	lanes.projectsById[projectId]?.title ?? projectId

export const commandPaletteSessionOption = (lanes: WorkspaceLanesV2, session: SessionLaneV2): SearchSelectOption => {
	const projectTitle = projectTitleFor(lanes, session.projectId)
	const shortId = (session.sessionId ?? session.laneId).slice(0, 8)
	const model = `${session.provider}/${session.modelId}`
	return {
		value: commandSessionValue(session.laneId),
		label: `${projectTitle} / ${session.title || shortId}`,
		description: `${shortId} | ${model}`,
		keywords: `${projectTitle} ${session.title} ${session.sessionId} ${session.sessionPath} ${model} switch session jump lane project`,
	}
}

export const commandPaletteProjectOption = (project: WorkspaceProject): SearchSelectOption => ({
	value: commandProjectValue(project.cwd),
	label: `Project / ${project.title}`,
	description: project.cwd,
	keywords: `${project.title} ${project.cwd} ${project.root} open project workspace folder`,
})

export const commandPaletteScratchpadOption = (item: ScratchpadItem): SearchSelectOption => ({
	value: commandScratchpadValue(item.id),
	label: `Scratch / ${item.title}`,
	description: item.bodyPreview || item.cwd,
	keywords: `${item.title} ${item.cwd} ${item.bodyPreview} ${item.tags.join(" ")} scratch scratchpad note open start`,
})

export const createCommandPaletteOptions = (
	lanes: WorkspaceLanesV2,
	projects: WorkspaceProject[] = [],
	scratchpads: ScratchpadItem[] = [],
): SearchSelectOption[] => {
	const archivedCount = Object.values(lanes.sessionsById).filter((session) => session.archivedAt !== undefined).length
	const activeSessions = lanes.projectOrder.flatMap((projectId) => activeSessionsForProject(lanes, projectId))
	const currentLaneId = lanes.selection?.laneId
	const externalSelected = currentLaneId ? isExternalLaneId(currentLaneId) : false
	const currentLane = currentLaneId ? lanes.sessionsById[currentLaneId] : undefined
	const cloudSelected = currentLane?.location?.kind === "cloud"
	return [
		{
			value: commandActionValue("settings"),
			label: "Settings",
			description: "Open Marvin config",
			keywords: "config preferences keymap keys lanes command palette",
		},
		{
			value: commandActionValue("rename"),
			label: "Rename session",
			description: "Change current session title",
			keywords: "title label name current session lane",
		},
		{
			value: commandActionValue("newProjectSession"),
			label: "New session in project",
			description: "Pick a configured project",
			keywords: "start new session project workspace folder",
		},
		{
			value: commandActionValue("saveScratchpad"),
			label: "Save input to scratchpad",
			description: "Store the input box text",
			keywords: "scratch scratchpad note save input prompt later",
		},
		{
			value: commandActionValue("openScratchpad"),
			label: "Open scratchpad",
			description: "Capture a note",
			keywords: "scratch scratchpad note capture open",
		},
		{
			value: commandActionValue("startScratchpad"),
			label: "Start scratchpad",
			description: scratchpads.length === 0 ? "No scratchpads" : "Open in a fresh session",
			keywords: "scratch scratchpad note start new session project",
		},
		{
			value: commandActionValue("detach"),
			label: "Detach",
			description: "Close this TUI and return to shell",
			keywords: "exit quit close ctrl c leave tui",
		},
		{
			value: commandActionValue("archive"),
			label: "Archive session",
			description: "Remove current session from active lanes",
			keywords: "hide remove active pane lane current session",
		},
		{
			value: commandActionValue("restore"),
			label: "Restore archived session",
			description: archivedCount === 0 ? "No archived sessions" : `${archivedCount} archived`,
			keywords: "unarchive archived session restore recover",
		},
		...(currentLane && !externalSelected ? [
			cloudSelected
				? {
					value: commandActionValue("pullFromCloud"),
					label: "Pull back",
					description: currentLane.location?.kind === "cloud" ? currentLane.location.beamId : "Beam cloud",
					keywords: "beam cloud pull back local session lane",
				}
				: {
					value: commandActionValue("moveToCloud"),
					label: "Move to cloud",
					description: "Beam cloud",
					keywords: "beam cloud move push phone session lane",
				},
		] satisfies SearchSelectOption[] : []),
		...(externalSelected ? [
			{
				value: commandActionValue("jumpExternal"),
				label: "Jump to external agent",
				description: "Focus reported tmux pane",
				keywords: "external cockpit tmux jump agent pane",
			},
			{
				value: commandActionValue("previewExternal"),
				label: "Preview external transcript",
				description: "Open read-only transcript tail",
				keywords: "external cockpit transcript preview jsonl tail",
			},
		] satisfies SearchSelectOption[] : []),
		...activeSessions.map((session) => commandPaletteSessionOption(lanes, session)),
		...scratchpads.map(commandPaletteScratchpadOption),
		...projects.map(commandPaletteProjectOption),
	]
}

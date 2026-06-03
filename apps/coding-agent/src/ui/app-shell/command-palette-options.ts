import type { SearchSelectOption } from "../components/modals/search-select-options.js"
import {
	activeSessionLanes,
	type ProjectSessionLane,
	type WorkspaceLanes,
} from "@yeshwanthyk/runtime-effect/workspace-lanes.js"
import type { WorkspaceProject } from "@yeshwanthyk/runtime-effect/workspace-projects.js"
import type { ScratchpadItem } from "@yeshwanthyk/runtime-effect/scratchpads.js"

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

const projectTitleFor = (lanes: WorkspaceLanes, projectId: string): string =>
	lanes.projects.find((project) => project.id === projectId)?.title ?? projectId

export const commandPaletteSessionOption = (lanes: WorkspaceLanes, session: ProjectSessionLane): SearchSelectOption => {
	const projectTitle = projectTitleFor(lanes, session.projectId)
	const shortId = session.sessionId.slice(0, 8)
	const model = `${session.provider}/${session.modelId}`
	return {
		value: commandSessionValue(session.id),
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
	lanes: WorkspaceLanes,
	projects: WorkspaceProject[] = [],
	scratchpads: ScratchpadItem[] = [],
): SearchSelectOption[] => {
	const archivedCount = lanes.sessions.filter((session) => session.archivedAt !== undefined).length
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
		...activeSessionLanes(lanes).map((session) => commandPaletteSessionOption(lanes, session)),
		...scratchpads.map(commandPaletteScratchpadOption),
		...projects.map(commandPaletteProjectOption),
	]
}

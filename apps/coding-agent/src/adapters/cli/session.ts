import { homedir } from "node:os"
import { join } from "node:path"
import {
	activeSessionsForProject,
	findActiveCursor,
	readWorkspaceLanes,
	renameSessionLane,
	selectLane,
	writeWorkspaceLanes,
	type LaneCursor,
	type ProjectSessionLane,
	type WorkspaceLanes,
} from "@yeshwanthyk/runtime-effect/workspace-lanes.js"

export interface SessionCommandArgs {
	action?: "rename"
	title?: string
	session?: string
	configDir?: string
	cwd?: string
	stdout?: (text: string) => void
	stderr?: (text: string) => void
}

const defaultConfigDir = () => join(homedir(), ".config", "marvin")

export const normalizeAgentSessionTitle = (raw: string): string => {
	const title = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
	if (!title) throw new Error('Missing title. Usage: marvin session rename "fix lane navigation"')
	if (title.length > 64) throw new Error("Session title must be 64 characters or fewer")
	const wordCount = title.split(/\s+/).filter(Boolean).length
	if (wordCount < 3 || wordCount > 4) {
		throw new Error(`Session title must be 3-4 words; got ${wordCount}`)
	}
	return title
}

const sessionMatches = (session: ProjectSessionLane, identifier: string): boolean =>
	session.id === identifier ||
	session.sessionId === identifier ||
	session.sessionId.startsWith(identifier) ||
	session.sessionPath === identifier

const resolveExplicitSession = (lanes: WorkspaceLanes, identifier: string): LaneCursor | null => {
	const session = lanes.sessions.find((entry) => sessionMatches(entry, identifier))
	const project = session ? lanes.projects.find((entry) => entry.id === session.projectId) : undefined
	return session && project ? { project, session } : null
}

const resolveCurrentSession = (lanes: WorkspaceLanes, cwd: string): LaneCursor | null => {
	const current = findActiveCursor(lanes)
	if (current) return current

	const project = lanes.projects.find((entry) => entry.cwd === cwd && entry.archivedAt === undefined)
	const session = project ? activeSessionsForProject(lanes, project.id)[0] : undefined
	return project && session ? { project, session } : null
}

const usage = [
	'Usage: marvin session rename "3-4 word title"',
	"",
	"Examples:",
	'  marvin session rename "fix lane navigation"',
	'  marvin session rename "review org migration" --session b17f0285',
].join("\n")

export const runSessionCommand = async (args: SessionCommandArgs): Promise<void> => {
	const stdout = args.stdout ?? ((text: string) => process.stdout.write(text))
	const stderr = args.stderr ?? ((text: string) => process.stderr.write(text))

	if (args.action !== "rename") {
		stderr(`${usage}\n`)
		process.exitCode = 1
		return
	}

	let title: string
	try {
		title = normalizeAgentSessionTitle(args.title ?? "")
	} catch (error) {
		stderr(`${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`)
		process.exitCode = 1
		return
	}

	const configDir = args.configDir ?? defaultConfigDir()
	const lanes = readWorkspaceLanes(configDir)
	const cursor = args.session
		? resolveExplicitSession(lanes, args.session)
		: resolveCurrentSession(lanes, args.cwd ?? process.cwd())

	if (!cursor) {
		stderr("No session lane found to rename. Start Marvin once or pass --session <id>.\n")
		process.exitCode = 1
		return
	}

	const renamed = renameSessionLane(lanes, cursor.session.id, title)
	writeWorkspaceLanes(configDir, selectLane(renamed, { project: cursor.project, session: { ...cursor.session, title } }))
	stdout(`Renamed session: ${title}\n`)
}

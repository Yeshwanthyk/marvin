import type { SessionActorStatus } from "../../runtime/session-actor.js"
import type { SessionActor } from "../../runtime/session-actor.js"
import type {
	LaneCursorV2,
	WorkspaceLaneStore,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"

export const canMoveFocusedSessionAcrossProject = (
	status: SessionActorStatus | undefined,
	isResponding: boolean,
): boolean => status !== "streaming" && !isResponding

export interface BeamCommandResult {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

export interface BeamCommandRunner {
	(args: readonly string[], cwd: string): Promise<BeamCommandResult>
}

export interface BeamJsonResponse {
	readonly beamId?: string
	readonly id?: string
	readonly url?: string
	readonly phoneUrl?: string
	readonly qr?: string
}

export type LaneCloudActionResult =
	| { readonly ok: true; readonly beamId: string; readonly url?: string; readonly qr?: string }
	| { readonly ok: false; readonly reason: string }

export const runBeamCommand: BeamCommandRunner = async (args, cwd) => {
	const proc = Bun.spawn(["beam", ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" })
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])
	return { exitCode, stdout, stderr }
}

const parseBeamJson = (result: BeamCommandResult): BeamJsonResponse | null => {
	if (result.exitCode !== 0) return null
	try {
		const parsed: unknown = JSON.parse(result.stdout)
		if (typeof parsed !== "object" || parsed === null) return null
		return parsed as BeamJsonResponse
	} catch {
		return null
	}
}

const commandFailure = (result: BeamCommandResult): string =>
	result.stderr.trim() || result.stdout.trim() || `beam exited ${result.exitCode}`

const suspendForCloudMove = async (actor: SessionActor | null): Promise<boolean> => {
	if (!actor) return true
	await actor.suspend()
	return actor.services() === null
}

export const moveLaneToCloud = async (
	input: {
		readonly cursor: LaneCursorV2
		readonly laneStore: WorkspaceLaneStore
		readonly actor: SessionActor | null
		readonly isResponding: boolean
		readonly runBeam?: BeamCommandRunner
		readonly now?: () => number
	},
): Promise<LaneCloudActionResult> => {
	const { cursor, laneStore, actor, isResponding } = input
	if (cursor.session.location?.kind === "cloud") {
		return { ok: false, reason: `Already in Beam cloud ${cursor.session.location.beamId}` }
	}
	if (!cursor.session.sessionId || !cursor.session.sessionPath) {
		return { ok: false, reason: "Lane has no local session JSONL yet" }
	}
	if (!canMoveFocusedSessionAcrossProject(actor?.status(), isResponding)) {
		return { ok: false, reason: "Session is still running" }
	}
	if (!(await suspendForCloudMove(actor))) {
		return { ok: false, reason: "Session has pending work and cannot be suspended" }
	}

	const runBeam = input.runBeam ?? runBeamCommand
	const result = await runBeam(["push", `marvin:${cursor.session.sessionId}`, "--json"], cursor.project.cwd)
	const parsed = parseBeamJson(result)
	const beamId = parsed?.beamId ?? parsed?.id
	if (!parsed || !beamId) {
		laneStore.dispatch({ type: "setSessionLocation", laneId: cursor.session.laneId })
		return { ok: false, reason: commandFailure(result) }
	}
	laneStore.dispatch({
		type: "setSessionLocation",
		laneId: cursor.session.laneId,
		location: { kind: "cloud", beamId, movedAt: input.now?.() ?? Date.now() },
	})
	return { ok: true, beamId, ...(parsed.phoneUrl ?? parsed.url ? { url: parsed.phoneUrl ?? parsed.url } : {}), ...(parsed.qr ? { qr: parsed.qr } : {}) }
}

export const pullLaneBackFromCloud = async (
	input: {
		readonly cursor: LaneCursorV2
		readonly laneStore: WorkspaceLaneStore
		readonly runBeam?: BeamCommandRunner
	},
): Promise<LaneCloudActionResult> => {
	const location = input.cursor.session.location
	if (location?.kind !== "cloud") return { ok: false, reason: "Lane is already local" }
	const runBeam = input.runBeam ?? runBeamCommand
	const result = await runBeam(["pull", location.beamId, "--json"], input.cursor.project.cwd)
	const parsed = parseBeamJson(result)
	if (!parsed) return { ok: false, reason: commandFailure(result) }
	input.laneStore.dispatch({ type: "setSessionLocation", laneId: input.cursor.session.laneId })
	return { ok: true, beamId: location.beamId, ...(parsed.phoneUrl ?? parsed.url ? { url: parsed.phoneUrl ?? parsed.url } : {}), ...(parsed.qr ? { qr: parsed.qr } : {}) }
}

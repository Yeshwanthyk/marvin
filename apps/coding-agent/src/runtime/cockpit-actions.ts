import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import type { CockpitSessionMeta } from "./cockpit-ingest.js"

export interface CockpitActionOk<T> {
	readonly ok: true
	readonly value: T
}

export interface CockpitActionErr {
	readonly ok: false
	readonly reason: string
}

export type CockpitActionResult<T> = CockpitActionOk<T> | CockpitActionErr

export const isExternalLaneId = (laneId: string): boolean => laneId.startsWith("external:")

export const cockpitJumpCommand = (meta: CockpitSessionMeta | undefined): CockpitActionResult<readonly string[]> => {
	if (!meta) return { ok: false, reason: "No cockpit metadata for lane" }
	if (!meta.tmuxPane) return { ok: false, reason: "External agent did not report a tmux pane" }
	return { ok: true, value: ["tmux", "select-pane", "-t", meta.tmuxPane] }
}

const textFromJsonLine = (line: string): string | null => {
	const trimmed = line.trim()
	if (!trimmed) return null
	try {
		const parsed: unknown = JSON.parse(trimmed)
		if (typeof parsed === "string") return parsed
		if (typeof parsed !== "object" || parsed === null) return null
		const record = parsed as Record<string, unknown>
		for (const key of ["text", "message", "content", "lastMessage", "last_message"]) {
			const value = record[key]
			if (typeof value === "string" && value.trim()) return value
		}
		return trimmed
	} catch {
		return trimmed
	}
}

export const cockpitTranscriptPreview = (
	meta: CockpitSessionMeta | undefined,
	options: { readonly maxBytes?: number; readonly maxLines?: number } = {},
): CockpitActionResult<string> => {
	if (!meta?.transcriptPath) return { ok: false, reason: "External agent did not report a transcript path" }
	if (!existsSync(meta.transcriptPath)) return { ok: false, reason: "Transcript file does not exist" }
	const maxBytes = options.maxBytes ?? 64 * 1024
	const maxLines = options.maxLines ?? 80
	const raw = readFileSync(meta.transcriptPath)
	const tail = raw.subarray(Math.max(0, raw.byteLength - maxBytes)).toString("utf8")
	const lines = tail.split("\n").map(textFromJsonLine).filter((line): line is string => line !== null)
	const body = lines.slice(-maxLines).join("\n")
	return { ok: true, value: body || "(empty transcript)" }
}

export const buildPiRenameRpcPayload = (meta: CockpitSessionMeta, title: string): Record<string, unknown> => ({
	jsonrpc: "2.0",
	method: "session.rename",
	params: {
		sessionId: meta.sessionId,
		title,
	},
})

export const writePiRenameRpc = (
	configDir: string,
	meta: CockpitSessionMeta,
	title: string,
): CockpitActionResult<string> => {
	if (meta.cli !== "pi") return { ok: false, reason: "Not a Pi cockpit lane" }
	const path = process.env.MARVIN_PI_RPC_OUT ?? join(configDir, "cockpit", "pi-rpc.jsonl")
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(buildPiRenameRpcPayload(meta, title))}\n`, { flag: "a" })
	return { ok: true, value: path }
}

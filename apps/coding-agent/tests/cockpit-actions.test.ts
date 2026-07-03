import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	buildPiRenameRpcPayload,
	cockpitJumpCommand,
	cockpitTranscriptPreview,
	writePiRenameRpc,
} from "../src/runtime/cockpit-actions.js"
import type { CockpitSessionMeta } from "../src/runtime/cockpit-ingest.js"

const meta = (overrides: Partial<CockpitSessionMeta> = {}): CockpitSessionMeta => ({
	laneId: "external:pi:session-a",
	cli: "pi",
	sessionId: "session-a",
	cwd: "/work/nora",
	lastEventAt: "2026-07-03T12:00:00.000Z",
	...overrides,
})

describe("cockpit actions", () => {
	it("builds tmux jump commands only when a pane was reported", () => {
		expect(cockpitJumpCommand(meta({ tmuxPane: "%12" }))).toEqual({
			ok: true,
			value: ["tmux", "select-pane", "-t", "%12"],
		})
		expect(cockpitJumpCommand(meta())).toEqual({
			ok: false,
			reason: "External agent did not report a tmux pane",
		})
	})

	it("previews transcript tails from jsonl and plain text lines", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "cockpit-preview-"))
		try {
			const transcriptPath = path.join(dir, "session.jsonl")
			await writeFile(transcriptPath, `${JSON.stringify({ message: "hello" })}\nplain line\n${JSON.stringify({ text: "last" })}\n`, "utf8")

			expect(cockpitTranscriptPreview(meta({ transcriptPath }), { maxLines: 2 })).toEqual({
				ok: true,
				value: "plain line\nlast",
			})
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("builds and writes Pi rename RPC payloads", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "cockpit-rpc-"))
		try {
			expect(buildPiRenameRpcPayload(meta(), "new title")).toEqual({
				jsonrpc: "2.0",
				method: "session.rename",
				params: {
					sessionId: "session-a",
					title: "new title",
				},
			})

			const written = writePiRenameRpc(dir, meta(), "new title")
			expect(written).toEqual({ ok: true, value: path.join(dir, "cockpit", "pi-rpc.jsonl") })
			expect(await readFile(path.join(dir, "cockpit", "pi-rpc.jsonl"), "utf8")).toBe(`${JSON.stringify(buildPiRenameRpcPayload(meta(), "new title"))}\n`)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})

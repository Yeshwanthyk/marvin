import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	readWorkspaceLanes,
	selectLane,
	upsertProjectLane,
	upsertSessionLane,
	writeWorkspaceLanes,
	type SessionInfo,
} from "@yeshwanthyk/runtime-effect"
import { normalizeAgentSessionTitle, runSessionCommand } from "../src/adapters/cli/session.js"

const sessionInfo = (id: string, cwd: string, timestamp: number): SessionInfo => ({
	id,
	timestamp,
	path: path.join(cwd, `${id}.jsonl`),
	provider: "codex",
	modelId: "gpt-test",
	cwd,
})

describe("session CLI", () => {
	it("normalizes agent session titles and enforces 3-4 words", () => {
		expect(normalizeAgentSessionTitle("  fix   lane   navigation  ")).toBe("fix lane navigation")
		expect(() => normalizeAgentSessionTitle("too short")).toThrow("3-4 words")
		expect(() => normalizeAgentSessionTitle("one two three four five")).toThrow("3-4 words")
	})

	it("renames the selected lane session", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "marvin-session-cli-"))
		const cwd = "/work/nora"
		const output: string[] = []
		try {
			const lanes = readWorkspaceLanes(dir)
			const project = upsertProjectLane(lanes, cwd, "2026-06-03T00:00:00.000Z")
			const session = upsertSessionLane(lanes, project, sessionInfo("aaaaaaaa-0000-0000-0000-000000000000", cwd, 1), "old title")
			writeWorkspaceLanes(dir, selectLane(lanes, { project, session }))

			process.exitCode = undefined
			await runSessionCommand({
				action: "rename",
				title: "fix lane navigation",
				configDir: dir,
				cwd,
				stdout: (text) => output.push(text),
				stderr: (text) => output.push(text),
			})

			const loaded = readWorkspaceLanes(dir)
			expect(process.exitCode).toBeUndefined()
			expect(output.join("")).toContain("Renamed session: fix lane navigation")
			expect(loaded.sessions.find((entry) => entry.id === session.id)?.title).toBe("fix lane navigation")
		} finally {
			process.exitCode = undefined
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("renames an explicit session id prefix", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "marvin-session-cli-"))
		const cwd = "/work/nora"
		try {
			const lanes = readWorkspaceLanes(dir)
			const project = upsertProjectLane(lanes, cwd, "2026-06-03T00:00:00.000Z")
			const first = upsertSessionLane(lanes, project, sessionInfo("aaaaaaaa-0000-0000-0000-000000000000", cwd, 1), "first")
			const second = upsertSessionLane(lanes, project, sessionInfo("bbbbbbbb-0000-0000-0000-000000000000", cwd, 2), "second")
			writeWorkspaceLanes(dir, selectLane(lanes, { project, session: first }))

			process.exitCode = undefined
			await runSessionCommand({
				action: "rename",
				title: "review org migration",
				session: "bbbbbbbb",
				configDir: dir,
				cwd,
				stdout: () => {},
				stderr: () => {},
			})

			const loaded = readWorkspaceLanes(dir)
			expect(process.exitCode).toBeUndefined()
			expect(loaded.sessions.find((entry) => entry.id === second.id)?.title).toBe("review org migration")
			expect(loaded.selection?.sessionLaneId).toBe(second.id)
		} finally {
			process.exitCode = undefined
			await rm(dir, { recursive: true, force: true })
		}
	})
})

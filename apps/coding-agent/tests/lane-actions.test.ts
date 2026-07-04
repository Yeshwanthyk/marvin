import { describe, expect, it } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	createWorkspaceLaneStore,
	type LaneCursorV2,
	type WorkspaceLaneStore,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { moveLaneToCloud, pullLaneBackFromCloud } from "../src/ui/app-shell/lane-actions.js"

const now = "2026-06-03T12:00:00.000Z"

const seedStore = (dir: string, cloud = false): { store: WorkspaceLaneStore; cursor: LaneCursorV2 } => {
	const store = createWorkspaceLaneStore(dir, undefined, { immediate: true })
	store.transact([
		{
			type: "upsertProject",
			project: { id: dir, cwd: dir, title: "marvin", createdAt: now, updatedAt: now },
		},
		{
			type: "upsertSession",
			session: {
				laneId: "lane-a",
				projectId: dir,
				sessionId: "session-a",
				sessionPath: "/sessions/session-a.jsonl",
				title: "beam task",
				provider: "codex",
				modelId: "gpt-5",
				...(cloud ? { location: { kind: "cloud" as const, beamId: "beam-123", movedAt: 123 } } : {}),
				createdAt: now,
				updatedAt: now,
			},
		},
		{ type: "select", projectId: dir, laneId: "lane-a" },
	])
	const lanes = store.lanes()
	const project = lanes.projectsById[dir]
	const session = lanes.sessionsById["lane-a"]
	if (!project || !session) throw new Error("fixture failed")
	return { store, cursor: { project, session, projectIndex: 0, sessionIndex: 0 } }
}

const withMockBeam = async (
	body: string,
	run: (argvPath: string) => Promise<void>,
): Promise<void> => {
	const dir = await mkdtemp(path.join(tmpdir(), "marvin-beam-"))
	const oldPath = process.env.PATH
	try {
		const bin = path.join(dir, "beam")
		const argvPath = path.join(dir, "argv.txt")
		await writeFile(bin, body, "utf8")
		await chmod(bin, 0o755)
		process.env.PATH = `${dir}${path.delimiter}${oldPath ?? ""}`
		process.env.BEAM_ARGV_FILE = argvPath
		await run(argvPath)
	} finally {
		if (oldPath === undefined) delete process.env.PATH
		else process.env.PATH = oldPath
		delete process.env.BEAM_ARGV_FILE
		await rm(dir, { recursive: true, force: true })
	}
}

describe("lane cloud actions", () => {
	it("moves a local lane to cloud via beam push argv and marks it cloud", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "marvin-lanes-"))
		try {
			const { store, cursor } = seedStore(dir)
			await withMockBeam(`#!/bin/sh
printf '%s\\n' "$@" > "$BEAM_ARGV_FILE"
echo '{"beamId":"beam-123","phoneUrl":"https://beam.example/phone"}'
`, async (argvPath) => {
				const result = await moveLaneToCloud({ cursor, laneStore: store, actor: null, isResponding: false, now: () => 456 })
				expect(result).toEqual({ ok: true, beamId: "beam-123", url: "https://beam.example/phone" })
				expect((await Bun.file(argvPath).text()).trim().split("\n")).toEqual(["push", "marvin:session-a", "--json"])
				expect(store.lanes().sessionsById["lane-a"]?.location).toEqual({ kind: "cloud", beamId: "beam-123", movedAt: 456 })
			})
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("leaves a failed push local", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "marvin-lanes-"))
		try {
			const { store, cursor } = seedStore(dir)
			await withMockBeam(`#!/bin/sh
printf '%s\\n' "$@" > "$BEAM_ARGV_FILE"
echo nope >&2
exit 2
`, async () => {
				const result = await moveLaneToCloud({ cursor, laneStore: store, actor: null, isResponding: false })
				expect(result).toEqual({ ok: false, reason: "nope" })
				expect(store.lanes().sessionsById["lane-a"]?.location).toBeUndefined()
			})
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("pulls a cloud lane back via beam pull argv and clears the marker", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "marvin-lanes-"))
		try {
			const { store, cursor } = seedStore(dir, true)
			await withMockBeam(`#!/bin/sh
printf '%s\\n' "$@" > "$BEAM_ARGV_FILE"
echo '{"beamId":"beam-123"}'
`, async (argvPath) => {
				const result = await pullLaneBackFromCloud({ cursor, laneStore: store })
				expect(result).toEqual({ ok: true, beamId: "beam-123" })
				expect((await Bun.file(argvPath).text()).trim().split("\n")).toEqual(["pull", "beam-123", "--json"])
				expect(store.lanes().sessionsById["lane-a"]?.location).toBeUndefined()
			})
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("keeps the cloud marker when beam pull fails", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "marvin-lanes-"))
		try {
			const { store, cursor } = seedStore(dir, true)
			await withMockBeam(`#!/bin/sh
echo failed >&2
exit 3
`, async () => {
				const result = await pullLaneBackFromCloud({ cursor, laneStore: store })
				expect(result).toEqual({ ok: false, reason: "failed" })
				expect(store.lanes().sessionsById["lane-a"]?.location).toEqual({ kind: "cloud", beamId: "beam-123", movedAt: 123 })
			})
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})

import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { SessionInfo } from "../src/session-manager.js"
import {
	createWorkspaceLaneStore,
	emptyWorkspaceLanesV2,
	loadWorkspaceLanesV2,
	type LaneId,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { createSessionLaneSyncPatches } from "../src/ui/app-shell/useSessionLaneController.js"

const sessionInfo = (id: string, cwd: string): SessionInfo => ({
	id,
	timestamp: Date.parse("2026-06-03T12:00:00.000Z"),
	path: `/sessions/${id}.jsonl`,
	provider: "codex",
	modelId: "gpt-5.3-codex",
	cwd,
})

describe("session lane controller v2 patches", () => {
	it("keeps interleaved controller dispatches through one store from losing updates", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "session-lane-controller-"))
		try {
			const store = createWorkspaceLaneStore(dir, undefined, { delayMs: 60_000 })
			const staleControllerLanes = store.lanes()
			const firstPatches = createSessionLaneSyncPatches({
				lanes: staleControllerLanes,
				cwd: "/work/nora",
				session: sessionInfo("session-a", "/work/nora"),
				title: "first",
				laneId: "lane-a",
				select: true,
			})
			const secondPatches = createSessionLaneSyncPatches({
				lanes: staleControllerLanes,
				cwd: "/work/marvin",
				session: sessionInfo("session-b", "/work/marvin"),
				title: "second",
				laneId: "lane-b",
				select: true,
			})

			store.transact(firstPatches)
			store.transact(secondPatches)
			await store.flush()

			const loaded = loadWorkspaceLanesV2(dir).lanes
			expect(loaded.projectOrder).toEqual(["/work/nora", "/work/marvin"])
			expect(Object.keys(loaded.sessionsById).sort()).toEqual(["lane-a", "lane-b"])
			expect(loaded.sessionsById["lane-a"]?.title).toBe("first")
			expect(loaded.sessionsById["lane-b"]?.title).toBe("second")
			expect(loaded.selection).toEqual({ projectId: "/work/marvin", laneId: "lane-b" })
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("builds session-start sync as project/session upserts plus optional select", () => {
		const laneId: LaneId = "lane-a"
		const patches = createSessionLaneSyncPatches({
			lanes: emptyWorkspaceLanesV2(),
			cwd: "/work/nora",
			session: sessionInfo("session-a", "/work/nora"),
			title: "bootstrap",
			laneId,
			select: true,
		})

		expect(patches).toHaveLength(3)
		expect(patches[0]?.type).toBe("upsertProject")
		expect(patches[1]?.type).toBe("upsertSession")
		expect(patches[2]).toEqual({ type: "select", projectId: "/work/nora", laneId })
		if (patches[0]?.type === "upsertProject") {
			expect(patches[0].project.id).toBe("/work/nora")
			expect(patches[0].project.title).toBe("nora")
		}
		if (patches[1]?.type === "upsertSession") {
			expect(patches[1].session).toMatchObject({
				laneId,
				projectId: "/work/nora",
				sessionId: "session-a",
				sessionPath: "/sessions/session-a.jsonl",
				title: "bootstrap",
				provider: "codex",
				modelId: "gpt-5.3-codex",
			})
		}
	})
})

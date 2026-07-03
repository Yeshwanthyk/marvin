import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	createSessionLaneInput,
	createWorkspaceLaneStore,
	type WorkspaceLaneStore,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import {
	applyTuiActivityTransition,
	createActivityIndex,
	createNotificationService,
	resolveActivityLaneId,
} from "../src/ui/app-shell/activity-index.js"

const withLaneStore = async (run: (store: WorkspaceLaneStore) => void | Promise<void>) => {
	const dir = await mkdtemp(path.join(tmpdir(), "activity-index-"))
	try {
		const store = createWorkspaceLaneStore(dir, undefined, { delayMs: 60_000 })
		const now = "2026-07-03T12:00:00.000Z"
		store.transact([
			{
				type: "upsertProject",
				project: {
					id: "/work/marvin",
					cwd: "/work/marvin",
					title: "marvin",
					createdAt: now,
					updatedAt: now,
				},
			},
			{
				type: "upsertSession",
				session: createSessionLaneInput({
					laneId: "lane-a",
					projectId: "/work/marvin",
					sessionId: "session-a",
					sessionPath: "/sessions/session-a.jsonl",
					title: "hidden task",
					provider: "codex",
					modelId: "gpt-5.3-codex",
					createdAt: now,
					updatedAt: now,
				}),
			},
		])
		await run(store)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

describe("activity index and host notifications", () => {
	it("resolves lane id from the lane store by session id or path", async () => {
		await withLaneStore((store) => {
			expect(resolveActivityLaneId(store.lanes(), {
				projectId: "/work/marvin",
				sessionId: "session-a",
				sessionPath: null,
			})).toBe("lane-a")
			expect(resolveActivityLaneId(store.lanes(), {
				projectId: "/work/marvin",
				sessionId: null,
				sessionPath: "/sessions/session-a.jsonl",
			})).toBe("lane-a")
		})
	})

	it("enqueues one attributed notification for hidden responding to idle", async () => {
		await withLaneStore((store) => {
			const activityIndex = createActivityIndex()
			const notifications = createNotificationService()
			const laneId = applyTuiActivityTransition({
				activity: {
					isResponding: false,
					sessionId: "session-a",
					sessionPath: "/sessions/session-a.jsonl",
					sessionTitle: "hidden task",
					lastError: null,
					tokenCount: 42,
					lastObservedAt: 1000,
				},
				projectId: "/work/marvin",
				laneStore: store,
				activityIndex,
				notifications,
				wasResponding: true,
				isFocused: false,
				now: 1000,
			})

			expect(laneId).toBe("lane-a")
			expect(notifications.list()).toHaveLength(1)
			expect(notifications.list()[0]).toMatchObject({
				laneId: "lane-a",
				projectId: "/work/marvin",
				level: "success",
				title: "Session complete",
				message: "marvin / hidden task",
			})
			expect(activityIndex.get("lane-a")).toMatchObject({
				status: "completed",
				isResponding: false,
				unread: true,
				lastCompletedAt: 1000,
				tokenCount: 42,
			})

			applyTuiActivityTransition({
				activity: {
					isResponding: false,
					sessionId: "session-a",
					sessionPath: "/sessions/session-a.jsonl",
					sessionTitle: "hidden task",
					lastError: null,
					tokenCount: 42,
					lastObservedAt: 1001,
				},
				projectId: "/work/marvin",
				laneStore: store,
				activityIndex,
				notifications,
				wasResponding: false,
				isFocused: false,
				now: 1001,
			})
			expect(notifications.list()).toHaveLength(1)
		})
	})

	it("does not notify for focused completion", async () => {
		await withLaneStore((store) => {
			const activityIndex = createActivityIndex()
			const notifications = createNotificationService()
			applyTuiActivityTransition({
				activity: {
					isResponding: false,
					sessionId: "session-a",
					sessionPath: "/sessions/session-a.jsonl",
					lastError: null,
					tokenCount: 5,
					lastObservedAt: 2000,
				},
				projectId: "/work/marvin",
				laneStore: store,
				activityIndex,
				notifications,
				wasResponding: true,
				isFocused: true,
				now: 2000,
			})

			expect(notifications.list()).toHaveLength(0)
			expect(activityIndex.get("lane-a")).toMatchObject({
				status: "completed",
				unread: false,
			})
		})
	})

	it("clears unread when the lane is focused", async () => {
		await withLaneStore((store) => {
			const activityIndex = createActivityIndex()
			const notifications = createNotificationService()
			applyTuiActivityTransition({
				activity: {
					isResponding: false,
					sessionId: "session-a",
					sessionPath: "/sessions/session-a.jsonl",
					lastError: "provider exploded",
					tokenCount: 5,
					lastObservedAt: 3000,
				},
				projectId: "/work/marvin",
				laneStore: store,
				activityIndex,
				notifications,
				wasResponding: true,
				isFocused: false,
				now: 3000,
			})
			expect(activityIndex.get("lane-a")?.unread).toBe(true)
			expect(notifications.list()[0]).toMatchObject({
				level: "error",
				title: "Session failed",
			})

			activityIndex.patch("lane-a", { unread: false })
			expect(activityIndex.get("lane-a")?.unread).toBe(false)
		})
	})
})

import { describe, expect, it } from "bun:test"
import type { WorkspaceLanesV2 } from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { deriveLaneHeaderState, laneHeaderDisplay } from "../src/ui/app-shell/lane-header-state.js"

const lanesFixture = (): WorkspaceLanesV2 => ({
	version: 2,
	projectsById: {
		"/work/kiri": {
			id: "/work/kiri",
			cwd: "/work/kiri",
			title: "kiri",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:00:00.000Z",
		},
		"/work/nora": {
			id: "/work/nora",
			cwd: "/work/nora",
			title: "nora",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:00:00.000Z",
		},
		"/work/marvin": {
			id: "/work/marvin",
			cwd: "/work/marvin",
			title: "marvin",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:00:00.000Z",
		},
	},
	projectOrder: ["/work/kiri", "/work/nora", "/work/marvin"],
	sessionsById: {
		"kiri-1": {
			laneId: "kiri-1",
			projectId: "/work/kiri",
			sessionId: "dddddddd-0000-0000-0000-000000000000",
			sessionPath: "/sessions/kiri.jsonl",
			title: "kiri work",
			provider: "codex",
			modelId: "gpt-5.3-codex",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:02:00.000Z",
		},
		"lane-b": {
			laneId: "lane-b",
			projectId: "/work/nora",
			sessionId: "bbbbbbbb-0000-0000-0000-000000000000",
			sessionPath: "/sessions/b.jsonl",
			title: "second task",
			provider: "codex",
			modelId: "gpt-5.3-codex",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:02:00.000Z",
		},
		"lane-a": {
			laneId: "lane-a",
			projectId: "/work/nora",
			sessionId: "aaaaaaaa-0000-0000-0000-000000000000",
			sessionPath: "/sessions/a.jsonl",
			title: "first task",
			provider: "codex",
			modelId: "gpt-5.3-codex",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:01:00.000Z",
		},
		"lane-c": {
			laneId: "lane-c",
			projectId: "/work/nora",
			sessionId: "cccccccc-0000-0000-0000-000000000000",
			sessionPath: "/sessions/c.jsonl",
			title: "archived task",
			provider: "codex",
			modelId: "gpt-5.3-codex",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:03:00.000Z",
			archivedAt: "2026-06-03T12:04:00.000Z",
		},
		"marvin-1": {
			laneId: "marvin-1",
			projectId: "/work/marvin",
			sessionId: "eeeeeeee-0000-0000-0000-000000000000",
			sessionPath: "/sessions/marvin.jsonl",
			title: "marvin work",
			provider: "codex",
			modelId: "gpt-5.3-codex",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:02:00.000Z",
		},
	},
	sessionOrderByProject: {
		"/work/kiri": ["kiri-1"],
		"/work/nora": ["lane-b", "lane-a", "lane-c"],
		"/work/marvin": ["marvin-1"],
	},
	focusByProject: {
		"/work/kiri": { focusedLaneId: "kiri-1", focusedColumn: 0 },
		"/work/nora": { focusedLaneId: "lane-a", focusedColumn: 1 },
		"/work/marvin": { focusedLaneId: "marvin-1", focusedColumn: 0 },
	},
	selection: {
		projectId: "/work/nora",
		laneId: "lane-a",
	},
})

const withAllSessionsArchived = (lanes: WorkspaceLanesV2): WorkspaceLanesV2 => ({
	...lanes,
	sessionsById: Object.fromEntries(Object.entries(lanes.sessionsById).map(([laneId, session]) => [
		laneId,
		{ ...session, archivedAt: session.archivedAt ?? "2026-06-03T12:05:00.000Z" },
	])),
})

describe("deriveLaneHeaderState", () => {
	it("summarizes selected lane context and active session position", () => {
		const state = deriveLaneHeaderState(lanesFixture(), "sticky")

		expect(state.mode).toBe("sticky")
		expect(state.archivedCount).toBe(1)
		expect(state.activity).toEqual({
			runningAbove: 0,
			runningBelow: 0,
			unreadAbove: 0,
			unreadBelow: 0,
			runningHere: 0,
			unreadHere: 0,
		})
		expect(state.current).toEqual({
			projectTitle: "nora",
			sessionTitle: "first task",
			sessionShortId: "aaaaaaaa",
			projectIndex: 2,
			projectCount: 3,
			sessionIndex: 2,
			sessionCount: 2,
			previousSessionTitle: "second task",
			previousProjectTitle: "kiri",
			nextProjectTitle: "marvin",
		})
	})

	it("returns no current lane when no active session exists", () => {
		const lanes = withAllSessionsArchived(lanesFixture())

		expect(deriveLaneHeaderState(lanes, "off")).toEqual({
			mode: "off",
			current: null,
			archivedCount: 5,
			activity: {
				runningAbove: 0,
				runningBelow: 0,
				unreadAbove: 0,
				unreadBelow: 0,
				runningHere: 0,
				unreadHere: 0,
			},
		})
	})

	it("formats sticky and idle lane display parts", () => {
		const sticky = laneHeaderDisplay(deriveLaneHeaderState(lanesFixture(), "sticky"))
		expect(sticky).toEqual({
			active: true,
			badge: "lane",
			summary: "nora 2/3 · 2/2 · first task",
			position: "nora 2/3 · 2/2",
			adjacent: "←second task ↑kiri ↓marvin",
			activityBadges: "",
			hint: "enter exits",
		})

		const idle = laneHeaderDisplay(deriveLaneHeaderState(lanesFixture(), "off"))
		expect(idle).toEqual({
			active: false,
			badge: "",
			summary: "nora 2/3 · 2/2 · first task",
			position: "nora 2/3 · 2/2",
			adjacent: "←second task ↑kiri ↓marvin",
			activityBadges: "",
			hint: "",
		})
	})

	it("derives vertical activity badges relative to the focused project", () => {
		const state = deriveLaneHeaderState(lanesFixture(), "off", [
			{ laneId: "kiri-1", status: "streaming", isResponding: true, unread: true, lastActivityAt: 1 },
			{ laneId: "marvin-1", status: "completed", isResponding: false, unread: true, lastActivityAt: 2 },
			{ laneId: "lane-b", status: "queued", isResponding: false, unread: true, lastActivityAt: 3 },
		])

		expect(state.activity).toEqual({
			runningAbove: 1,
			runningBelow: 0,
			unreadAbove: 1,
			unreadBelow: 1,
			runningHere: 1,
			unreadHere: 1,
		})
		expect(laneHeaderDisplay(state).activityBadges).toBe("↑1● ↑1• ↓1• ↔1● ↔1•")
	})

	it("uses soft copy when lane mode has no selected session", () => {
		const lanes = withAllSessionsArchived(lanesFixture())

		expect(laneHeaderDisplay(deriveLaneHeaderState(lanes, "sticky"))).toEqual({
			active: true,
			badge: "lane",
			summary: "no session selected",
			position: "",
			adjacent: "",
			activityBadges: "",
			hint: "enter exits",
		})
	})
})

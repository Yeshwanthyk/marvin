import { describe, expect, it } from "bun:test"
import type { WorkspaceLanesV2 } from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { deriveLaneHeaderState, laneHeaderDisplay } from "../src/ui/app-shell/lane-header-state.js"

const lanesFixture = (): WorkspaceLanesV2 => ({
	version: 2,
	projectsById: {
		"/work/nora": {
			id: "/work/nora",
			cwd: "/work/nora",
			title: "nora",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:00:00.000Z",
		},
	},
	projectOrder: ["/work/nora"],
	sessionsById: {
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
	},
	sessionOrderByProject: {
		"/work/nora": ["lane-b", "lane-a", "lane-c"],
	},
	focusByProject: {
		"/work/nora": { focusedLaneId: "lane-a", focusedColumn: 1 },
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

		expect(state).toEqual({
			mode: "sticky",
			archivedCount: 1,
			current: {
				projectTitle: "nora",
				sessionTitle: "first task",
				sessionShortId: "aaaaaaaa",
				sessionIndex: 2,
				sessionCount: 2,
			},
		})
	})

	it("returns no current lane when no active session exists", () => {
		const lanes = withAllSessionsArchived(lanesFixture())

		expect(deriveLaneHeaderState(lanes, "off")).toEqual({
			mode: "off",
			current: null,
			archivedCount: 3,
		})
	})

	it("formats sticky and idle lane display parts", () => {
		const sticky = laneHeaderDisplay(deriveLaneHeaderState(lanesFixture(), "sticky"))
		expect(sticky).toEqual({
			active: true,
			badge: "lane",
			summary: "nora · first task 2/2",
			hint: "enter exits",
		})

		const idle = laneHeaderDisplay(deriveLaneHeaderState(lanesFixture(), "off"))
		expect(idle).toEqual({
			active: false,
			badge: "",
			summary: "nora · first task 2/2",
			hint: "",
		})
	})

	it("uses soft copy when lane mode has no selected session", () => {
		const lanes = withAllSessionsArchived(lanesFixture())

		expect(laneHeaderDisplay(deriveLaneHeaderState(lanes, "sticky"))).toEqual({
			active: true,
			badge: "lane",
			summary: "no session selected",
			hint: "enter exits",
		})
	})
})

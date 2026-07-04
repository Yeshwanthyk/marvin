import { describe, expect, it } from "bun:test"
import type { WorkspaceLanesV2 } from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { DEFAULT_KEYMAP_CONFIG } from "@yeshwanthyk/runtime-effect/config.js"
import { deriveLaneHeaderState, formatChord, laneHeaderDisplay, laneHeaderLine, laneHeaderVisibleWidth } from "../src/ui/app-shell/lane-header-state.js"

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
			external: false,
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
			sessionTitle: "first task",
			adjacent: "←second task ↑kiri ↓marvin",
			activityBadges: "",
			hint: "↵ exits",
			navHelp: "arrows focus",
		})

		const idle = laneHeaderDisplay(deriveLaneHeaderState(lanesFixture(), "off"))
		expect(idle).toEqual({
			active: false,
			badge: "",
			summary: "nora 2/3 · 2/2 · first task",
			position: "nora 2/3 · 2/2",
			sessionTitle: "first task",
			adjacent: "",
			activityBadges: "",
			hint: "⌃b lanes · ⌘k commands",
			navHelp: "",
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
			sessionTitle: "",
			adjacent: "",
			activityBadges: "",
			hint: "↵ exits",
			navHelp: "arrows focus",
		})
	})

	it("labels external lanes in the displayed spatial context", () => {
		const lanes: WorkspaceLanesV2 = {
			...lanesFixture(),
			sessionsById: {
				...lanesFixture().sessionsById,
				"external:pi:session-a": {
					laneId: "external:pi:session-a",
					projectId: "/work/nora",
					sessionId: "session-a",
					sessionPath: "/tmp/pi.jsonl",
					title: "pi task",
					provider: "pi",
					modelId: "external",
					createdAt: "2026-06-03T12:00:00.000Z",
					updatedAt: "2026-06-03T12:02:00.000Z",
				},
			},
			sessionOrderByProject: {
				...lanesFixture().sessionOrderByProject,
				"/work/nora": ["external:pi:session-a"],
			},
			focusByProject: {
				...lanesFixture().focusByProject,
				"/work/nora": { focusedLaneId: "external:pi:session-a", focusedColumn: 0 },
			},
			selection: { projectId: "/work/nora", laneId: "external:pi:session-a" },
		}

		const state = deriveLaneHeaderState(lanes, "off")
		expect(state.current?.external).toBe(true)
		expect(laneHeaderDisplay(state).summary).toBe("ext nora 2/3 · 1/1 · pi task")
	})

	it("formats compact chords for configured hints", () => {
		expect(formatChord("ctrl+b")).toBe("⌃b")
		expect(formatChord("shift+left")).toBe("⇧←")
		expect(formatChord("meta+k")).toBe("⌘k")
		expect(formatChord("return")).toBe("↵")
	})

	it("derives hints from lane keymap config", () => {
		const keymap = structuredClone(DEFAULT_KEYMAP_CONFIG.lanes)
		keymap.prefixKey = ["ctrl+x"]
		keymap.bindings.jump = ["meta+p"]
		keymap.bindings.newSession = ["m"]
		keymap.bindings.overview = ["v"]

		const idle = laneHeaderDisplay(deriveLaneHeaderState(lanesFixture(), "off"), keymap)
		expect(idle.hint).toBe("⌃x lanes · ⌘p commands")

		const prefix = laneHeaderDisplay(deriveLaneHeaderState(lanesFixture(), "prefix"), keymap)
		expect(prefix.navHelp).toContain("m new")
		expect(prefix.navHelp).toContain("v overview")
	})

	it("budgets primary lane header text across terminal widths", () => {
		const state = deriveLaneHeaderState(lanesFixture(), "off")
		for (const width of [80, 100, 120]) {
			const line = laneHeaderLine(state, { width, leftWidth: 32 })
			expect(laneHeaderVisibleWidth(line.primary)).toBeLessThanOrEqual(width - 32 - 8)
			expect(line.primary).toContain("nora 2/3 · 2/2")
			expect(line.primary).not.toContain("second task")
		}

		const wide = laneHeaderLine(state, { width: 120, leftWidth: 32 })
		expect(wide.primary).toContain("first task")
		expect(wide.primary).toContain("⌃b lanes")
	})

	it("shows the prefix map as a width-budgeted second line", () => {
		const state = deriveLaneHeaderState(lanesFixture(), "prefix")
		const line = laneHeaderLine(state, { width: 100, leftWidth: 32 })

		expect(laneHeaderVisibleWidth(line.navHelp)).toBeLessThanOrEqual(100 - 4)
		expect(line.navHelp).toContain("arrows focus")
		expect(line.navHelp).toContain("⇧arrows move")
		expect(line.navHelp).toContain("n new")
		expect(line.navHelp).toContain("$ rename")
		expect(line.navHelp).toContain("o overview")
		expect(line.navHelp).toContain("1-9 project")
	})
})

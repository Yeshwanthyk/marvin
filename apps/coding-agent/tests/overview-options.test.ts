import { describe, expect, it } from "bun:test"
import type { WorkspaceLanesV2 } from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { createOverviewOptions, parseOverviewValue } from "../src/ui/app-shell/overview-options.js"

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
	},
	projectOrder: ["/work/kiri", "/work/nora"],
	sessionsById: {
		"kiri-a": {
			laneId: "kiri-a",
			projectId: "/work/kiri",
			sessionId: "aaaaaaaa-0000-0000-0000-000000000000",
			sessionPath: "/sessions/kiri-a.jsonl",
			title: "kiri warm",
			provider: "codex",
			modelId: "gpt-5.5",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:01:00.000Z",
		},
		"nora-a": {
			laneId: "nora-a",
			projectId: "/work/nora",
			sessionId: "bbbbbbbb-0000-0000-0000-000000000000",
			sessionPath: "/sessions/nora-a.jsonl",
			title: "nora streaming",
			provider: "claude",
			modelId: "sonnet",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:02:00.000Z",
		},
		"nora-b": {
			laneId: "nora-b",
			projectId: "/work/nora",
			sessionId: "cccccccc-0000-0000-0000-000000000000",
			sessionPath: "/sessions/nora-b.jsonl",
			title: "nora archived",
			provider: "codex",
			modelId: "gpt-5",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:03:00.000Z",
			archivedAt: "2026-06-03T12:04:00.000Z",
		},
	},
	sessionOrderByProject: {
		"/work/kiri": ["kiri-a"],
		"/work/nora": ["nora-a", "nora-b"],
	},
	focusByProject: {
		"/work/kiri": { focusedLaneId: "kiri-a", focusedColumn: 0 },
		"/work/nora": { focusedLaneId: "nora-a", focusedColumn: 0 },
	},
	selection: {
		projectId: "/work/kiri",
		laneId: "kiri-a",
	},
})

describe("overview options", () => {
	it("builds a metadata grid ordered by activity before lane position", () => {
		const options = createOverviewOptions(lanesFixture(), [
			{ laneId: "nora-a", status: "streaming", isResponding: true, unread: true, lastActivityAt: 2 },
			{ laneId: "kiri-a", status: "warm", isResponding: false, unread: false, lastActivityAt: 1 },
		])

		expect(options).toEqual([
			{
				value: "overview:session:nora-a",
				label: "● nora 2/2 1/1  nora streaming",
				description: "streaming unread | claude/sonnet | bbbbbbbb",
				keywords: "nora nora streaming 2/2 1/1 streaming unread bbbbbbbb-0000-0000-0000-000000000000 /sessions/nora-a.jsonl claude/sonnet overview lane project session",
			},
			{
				value: "overview:session:kiri-a",
				label: "kiri 1/2 1/1  kiri warm",
				description: "warm | codex/gpt-5.5 | aaaaaaaa",
				keywords: "kiri kiri warm 1/2 1/1 warm aaaaaaaa-0000-0000-0000-000000000000 /sessions/kiri-a.jsonl codex/gpt-5.5 overview lane project session",
			},
		])
	})

	it("labels external sessions in overview rows", () => {
		const lanes = lanesFixture()
		const external: WorkspaceLanesV2 = {
			...lanes,
			sessionsById: {
				...lanes.sessionsById,
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
				...lanes.sessionOrderByProject,
				"/work/nora": ["external:pi:session-a"],
			},
		}

		const option = createOverviewOptions(external).find((entry) => entry.value === "overview:session:external:pi:session-a")
		expect(option).toEqual(expect.objectContaining({
			value: "overview:session:external:pi:session-a",
			label: "ext nora 2/2 1/1  pi task",
			description: "warm | external pi/external | session-",
		}))
	})

	it("labels cloud sessions from lane metadata", () => {
		const lanes = lanesFixture()
		const selected = lanes.sessionsById["kiri-a"]
		if (!selected) throw new Error("fixture missing selected lane")
		const cloud: WorkspaceLanesV2 = {
			...lanes,
			sessionsById: {
				...lanes.sessionsById,
				"kiri-a": {
					...selected,
					location: { kind: "cloud", beamId: "beam-123", movedAt: 123 },
				},
			},
		}

		const option = createOverviewOptions(cloud).find((entry) => entry.value === "overview:session:kiri-a")
		expect(option).toEqual(expect.objectContaining({
			value: "overview:session:kiri-a",
			label: "☁ kiri 1/2 1/1  kiri warm",
			description: "cloud beam-123 | codex/gpt-5.5 | aaaaaaaa",
		}))
	})

	it("parses overview selections", () => {
		expect(parseOverviewValue("overview:session:nora-a")).toEqual({ type: "session", laneId: "nora-a" })
		expect(parseOverviewValue("overview:session:")).toBeNull()
		expect(parseOverviewValue("session:nora-a")).toBeNull()
	})
})

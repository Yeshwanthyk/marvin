import { describe, expect, it } from "bun:test"
import type { WorkspaceLanes } from "@yeshwanthyk/runtime-effect/workspace-lanes.js"
import {
	commandActionValue,
	commandProjectValue,
	commandScratchpadValue,
	commandSessionValue,
	createCommandPaletteOptions,
	parseCommandPaletteValue,
} from "../src/ui/app-shell/command-palette-options.js"

const lanesFixture = (): WorkspaceLanes => ({
	version: 1,
	projects: [
		{
			id: "/work/nora",
			cwd: "/work/nora",
			title: "nora",
			updatedAt: "2026-06-03T12:00:00.000Z",
		},
	],
	sessions: [
		{
			id: "/work/nora:a",
			projectId: "/work/nora",
			sessionId: "aaaaaaaa-0000-0000-0000-000000000000",
			sessionPath: "/sessions/a.jsonl",
			title: "first task",
			provider: "codex",
			modelId: "gpt-5.5-low",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:02:00.000Z",
		},
		{
			id: "/work/nora:b",
			projectId: "/work/nora",
			sessionId: "bbbbbbbb-0000-0000-0000-000000000000",
			sessionPath: "/sessions/b.jsonl",
			title: "archived task",
			provider: "claude",
			modelId: "sonnet",
			createdAt: "2026-06-03T12:00:00.000Z",
			updatedAt: "2026-06-03T12:01:00.000Z",
			archivedAt: "2026-06-03T12:03:00.000Z",
		},
	],
	selection: {
		projectId: "/work/nora",
		sessionLaneId: "/work/nora:a",
	},
})

describe("command palette options", () => {
	it("includes command actions before active sessions", () => {
		const options = createCommandPaletteOptions(lanesFixture(), [
			{ cwd: "/work/marvin", title: "marvin", root: "/work" },
		], [
			{
				id: "scratch-a",
				cwd: "/work/nora",
				title: "fix search flow",
				bodyPath: "/config/scratchpads/nora/scratch-a.md",
				bodyPreview: "Check fuzzy matching",
				tags: ["search"],
				status: "open",
				createdAt: "2026-06-03T12:00:00.000Z",
				updatedAt: "2026-06-03T12:00:00.000Z",
			},
		])

		expect(options.map((option) => option.value)).toEqual([
			commandActionValue("settings"),
			commandActionValue("rename"),
			commandActionValue("newProjectSession"),
			commandActionValue("saveScratchpad"),
			commandActionValue("openScratchpad"),
			commandActionValue("startScratchpad"),
			commandActionValue("detach"),
			commandActionValue("archive"),
			commandActionValue("restore"),
			commandSessionValue("/work/nora:a"),
			commandScratchpadValue("scratch-a"),
			commandProjectValue("/work/marvin"),
		])
		expect(options[0]?.label).toBe("Settings")
		expect(options[1]?.label).toBe("Rename session")
		expect(options[8]?.description).toBe("1 archived")
		expect(options[9]).toEqual({
			value: commandSessionValue("/work/nora:a"),
			label: "nora / first task",
			description: "aaaaaaaa | codex/gpt-5.5-low",
			keywords: "nora first task aaaaaaaa-0000-0000-0000-000000000000 /sessions/a.jsonl codex/gpt-5.5-low switch session jump lane project",
		})
		expect(options[10]).toEqual({
			value: commandScratchpadValue("scratch-a"),
			label: "Scratch / fix search flow",
			description: "Check fuzzy matching",
			keywords: "fix search flow /work/nora Check fuzzy matching search scratch scratchpad note open start",
		})
		expect(options[11]).toEqual({
			value: commandProjectValue("/work/marvin"),
			label: "Project / marvin",
			description: "/work/marvin",
			keywords: "marvin /work/marvin /work open project workspace folder",
		})
	})

	it("parses action and session selections", () => {
		expect(parseCommandPaletteValue(commandActionValue("rename"))).toEqual({
			type: "action",
			action: "rename",
		})
		expect(parseCommandPaletteValue(commandSessionValue("/work/nora:a"))).toEqual({
			type: "session",
			sessionLaneId: "/work/nora:a",
		})
		expect(parseCommandPaletteValue(commandProjectValue("/work/marvin"))).toEqual({
			type: "project",
			cwd: "/work/marvin",
		})
		expect(parseCommandPaletteValue(commandScratchpadValue("scratch-a"))).toEqual({
			type: "scratchpad",
			id: "scratch-a",
		})
		expect(parseCommandPaletteValue("action:unknown")).toBeNull()
		expect(parseCommandPaletteValue("session:")).toBeNull()
	})
})

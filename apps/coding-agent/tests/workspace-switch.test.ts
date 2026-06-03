import { describe, expect, it } from "bun:test"
import { shouldStartFreshProjectSwitch, shouldStartFreshWorkspaceSession } from "../src/runtime/workspace-switch-state.js"
import type { LoadedSession } from "../src/session-manager.js"
import type { WorkspaceLanes } from "@yeshwanthyk/runtime-effect/workspace-lanes.js"

const loadedSession = {} as LoadedSession
const lanesFixture = (): WorkspaceLanes => ({
	version: 1,
	projects: [
		{ id: "/work/active", cwd: "/work/active", title: "active", updatedAt: "2026-06-03T00:00:00.000Z" },
		{ id: "/work/archived", cwd: "/work/archived", title: "archived", updatedAt: "2026-06-03T00:00:00.000Z" },
	],
	sessions: [
		{
			id: "/work/active:a",
			projectId: "/work/active",
			sessionId: "a",
			sessionPath: "/sessions/a.jsonl",
			title: "active session",
			provider: "codex",
			modelId: "gpt",
			createdAt: "2026-06-03T00:00:00.000Z",
			updatedAt: "2026-06-03T00:00:00.000Z",
		},
		{
			id: "/work/archived:b",
			projectId: "/work/archived",
			sessionId: "b",
			sessionPath: "/sessions/b.jsonl",
			title: "archived session",
			provider: "codex",
			modelId: "gpt",
			createdAt: "2026-06-03T00:00:00.000Z",
			updatedAt: "2026-06-03T00:00:00.000Z",
			archivedAt: "2026-06-03T00:00:01.000Z",
		},
	],
})

describe("workspace switch", () => {
	it("starts a fresh session when a project-only switch has no latest session", () => {
		expect(shouldStartFreshWorkspaceSession({ cwd: "/work/new" }, null)).toBe(true)
	})

	it("does not start fresh when switching to an existing or explicit session", () => {
		expect(shouldStartFreshWorkspaceSession({ cwd: "/work/existing" }, loadedSession)).toBe(false)
		expect(shouldStartFreshWorkspaceSession({ cwd: "/work/new", sessionPath: "/missing.jsonl" }, null)).toBe(false)
	})

	it("honors explicit fresh project switches", () => {
		expect(shouldStartFreshWorkspaceSession({ cwd: "/work/next", fresh: true }, loadedSession)).toBe(true)
	})

	it("starts fresh when a project has no active lane sessions", () => {
		const lanes = lanesFixture()

		expect(shouldStartFreshProjectSwitch(lanes, "/work/active")).toBe(false)
		expect(shouldStartFreshProjectSwitch(lanes, "/work/archived")).toBe(true)
		expect(shouldStartFreshProjectSwitch(lanes, "/work/new")).toBe(true)
	})
})

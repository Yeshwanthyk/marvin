import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSignal } from "solid-js"
import {
	createSessionLaneInput,
	createWorkspaceLaneStore,
	type WorkspaceLanesV2,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { createFocusController } from "../src/ui/app-shell/focus-controller.js"
import type { SessionActor } from "../src/runtime/session-actor.js"
import type { SessionActorRegistry } from "../src/runtime/session-actor-registry.js"

const fakeActor = (laneId: string): SessionActor => ({
	laneId,
	projectId: "/tmp/project",
	cwd: "/tmp/project",
	descriptor: () => ({
		laneId,
		projectId: "/tmp/project",
		cwd: "/tmp/project",
		sessionId: "session",
		sessionPath: "/tmp/session.jsonl",
	}),
	status: () => "warm",
	services: () => null,
	projection: {
		messages: () => [],
		toolBlocks: () => [],
		contextTokens: () => 0,
		isResponding: () => false,
		activityState: () => "idle",
		retryStatus: () => null,
		lastEventAt: () => 0,
		unread: () => false,
		subscribe: () => () => {},
		applyEvent: () => {},
		clearUnread: () => {},
	},
	hydrate: async () => { throw new Error("registry handles hydrate") },
	bindView: () => {},
	unbindView: () => {},
	refreshUiPolicy: () => {},
	submit: async () => {},
	steer: () => {},
	suspend: async () => {},
	close: async () => {},
})

describe("FocusController", () => {
	it("selects and hydrates the requested lane", async () => {
		const dir = mkdtempSync(join(tmpdir(), "marvin-focus-"))
		const [lanes, setLanes] = createSignal<WorkspaceLanesV2>()
		const store = createWorkspaceLaneStore(dir, setLanes)
		const laneId = "lane-a"
		store.transact([
			{
				type: "upsertProject",
				project: {
					id: "/tmp/project",
					cwd: "/tmp/project",
					title: "project",
					createdAt: "2026-07-03T00:00:00.000Z",
					updatedAt: "2026-07-03T00:00:00.000Z",
				},
			},
			{
				type: "upsertSession",
				session: createSessionLaneInput({
					laneId,
					projectId: "/tmp/project",
					sessionId: "session",
					sessionPath: "/tmp/session.jsonl",
					title: "session",
					provider: "anthropic",
					modelId: "claude",
					createdAt: "2026-07-03T00:00:00.000Z",
					updatedAt: "2026-07-03T00:00:00.000Z",
				}),
			},
		])
		setLanes(store.lanes())

		let isFocusedDuringHydrate = false
		let boundFocus: (() => boolean) | null = null
		const actor: SessionActor = {
			...fakeActor(laneId),
			bindView: (view) => {
				boundFocus = view.isFocused
			},
		}
		const hydrated: string[] = []
		const registry: SessionActorRegistry = {
			get: () => actor,
			create: () => actor,
			getOrCreate: () => actor,
			hydrate: async (nextLaneId) => {
				hydrated.push(nextLaneId)
				isFocusedDuringHydrate = boundFocus?.() ?? false
				return { type: "hydrated", actor }
			},
			list: () => [actor],
			remove: async () => {},
		}
		const [, setFocusedLaneId] = createSignal<string | null>(null)
		const controller = createFocusController({
			laneStore: store,
			workspaceLanes: () => lanes() ?? store.lanes(),
			registry,
			setFocusedLaneId,
		})

		await controller.focusLane(laneId)

		expect(store.lanes().selection).toEqual({ projectId: "/tmp/project", laneId })
		expect(hydrated).toEqual([laneId])
		expect(isFocusedDuringHydrate).toBe(true)
		expect(controller.focusedActor()).toBe(actor)
	})

	it("downgrades the previously focused actor UI policy", async () => {
		const dir = mkdtempSync(join(tmpdir(), "marvin-focus-"))
		const [lanes, setLanes] = createSignal<WorkspaceLanesV2>()
		const store = createWorkspaceLaneStore(dir, setLanes)
		store.transact([
			{
				type: "upsertProject",
				project: {
					id: "/tmp/project",
					cwd: "/tmp/project",
					title: "project",
					createdAt: "2026-07-03T00:00:00.000Z",
					updatedAt: "2026-07-03T00:00:00.000Z",
				},
			},
			{
				type: "upsertSession",
				session: createSessionLaneInput({
					laneId: "lane-a",
					projectId: "/tmp/project",
					sessionId: "session-a",
					sessionPath: "/tmp/a.jsonl",
					title: "a",
					provider: "anthropic",
					modelId: "claude",
					createdAt: "2026-07-03T00:00:00.000Z",
					updatedAt: "2026-07-03T00:00:00.000Z",
				}),
			},
			{
				type: "upsertSession",
				session: createSessionLaneInput({
					laneId: "lane-b",
					projectId: "/tmp/project",
					sessionId: "session-b",
					sessionPath: "/tmp/b.jsonl",
					title: "b",
					provider: "anthropic",
					modelId: "claude",
					createdAt: "2026-07-03T00:00:00.000Z",
					updatedAt: "2026-07-03T00:00:00.000Z",
				}),
			},
			{ type: "select", projectId: "/tmp/project", laneId: "lane-a" },
		])
		setLanes(store.lanes())

		const downgraded: boolean[] = []
		const actorA: SessionActor = {
			...fakeActor("lane-a"),
			refreshUiPolicy: (focused) => downgraded.push(focused),
		}
		const actorB = fakeActor("lane-b")
		const actors = new Map<string, SessionActor>([
			["lane-a", actorA],
			["lane-b", actorB],
		])
		const registry: SessionActorRegistry = {
			get: (laneId) => actors.get(laneId) ?? null,
			create: (descriptor) => actors.get(descriptor.laneId) ?? actorB,
			getOrCreate: (descriptor) => actors.get(descriptor.laneId) ?? actorB,
			hydrate: async (laneId) => ({ type: "hydrated", actor: actors.get(laneId) ?? actorB }),
			list: () => [...actors.values()],
			remove: async () => {},
		}
		const [, setFocusedLaneId] = createSignal<string | null>(null)
		const controller = createFocusController({
			laneStore: store,
			workspaceLanes: () => lanes() ?? store.lanes(),
			registry,
			setFocusedLaneId,
		})

		await controller.focusLane("lane-b")

		expect(downgraded).toEqual([false])
	})
})

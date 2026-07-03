import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createWorkspaceLaneStore } from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import { createActivityIndex, createNotificationService } from "../src/ui/app-shell/activity-index.js"
import { createOverviewOptions } from "../src/ui/app-shell/overview-options.js"
import {
	applyExternalAgentEvent,
	cockpitIngestPaths,
	debounceCockpitEvent,
	emptyCockpitIngestState,
	ingestCockpitSpool,
	loadCockpitIngestState,
	loadCockpitSessionIndex,
	parseExternalAgentEventLine,
	readCockpitEventsFromOffset,
	rotateCockpitSpoolIfIdle,
	saveCockpitIngestState,
	saveCockpitTitleOverlay,
	sweepCockpitPidLiveness,
	type ExternalAgentEvent,
} from "../src/runtime/cockpit-ingest.js"

const event = (overrides: Partial<ExternalAgentEvent> = {}): ExternalAgentEvent => ({
	v: 1,
	cli: "claude",
	kind: "busy",
	sessionId: "session-a",
	cwd: "/work/nora",
	at: "2026-07-03T12:00:00.000Z",
	...overrides,
})

const createTempStore = async () => {
	const configDir = await mkdtemp(path.join(tmpdir(), "marvin-cockpit-"))
	return {
		configDir,
		laneStore: createWorkspaceLaneStore(configDir),
		activityIndex: createActivityIndex(),
		notifications: createNotificationService(),
	}
}

describe("cockpit ingest", () => {
	it("parses normalized event lines defensively", () => {
		expect(parseExternalAgentEventLine("not-json")).toBeNull()
		expect(parseExternalAgentEventLine(JSON.stringify({ v: 1, cli: "bad", kind: "busy" }))).toBeNull()
		expect(parseExternalAgentEventLine(JSON.stringify(event({ transcriptPath: "/tmp/session.jsonl" })))).toEqual({
			v: 1,
			cli: "claude",
			kind: "busy",
			sessionId: "session-a",
			cwd: "/work/nora",
			transcriptPath: "/tmp/session.jsonl",
			at: "2026-07-03T12:00:00.000Z",
		})
	})

	it("reads only complete lines from an offset and advances the persisted byte cursor", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "marvin-cockpit-spool-"))
		const spoolPath = path.join(dir, "events.jsonl")
		const first = `${JSON.stringify(event({ sessionId: "one" }))}\n`
		const second = `${JSON.stringify(event({ sessionId: "two" }))}\n`
		await writeFile(spoolPath, `${first}${second.slice(0, -1)}`)

		const read = readCockpitEventsFromOffset(spoolPath, 0)
		expect(read.events.map((entry) => entry.sessionId)).toEqual(["one"])
		expect(read.offset).toBe(Buffer.byteLength(first))

		await writeFile(spoolPath, `${first}${second}`)
		const next = readCockpitEventsFromOffset(spoolPath, read.offset)
		expect(next.events.map((entry) => entry.sessionId)).toEqual(["two"])
		expect(next.offset).toBe(Buffer.byteLength(`${first}${second}`))
	})

	it("maps events into external lanes and activity entries without focusing them", async () => {
		const { laneStore, activityIndex, notifications } = await createTempStore()
		const state = applyExternalAgentEvent(
			event({ kind: "busy", title: "review migration", transcriptPath: "/tmp/claude.jsonl" }),
			emptyCockpitIngestState(),
			{ laneStore, activityIndex, notifications, isFocusedLane: () => false },
		)

		const lane = laneStore.lanes().sessionsById["external:claude:session-a"]
		expect(lane).toEqual({
			laneId: "external:claude:session-a",
			projectId: "/work/nora",
			sessionId: "session-a",
			sessionPath: "/tmp/claude.jsonl",
			title: "review migration",
			provider: "claude-code",
			modelId: "external",
			createdAt: "2026-07-03T12:00:00.000Z",
			updatedAt: "2026-07-03T12:00:00.000Z",
		})
		expect(laneStore.lanes().selection).toBeUndefined()
		expect(activityIndex.get("external:claude:session-a")).toMatchObject({
			status: "streaming",
			isResponding: true,
			unread: true,
		})
		expect(state.titleOverlay).toEqual({})
		expect(state.flap["external:claude:session-a"]).toEqual({
			signature: "busy||||review migration",
			at: "2026-07-03T12:00:00.000Z",
		})
		expect(state.sessions["external:claude:session-a"]).toEqual({
			laneId: "external:claude:session-a",
			cli: "claude",
			sessionId: "session-a",
			cwd: "/work/nora",
			transcriptPath: "/tmp/claude.jsonl",
			title: "review migration",
			lastEventAt: "2026-07-03T12:00:00.000Z",
		})
	})

	it("emits warning notifications for needs_input and stores title overlays", async () => {
		const { laneStore, activityIndex, notifications } = await createTempStore()
		const state = applyExternalAgentEvent(
			event({ kind: "title_changed", title: "better title" }),
			emptyCockpitIngestState(),
			{ laneStore, activityIndex, notifications },
		)
		applyExternalAgentEvent(
			event({ kind: "needs_input", reason: "permission" }),
			state,
			{ laneStore, activityIndex, notifications },
		)

		expect(laneStore.lanes().sessionsById["external:claude:session-a"]?.title).toBe("better title")
		expect(activityIndex.get("external:claude:session-a")).toMatchObject({
			status: "queued",
			unread: true,
		})
		expect(notifications.list()).toMatchObject([
			{
				laneId: "external:claude:session-a",
				projectId: "/work/nora",
				level: "warning",
				title: "External agent needs input",
				message: "claude-code / better title: permission",
			},
		])
	})

	it("debounces identical flap events inside the debounce window", async () => {
		const { laneStore, activityIndex, notifications } = await createTempStore()
		const first = applyExternalAgentEvent(
			event({ kind: "needs_input", reason: "permission", at: "2026-07-03T12:00:00.000Z" }),
			emptyCockpitIngestState(),
			{ laneStore, activityIndex, notifications },
		)
		const second = applyExternalAgentEvent(
			event({ kind: "needs_input", reason: "permission", at: "2026-07-03T12:00:00.500Z" }),
			first,
			{ laneStore, activityIndex, notifications },
		)
		const third = applyExternalAgentEvent(
			event({ kind: "needs_input", reason: "permission", at: "2026-07-03T12:00:01.300Z" }),
			second,
			{ laneStore, activityIndex, notifications },
		)

		expect(notifications.list()).toHaveLength(2)
		expect(second.flap["external:claude:session-a"]?.at).toBe("2026-07-03T12:00:00.500Z")
		expect(third.flap["external:claude:session-a"]?.at).toBe("2026-07-03T12:00:01.300Z")
		expect(debounceCockpitEvent(event({ kind: "busy" }), emptyCockpitIngestState()).drop).toBe(false)
	})

	it("marks dead reported pids cold and clears pid ownership", async () => {
		const { laneStore, activityIndex, notifications } = await createTempStore()
		const state = applyExternalAgentEvent(
			event({ kind: "busy", pid: 4242 }),
			emptyCockpitIngestState(),
			{ laneStore, activityIndex, notifications },
		)

		const swept = sweepCockpitPidLiveness(state, { activityIndex }, {
			now: "2026-07-03T12:01:00.000Z",
			isAlive: () => false,
		})

		expect(swept.sessions["external:claude:session-a"]?.pid).toBeUndefined()
		expect(swept.sessions["external:claude:session-a"]?.lastEventAt).toBe("2026-07-03T12:01:00.000Z")
		expect(activityIndex.get("external:claude:session-a")).toMatchObject({
			status: "cold",
			isResponding: false,
		})
	})

	it("persists metadata and local rename overlays for later events", async () => {
		const { configDir, laneStore, activityIndex, notifications } = await createTempStore()
		const paths = cockpitIngestPaths(configDir)
		const state = applyExternalAgentEvent(
			event({ cli: "pi", kind: "busy", title: "old title", tmuxPane: "%4", pid: 123 }),
			emptyCockpitIngestState(),
			{ laneStore, activityIndex, notifications },
		)
		saveCockpitIngestState(paths.statePath, state)

		saveCockpitTitleOverlay(configDir, "external:pi:session-a", "local title")

		expect(loadCockpitSessionIndex(configDir)["external:pi:session-a"]).toEqual({
			laneId: "external:pi:session-a",
			cli: "pi",
			sessionId: "session-a",
			cwd: "/work/nora",
			title: "local title",
			tmuxPane: "%4",
			pid: 123,
			lastEventAt: "2026-07-03T12:00:00.000Z",
		})
		const next = applyExternalAgentEvent(
			event({ cli: "pi", kind: "needs_input" }),
			loadCockpitIngestState(paths.statePath),
			{ laneStore, activityIndex, notifications },
		)
		expect(next.titleOverlay["pi:session-a"]).toBe("local title")
		expect(laneStore.lanes().sessionsById["external:pi:session-a"]?.title).toBe("local title")
	})

	it("ingests through state files and rotates fully consumed large spools", async () => {
		const { configDir, laneStore, activityIndex, notifications } = await createTempStore()
		const cockpitDir = path.join(configDir, "cockpit")
		await mkdir(cockpitDir, { recursive: true })
		const spoolPath = path.join(cockpitDir, "events.jsonl")
		await writeFile(spoolPath, `${JSON.stringify(event({ cli: "codex" }))}\n`)

		const state = ingestCockpitSpool(
			{ spoolPath, statePath: path.join(cockpitDir, "state.json") },
			{ laneStore, activityIndex, notifications },
		)

		expect(state.offset).toBeGreaterThan(0)
		expect(laneStore.lanes().sessionsById["external:codex:session-a"]?.provider).toBe("codex")
		await writeFile(spoolPath, `${" ".repeat(1024 * 1024 + 1)}`)
		expect(rotateCockpitSpoolIfIdle(spoolPath, { ...state, offset: 1024 * 1024 + 1 }).offset).toBe(0)
	})

	it("does not create state files when no spool exists", async () => {
		const { configDir, laneStore, activityIndex, notifications } = await createTempStore()
		const paths = {
			spoolPath: path.join(configDir, "cockpit", "events.jsonl"),
			statePath: path.join(configDir, "cockpit", "state.json"),
		}

		expect(ingestCockpitSpool(paths, { laneStore, activityIndex, notifications })).toEqual({
			offset: 0,
			titleOverlay: {},
			sessions: {},
			flap: {},
		})
		expect(existsSync(paths.statePath)).toBe(false)
	})

	it("keeps external providers renderable in overview rows", async () => {
		const { laneStore, activityIndex, notifications } = await createTempStore()
		applyExternalAgentEvent(
			event({ cli: "pi", kind: "turn_completed", ok: true, title: "pi lane" }),
			emptyCockpitIngestState(),
			{ laneStore, activityIndex, notifications },
		)

		expect(createOverviewOptions(laneStore.lanes(), activityIndex.entries())).toEqual([
			expect.objectContaining({
				value: "overview:session:external:pi:session-a",
				label: "• ext nora 1/1 1/1  pi lane",
				description: "done unread | external pi/external | session-",
			}),
		])
	})
})

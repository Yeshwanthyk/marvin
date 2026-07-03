import { existsSync, mkdirSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { watch, type FSWatcher } from "node:fs"
import {
	createSessionLaneInput,
	type LaneId,
	type WorkspaceLanePatch,
	type WorkspaceLaneStore,
} from "@yeshwanthyk/runtime-effect/workspace-lanes-v2.js"
import type { ActivityIndex, HostNotificationLevel, NotificationService } from "../ui/app-shell/activity-index.js"

export type ExternalAgentCli = "claude" | "codex" | "pi"
export type ExternalAgentEventKind =
	| "session_started"
	| "busy"
	| "needs_input"
	| "turn_completed"
	| "session_ended"
	| "title_changed"

export interface ExternalAgentEvent {
	readonly v: 1
	readonly cli: ExternalAgentCli
	readonly kind: ExternalAgentEventKind
	readonly sessionId: string
	readonly cwd: string
	readonly transcriptPath?: string
	readonly title?: string
	readonly prompt?: string
	readonly lastMessage?: string
	readonly ok?: boolean
	readonly reason?: string
	readonly tmuxPane?: string
	readonly pid?: number
	readonly at: string
	readonly raw?: unknown
}

export interface CockpitIngestState {
	readonly offset: number
	readonly titleOverlay: Record<string, string>
	readonly sessions: Record<string, CockpitSessionMeta>
}

export interface CockpitIngestPaths {
	readonly spoolPath: string
	readonly statePath: string
}

export interface CockpitSessionMeta {
	readonly laneId: LaneId
	readonly cli: ExternalAgentCli
	readonly sessionId: string
	readonly cwd: string
	readonly transcriptPath?: string
	readonly title?: string
	readonly tmuxPane?: string
	readonly pid?: number
	readonly lastEventAt: string
}

export interface CockpitIngestServices {
	readonly laneStore: WorkspaceLaneStore
	readonly activityIndex: ActivityIndex
	readonly notifications: NotificationService
	readonly isFocusedLane?: (laneId: LaneId) => boolean
}

export interface CockpitTailer {
	readonly ingestNow: () => void
	readonly close: () => void
}

const COCKPIT_DIR = "cockpit"
const SPOOL_FILE = "events.jsonl"
const STATE_FILE = "state.json"
const MAX_SPOOL_BYTES = 1024 * 1024
const EXTERNAL_MODEL_ID = "external"

const CLI_VALUES: readonly ExternalAgentCli[] = ["claude", "codex", "pi"]
const KIND_VALUES: readonly ExternalAgentEventKind[] = [
	"session_started",
	"busy",
	"needs_input",
	"turn_completed",
	"session_ended",
	"title_changed",
]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const readString = (value: Record<string, unknown>, key: string): string | undefined => {
	const raw = value[key]
	return typeof raw === "string" && raw.length > 0 ? raw : undefined
}
const readBoolean = (value: Record<string, unknown>, key: string): boolean | undefined => {
	const raw = value[key]
	return typeof raw === "boolean" ? raw : undefined
}
const readPid = (value: Record<string, unknown>): number | undefined => {
	const raw = value["pid"]
	return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined
}

const isCli = (value: string | undefined): value is ExternalAgentCli =>
	value !== undefined && (CLI_VALUES as readonly string[]).includes(value)

const isKind = (value: string | undefined): value is ExternalAgentEventKind =>
	value !== undefined && (KIND_VALUES as readonly string[]).includes(value)

const normalizeIso = (value: string | undefined): string | undefined => {
	if (!value) return undefined
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const overlayKey = (cli: ExternalAgentCli, sessionId: string): string => `${cli}:${sessionId}`
const laneIdFor = (event: ExternalAgentEvent): LaneId => `external:${event.cli}:${event.sessionId}`

const providerFor = (cli: ExternalAgentCli): string => {
	if (cli === "claude") return "claude-code"
	return cli
}

const titleFallback = (event: ExternalAgentEvent, overlay: string | undefined, existingTitle: string | undefined): string => {
	const title = event.title?.trim() || overlay?.trim() || event.prompt?.replace(/\s+/g, " ").trim() || existingTitle?.trim()
	if (title && title.length > 0) return title.slice(0, 80)
	return event.sessionId.slice(0, 8)
}

export const cockpitIngestPaths = (configDir: string): CockpitIngestPaths => ({
	spoolPath: join(configDir, COCKPIT_DIR, SPOOL_FILE),
	statePath: join(configDir, COCKPIT_DIR, STATE_FILE),
})

export const emptyCockpitIngestState = (): CockpitIngestState => ({ offset: 0, titleOverlay: {}, sessions: {} })

const parseSessionMeta = (laneId: string, value: unknown): CockpitSessionMeta | null => {
	if (!isRecord(value)) return null
	const cli = readString(value, "cli")
	const sessionId = readString(value, "sessionId")
	const cwd = readString(value, "cwd")
	const lastEventAt = normalizeIso(readString(value, "lastEventAt"))
	if (!isCli(cli) || !sessionId || !cwd || !lastEventAt) return null
	return {
		laneId,
		cli,
		sessionId,
		cwd,
		lastEventAt,
		...(readString(value, "transcriptPath") ? { transcriptPath: readString(value, "transcriptPath") } : {}),
		...(readString(value, "title") ? { title: readString(value, "title") } : {}),
		...(readString(value, "tmuxPane") ? { tmuxPane: readString(value, "tmuxPane") } : {}),
		...(readPid(value) !== undefined ? { pid: readPid(value) } : {}),
	}
}

export const loadCockpitIngestState = (statePath: string): CockpitIngestState => {
	if (!existsSync(statePath)) return emptyCockpitIngestState()
	try {
		const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"))
		if (!isRecord(parsed)) return emptyCockpitIngestState()
		const offsetRaw = parsed["offset"]
		const overlayRaw = parsed["titleOverlay"]
		const sessionsRaw = parsed["sessions"]
		const offset = typeof offsetRaw === "number" && Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0
		const titleOverlay = isRecord(overlayRaw)
			? Object.fromEntries(Object.entries(overlayRaw).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
			: {}
		const sessions = isRecord(sessionsRaw)
			? Object.fromEntries(
				Object.entries(sessionsRaw)
					.map(([laneId, value]) => [laneId, parseSessionMeta(laneId, value)] as const)
					.filter((entry): entry is readonly [string, CockpitSessionMeta] => entry[1] !== null),
			)
			: {}
		return { offset, titleOverlay, sessions }
	} catch {
		return emptyCockpitIngestState()
	}
}

export const saveCockpitIngestState = (statePath: string, state: CockpitIngestState): void => {
	mkdirSync(dirname(statePath), { recursive: true })
	writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

export const loadCockpitSessionIndex = (configDir: string): Record<string, CockpitSessionMeta> =>
	loadCockpitIngestState(cockpitIngestPaths(configDir).statePath).sessions

export const saveCockpitTitleOverlay = (configDir: string, laneId: LaneId, title: string): void => {
	const paths = cockpitIngestPaths(configDir)
	const state = loadCockpitIngestState(paths.statePath)
	const meta = state.sessions[laneId]
	if (!meta) return
	saveCockpitIngestState(paths.statePath, {
		...state,
		titleOverlay: { ...state.titleOverlay, [overlayKey(meta.cli, meta.sessionId)]: title },
		sessions: {
			...state.sessions,
			[laneId]: { ...meta, title },
		},
	})
}

export const parseExternalAgentEvent = (value: unknown): ExternalAgentEvent | null => {
	if (!isRecord(value)) return null
	if (value["v"] !== 1) return null
	const cli = readString(value, "cli")
	const kind = readString(value, "kind")
	const sessionId = readString(value, "sessionId")
	const cwd = readString(value, "cwd")
	const at = normalizeIso(readString(value, "at"))
	if (!isCli(cli) || !isKind(kind) || !sessionId || !cwd || !at) return null
	return {
		v: 1,
		cli,
		kind,
		sessionId,
		cwd,
		at,
		...(readString(value, "transcriptPath") ? { transcriptPath: readString(value, "transcriptPath") } : {}),
		...(readString(value, "title") ? { title: readString(value, "title") } : {}),
		...(readString(value, "prompt") ? { prompt: readString(value, "prompt") } : {}),
		...(readString(value, "lastMessage") ? { lastMessage: readString(value, "lastMessage") } : {}),
		...(readBoolean(value, "ok") !== undefined ? { ok: readBoolean(value, "ok") } : {}),
		...(readString(value, "reason") ? { reason: readString(value, "reason") } : {}),
		...(readString(value, "tmuxPane") ? { tmuxPane: readString(value, "tmuxPane") } : {}),
		...(readPid(value) !== undefined ? { pid: readPid(value) } : {}),
		...(value["raw"] !== undefined ? { raw: value["raw"] } : {}),
	}
}

export const parseExternalAgentEventLine = (line: string): ExternalAgentEvent | null => {
	const trimmed = line.trim()
	if (!trimmed) return null
	try {
		return parseExternalAgentEvent(JSON.parse(trimmed))
	} catch {
		return null
	}
}

export const readCockpitEventsFromOffset = (
	spoolPath: string,
	offset: number,
): { readonly events: ExternalAgentEvent[]; readonly offset: number } => {
	if (!existsSync(spoolPath)) return { events: [], offset }
	const buffer = readFileSync(spoolPath)
	const size = buffer.byteLength
	const safeOffset = offset > size ? 0 : offset
	const content = buffer.subarray(safeOffset).toString("utf8")
	const complete = content.endsWith("\n") ? content : content.slice(0, content.lastIndexOf("\n") + 1)
	const events = complete.split("\n").map(parseExternalAgentEventLine).filter((event): event is ExternalAgentEvent => event !== null)
	return { events, offset: safeOffset + Buffer.byteLength(complete) }
}

export const rotateCockpitSpoolIfIdle = (spoolPath: string, state: CockpitIngestState): CockpitIngestState => {
	if (!existsSync(spoolPath)) return state
	const size = statSync(spoolPath).size
	if (size <= MAX_SPOOL_BYTES || state.offset < size) return state
	truncateSync(spoolPath, 0)
	return { ...state, offset: 0 }
}

export const applyExternalAgentEvent = (
	event: ExternalAgentEvent,
	state: CockpitIngestState,
	services: CockpitIngestServices,
): CockpitIngestState => {
	const lanes = services.laneStore.lanes()
	const now = event.at
	const laneId = laneIdFor(event)
	const existing = lanes.sessionsById[laneId]
	const nextOverlay = { ...state.titleOverlay }
	if (event.kind === "title_changed" && event.title?.trim()) {
		nextOverlay[overlayKey(event.cli, event.sessionId)] = event.title.trim()
	}
	const title = titleFallback(event, nextOverlay[overlayKey(event.cli, event.sessionId)], existing?.title)
	const nextSessions = {
		...state.sessions,
		[laneId]: {
			...(state.sessions[laneId] ?? {}),
			laneId,
			cli: event.cli,
			sessionId: event.sessionId,
			cwd: event.cwd,
			lastEventAt: event.at,
			...(event.transcriptPath ? { transcriptPath: event.transcriptPath } : {}),
			...(title ? { title } : {}),
			...(event.tmuxPane ? { tmuxPane: event.tmuxPane } : {}),
			...(event.pid !== undefined ? { pid: event.pid } : {}),
		},
	} satisfies Record<string, CockpitSessionMeta>
	const patches: WorkspaceLanePatch[] = [
		{
			type: "upsertProject",
			project: {
				id: event.cwd,
				cwd: event.cwd,
				title: lanes.projectsById[event.cwd]?.title,
				createdAt: lanes.projectsById[event.cwd]?.createdAt ?? now,
				updatedAt: now,
			},
		},
		{
			type: "upsertSession",
			session: createSessionLaneInput({
				laneId,
				projectId: event.cwd,
				sessionId: event.sessionId,
				sessionPath: event.transcriptPath ?? existing?.sessionPath ?? null,
				title,
				provider: providerFor(event.cli),
				modelId: EXTERNAL_MODEL_ID,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			}),
		},
	]
	if (event.kind === "title_changed" && title.length > 0) {
		patches.push({ type: "renameSession", laneId, title })
	}
	services.laneStore.transact(patches)

	const isFocused = services.isFocusedLane?.(laneId) ?? false
	const unread = !isFocused
	const notify = (level: HostNotificationLevel, titleText: string, message: string) => {
		services.notifications.enqueue({ laneId, projectId: event.cwd, level, title: titleText, message })
	}

	if (event.kind === "session_started") {
		services.activityIndex.patch(laneId, { status: "warm", isResponding: false, unread: false, lastActivityAt: Date.parse(now) })
	} else if (event.kind === "busy") {
		services.activityIndex.patch(laneId, { status: "streaming", isResponding: true, unread, lastActivityAt: Date.parse(now) })
	} else if (event.kind === "needs_input") {
		services.activityIndex.patch(laneId, { status: "queued", isResponding: false, unread: true, lastActivityAt: Date.parse(now) })
		notify("warning", "External agent needs input", `${providerFor(event.cli)} / ${title}${event.reason ? `: ${event.reason}` : ""}`)
	} else if (event.kind === "turn_completed") {
		const ok = event.ok !== false
		services.activityIndex.patch(laneId, {
			status: ok ? "completed" : "errored",
			isResponding: false,
			unread,
			lastActivityAt: Date.parse(now),
			lastCompletedAt: Date.parse(now),
			...(ok ? { lastError: null } : { lastError: event.reason ?? event.lastMessage ?? "external agent failed" }),
		})
		if (unread) notify(ok ? "success" : "error", ok ? "External agent complete" : "External agent failed", `${providerFor(event.cli)} / ${title}`)
	} else if (event.kind === "session_ended") {
		services.activityIndex.patch(laneId, { status: "cold", isResponding: false, unread: false, lastActivityAt: Date.parse(now) })
	} else if (event.kind === "title_changed") {
		services.activityIndex.patch(laneId, { lastActivityAt: Date.parse(now) })
	}

	return { ...state, titleOverlay: nextOverlay, sessions: nextSessions }
}

export const ingestCockpitSpool = (
	paths: CockpitIngestPaths,
	services: CockpitIngestServices,
): CockpitIngestState => {
	let state = loadCockpitIngestState(paths.statePath)
	if (!existsSync(paths.spoolPath)) return state
	const read = readCockpitEventsFromOffset(paths.spoolPath, state.offset)
	state = { ...state, offset: read.offset }
	for (const event of read.events) {
		state = applyExternalAgentEvent(event, state, services)
	}
	state = rotateCockpitSpoolIfIdle(paths.spoolPath, state)
	saveCockpitIngestState(paths.statePath, state)
	return state
}

export const startCockpitTailer = (
	configDir: string,
	services: CockpitIngestServices,
	options: { readonly intervalMs?: number } = {},
): CockpitTailer => {
	const paths = cockpitIngestPaths(configDir)
	let closed = false
	let watcher: FSWatcher | null = null
	const ingestNow = () => {
		if (closed) return
		ingestCockpitSpool(paths, services)
	}
	try {
		if (existsSync(paths.spoolPath)) {
			watcher = watch(paths.spoolPath, { persistent: false }, ingestNow)
		}
	} catch {
		watcher = null
	}
	const timer = setInterval(ingestNow, options.intervalMs ?? 1000)
	ingestNow()
	return {
		ingestNow,
		close: () => {
			closed = true
			clearInterval(timer)
			watcher?.close()
		},
	}
}

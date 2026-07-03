#!/usr/bin/env bun

import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

type Cli = "claude" | "codex" | "pi"
type Kind = "session_started" | "busy" | "needs_input" | "turn_completed" | "session_ended" | "title_changed"

const cliValues = new Set<Cli>(["claude", "codex", "pi"])
const kindValues = new Set<Kind>(["session_started", "busy", "needs_input", "turn_completed", "session_ended", "title_changed"])

const readArg = (name: string): string | undefined => {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const readString = (value: Record<string, unknown>, key: string): string | undefined => {
	const raw = value[key]
	return typeof raw === "string" && raw.length > 0 ? raw : undefined
}

const readJsonFromStdin = (): unknown => {
	try {
		const text = readFileSync(0, "utf8").trim()
		return text.length > 0 ? JSON.parse(text) : null
	} catch {
		return null
	}
}

const raw = readJsonFromStdin()
const input = isRecord(raw) ? raw : {}
const cliArg = readArg("--cli")
const kindArg = readArg("--kind")
const cli = cliValues.has(cliArg as Cli) ? cliArg as Cli : undefined
const kind = kindValues.has(kindArg as Kind) ? kindArg as Kind : undefined
const sessionId = readString(input, "sessionId")
	?? readString(input, "session_id")
	?? readString(input, "conversation_id")
	?? readString(input, "id")
	?? `${process.pid}`
const cwd = readString(input, "cwd") ?? process.env.PWD ?? process.cwd()
const transcriptPath = readString(input, "transcriptPath") ?? readString(input, "transcript_path")
const title = readString(input, "title") ?? readString(input, "thread_name") ?? readString(input, "session_name")
const prompt = readString(input, "prompt") ?? readString(input, "message")
const lastMessage = readString(input, "lastMessage") ?? readString(input, "last_message")
const reason = readArg("--reason") ?? readString(input, "reason") ?? readString(input, "hook_event_name")
const okRaw = input["ok"]
const event = {
	v: 1,
	cli: cli ?? "codex",
	kind: kind ?? "busy",
	sessionId,
	cwd,
	...(transcriptPath ? { transcriptPath } : {}),
	...(title ? { title } : {}),
	...(prompt ? { prompt } : {}),
	...(lastMessage ? { lastMessage } : {}),
	...(typeof okRaw === "boolean" ? { ok: okRaw } : {}),
	...(reason ? { reason } : {}),
	...(process.env.TMUX_PANE ? { tmuxPane: process.env.TMUX_PANE } : {}),
	pid: process.ppid > 1 ? process.ppid : process.pid,
	at: new Date().toISOString(),
	raw,
}
const spoolPath = process.env.MARVIN_COCKPIT_SPOOL
	?? join(process.env.MARVIN_CONFIG_DIR ?? join(homedir(), ".config", "marvin"), "cockpit", "events.jsonl")

try {
	mkdirSync(dirname(spoolPath), { recursive: true })
	appendFileSync(spoolPath, `${JSON.stringify(event)}\n`, { encoding: "utf8" })
} catch {
	// Hooks must never break the host CLI.
}

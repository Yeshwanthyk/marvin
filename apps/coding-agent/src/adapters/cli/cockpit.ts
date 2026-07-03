import {
	runCockpitInstallerAction,
	type CockpitAgent,
	type CockpitInstallAction,
} from "@yeshwanthyk/runtime-effect/cockpit/installers.js"

export interface RunCockpitCommandOptions {
	action?: CockpitInstallAction
	agent?: string
}

const isAgent = (value: string | undefined): value is CockpitAgent =>
	value === "claude" || value === "codex" || value === "pi"

const COCKPIT_HOOK_BINARY_SOURCE = `#!/usr/bin/env bun
// # marvin-cockpit-hook

import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

const cliValues = new Set(["claude", "codex", "pi"])
const kindValues = new Set(["session_started", "busy", "needs_input", "turn_completed", "session_ended", "title_changed"])

const readArg = (name) => {
\tconst index = process.argv.indexOf(name)
\treturn index >= 0 ? process.argv[index + 1] : undefined
}

const isRecord = (value) => typeof value === "object" && value !== null
const readString = (value, key) => {
\tconst raw = value[key]
\treturn typeof raw === "string" && raw.length > 0 ? raw : undefined
}

const readJsonFromStdin = () => {
\ttry {
\t\tconst text = readFileSync(0, "utf8").trim()
\t\treturn text.length > 0 ? JSON.parse(text) : null
\t} catch {
\t\treturn null
\t}
}

const raw = readJsonFromStdin()
const input = isRecord(raw) ? raw : {}
const cliArg = readArg("--cli")
const kindArg = readArg("--kind")
const cli = cliValues.has(cliArg) ? cliArg : undefined
const kind = kindValues.has(kindArg) ? kindArg : undefined
const sessionId = readString(input, "sessionId")
\t?? readString(input, "session_id")
\t?? readString(input, "conversation_id")
\t?? readString(input, "id")
\t?? \`\${process.pid}\`
const cwd = readString(input, "cwd") ?? process.env.PWD ?? process.cwd()
const transcriptPath = readString(input, "transcriptPath") ?? readString(input, "transcript_path")
const title = readString(input, "title") ?? readString(input, "thread_name") ?? readString(input, "session_name")
const prompt = readString(input, "prompt") ?? readString(input, "message")
const lastMessage = readString(input, "lastMessage") ?? readString(input, "last_message")
const reason = readArg("--reason") ?? readString(input, "reason") ?? readString(input, "hook_event_name")
const okRaw = input["ok"]
const event = {
\tv: 1,
\tcli: cli ?? "codex",
\tkind: kind ?? "busy",
\tsessionId,
\tcwd,
\t...(transcriptPath ? { transcriptPath } : {}),
\t...(title ? { title } : {}),
\t...(prompt ? { prompt } : {}),
\t...(lastMessage ? { lastMessage } : {}),
\t...(typeof okRaw === "boolean" ? { ok: okRaw } : {}),
\t...(reason ? { reason } : {}),
\t...(process.env.TMUX_PANE ? { tmuxPane: process.env.TMUX_PANE } : {}),
\tpid: process.ppid > 1 ? process.ppid : process.pid,
\tat: new Date().toISOString(),
\traw,
}
const spoolPath = process.env.MARVIN_COCKPIT_SPOOL
\t?? join(process.env.MARVIN_CONFIG_DIR ?? join(homedir(), ".config", "marvin"), "cockpit", "events.jsonl")

try {
\tmkdirSync(dirname(spoolPath), { recursive: true })
\tappendFileSync(spoolPath, \`\${JSON.stringify(event)}\\n\`, { encoding: "utf8" })
} catch {
\t// Hooks must never break the host CLI.
}
`

export const runCockpitCommand = async (options: RunCockpitCommandOptions): Promise<void> => {
	const action = options.action
	if (!action) {
		process.stderr.write("Usage: marvin cockpit <install|uninstall|status> [--agent claude|codex|pi]\n")
		process.exitCode = 1
		return
	}
	if (options.agent !== undefined && !isAgent(options.agent)) {
		process.stderr.write(`Unknown cockpit agent: ${options.agent}\n`)
		process.exitCode = 1
		return
	}
	const results = await runCockpitInstallerAction(action, {
		agents: options.agent ? [options.agent] : undefined,
		hookBinarySource: action === "install" ? COCKPIT_HOOK_BINARY_SOURCE : undefined,
	})
	for (const result of results) {
		const suffix = result.message ? ` (${result.message})` : ""
		process.stdout.write(`${result.agent}: ${result.status}${result.changed ? " changed" : ""} ${result.path}${suffix}\n`)
	}
}

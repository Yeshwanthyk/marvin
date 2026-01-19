/**
 * Tool logger hook - logs tool executions to stderr.
 *
 * Install:
 *   cp examples/hooks/tool-logger.ts ~/.config/marvin/hooks/
 */

import type { HookFactory } from "@yeshwanthyk/coding-agent/hooks"

const hook: HookFactory = (marvin) => {
	marvin.on("tool.execute.before", (ev) => {
		if (ev.toolName === "bash") {
			const cmd = typeof ev.input?.command === "string" ? ev.input.command : ""
			console.error(`[tool] bash start: ${cmd.split("\n")[0] || "(empty)"}`)
			return
		}

		console.error(`[tool] ${ev.toolName} start`)
	})

	marvin.on("tool.execute.after", (ev) => {
		console.error(`[tool] ${ev.toolName} ${ev.isError ? "error" : "ok"}`)
	})
}

export default hook

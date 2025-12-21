/**
 * Tool logger hook - logs tool executions to stderr
 * 
 * Install: cp examples/hooks/tool-logger.ts ~/.config/marvin/hooks/
 */

import type { HookModule } from "@marvin-agents/coding-agent/hooks"

const hook: HookModule = {
	name: "tool-logger",
	events: {
		"tool.execute.before": async ({ tool, input }) => {
			console.error(`[tool] ${tool.name} starting`)
		},
		"tool.execute.after": async ({ tool, output }) => {
			console.error(`[tool] ${tool.name} complete`)
		},
		// Tool-specific hooks
		"tool.execute.bash.before": async ({ input }) => {
			console.error(`[bash] ${input.command?.split("\n")[0]}`)
		},
	},
}

export default hook

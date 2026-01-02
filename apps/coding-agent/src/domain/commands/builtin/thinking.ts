import { THINKING_LEVELS, type CommandDefinition } from "../types.js"
import { updateAppConfig } from "../../../config.js"

export const thinkingCommand: CommandDefinition = {
	name: "thinking",
	execute: (args, ctx) => {
		const next = args.trim() as typeof THINKING_LEVELS[number]
		if (!THINKING_LEVELS.includes(next)) return false

		ctx.agent.setThinkingLevel(next)
		ctx.setCurrentThinking(next)
		ctx.setDisplayThinking(next)
		void updateAppConfig({ configDir: ctx.configDir, configPath: ctx.configPath }, { thinking: next })
		return true
	},
}

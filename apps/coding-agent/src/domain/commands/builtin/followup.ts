import { addSystemMessage } from "../helpers.js"
import type { CommandDefinition } from "../types.js"

const USAGE = "Usage: /followup <text>"

export const followupCommand: CommandDefinition = {
	name: "followup",
	description: "Queue text to deliver after the agent becomes idle",
	execute: async (args, ctx) => {
		const text = args.trim()
		if (!text) {
			addSystemMessage(ctx, USAGE)
			return true
		}

		if (ctx.isResponding()) {
			await ctx.followUp(text)
			return true
		}

		await ctx.runImmediatePrompt(text)
		return true
	},
}

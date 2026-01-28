import { addSystemMessage } from "../helpers.js"
import type { CommandDefinition } from "../types.js"

const USAGE = "Usage: /steer <text>"

export const steerCommand: CommandDefinition = {
	name: "steer",
	description: "Interrupt after the current tool turn with steering instructions",
	execute: async (args, ctx) => {
		const text = args.trim()
		if (!text) {
			addSystemMessage(ctx, USAGE)
			return true
		}

		ctx.clearEditor?.()

		if (ctx.isResponding()) {
			await ctx.steer(text)
			return true
		}

		await ctx.submitPrompt(text, { mode: "steer" })
		return true
	},
}

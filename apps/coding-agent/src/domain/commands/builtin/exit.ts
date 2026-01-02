import type { CommandDefinition } from "../types.js"

export const exitCommand: CommandDefinition = {
	name: "exit",
	aliases: ["quit"],
	execute: (_args, ctx) => {
		if (ctx.onExit) {
			ctx.onExit()
		} else {
			process.exit(0)
		}
		return true
	},
}

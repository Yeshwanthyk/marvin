import type { CommandDefinition } from "../types.js"

export const concealCommand: CommandDefinition = {
	name: "conceal",
	execute: (_args, ctx) => {
		ctx.setConcealMarkdown((prev) => !prev)
		return true
	},
}

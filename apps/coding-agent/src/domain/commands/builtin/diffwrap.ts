import type { CommandDefinition } from "../types.js"

export const diffwrapCommand: CommandDefinition = {
	name: "diffwrap",
	execute: (_args, ctx) => {
		ctx.setDiffWrapMode((prev) => (prev === "word" ? "none" : "word"))
		return true
	},
}

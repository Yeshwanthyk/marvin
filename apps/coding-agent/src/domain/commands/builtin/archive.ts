import type { CommandDefinition } from "../types.js"

export const archiveCommand: CommandDefinition = {
	name: "archive",
	aliases: ["archive-session"],
	description: "Archive the current session from active lane navigation",
	execute: async (_args, ctx) => {
		ctx.archiveCurrentSession?.()
		return true
	},
}

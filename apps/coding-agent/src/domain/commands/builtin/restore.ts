import type { CommandDefinition } from "../types.js"

export const restoreCommand: CommandDefinition = {
	name: "restore",
	aliases: ["restore-session"],
	description: "Restore an archived session to active lane navigation",
	execute: async (_args, ctx) => {
		ctx.restoreArchivedSession?.()
		return true
	},
}

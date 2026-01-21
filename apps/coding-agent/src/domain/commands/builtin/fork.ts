import type { CommandDefinition } from "../types.js"

export const forkCommand: CommandDefinition = {
	name: "fork",
	description: "Fork current session into a new one",
	execute: (_args, ctx) => {
		const result = ctx.sessionManager.forkSession()
		if (!result) {
			process.stderr.write("No active session to fork\n")
			return true
		}
		process.stdout.write(`Forked → ${result.id}\nResume with: marvin -r\n`)
		return true
	},
}

import type { CommandDefinition } from "../types.js"

export const clearCommand: CommandDefinition = {
	name: "clear",
	execute: (_args, ctx) => {
		ctx.setMessages(() => [])
		ctx.setToolBlocks(() => [])
		ctx.setContextTokens(0)
		ctx.setCacheStats(null)
		ctx.agent.reset()
		void ctx.hookRunner?.emit({ type: "session.clear", sessionId: null })
		return true
	},
}

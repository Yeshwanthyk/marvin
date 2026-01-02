import { addSystemMessage } from "../helpers.js"
import type { CommandDefinition } from "../types.js"

const formatNumber = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export const statusCommand: CommandDefinition = {
	name: "status",
	execute: (_args, ctx) => {
		const model = ctx.agent.state.model
		const messages = ctx.agent.state.messages
		let usage: { totalTokens?: number; cacheRead?: number } | undefined
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i] as { role: string; usage?: { totalTokens?: number; cacheRead?: number } }
			if (msg.role === "assistant" && msg.usage?.totalTokens) {
				usage = msg.usage
				break
			}
		}

		let ctxStr = `0/${formatNumber(model.contextWindow)}`
		let cache = ""
		if (usage?.totalTokens) {
			const pct = ((usage.totalTokens / model.contextWindow) * 100).toFixed(1)
			ctxStr = `${formatNumber(usage.totalTokens)}/${formatNumber(model.contextWindow)} (${pct}%)`
			if (usage.cacheRead) cache = ` | cache: ${formatNumber(usage.cacheRead)} read`
		}
		const turns = messages.filter((m) => (m as { role: string }).role === "user").length
		const status = `${ctx.currentModelId} (${ctx.currentProvider}) | ${ctx.currentThinking} | ${ctxStr}${cache} | turns: ${turns}`
		addSystemMessage(ctx, status)
		return true
	},
}

/**
 * steer-followup hook - demonstrates steering/follow-up helpers.
 *
 * Install:
 *   cp examples/hooks/steer-followup.ts ~/.config/marvin/hooks/
 */

import type { HookFactory } from "@yeshwanthyk/coding-agent/hooks"

const hook: HookFactory = (marvin) => {
	marvin.registerCommand("focus", {
		description: "Interrupt the current run with steering text",
		handler: async (args, ctx) => {
			const text = args.trim() || "Focus on the file I just opened."
			// ctx.isIdle() is available if you need to branch logic,
			// but marvin.steer() already handles idle vs streaming cases.
			await marvin.steer(text)
			ctx.ui.notify?.("Steer queued", ctx.isIdle() ? "info" : "warning")
		},
	})

	marvin.registerCommand("queue", {
		description: "Queue follow-up text to run after the current turn",
		handler: async (args) => {
			const text = args.trim()
			if (!text) return
			await marvin.followUp(text)
		},
	})

	// Example: always queue a follow-up reminder once the agent becomes idle.
	marvin.on("agent.end", async (_event, ctx) => {
		if (!ctx.isIdle()) return
		await marvin.sendUserMessage("Let me know if you want more detail.", { deliverAs: "followUp" })
	})
}

export default hook

/**
 * Git context hook - injects recent commits on app start / session clear.
 *
 * Install:
 *   cp examples/hooks/git-context.ts ~/.config/marvin/hooks/
 */

import type { HookEventContext, HookFactory } from "@yeshwanthyk/coding-agent/hooks"

const hook: HookFactory = (marvin) => {
	const sendGitContext = async (_ev: unknown, ctx: HookEventContext) => {
		const result = await ctx.exec("git", ["log", "--oneline", "-5"], { timeout: 5000 })
		if (result.code !== 0) return

		const out = result.stdout.trim()
		if (!out) return

		marvin.send(`[Git context - recent commits in ${ctx.cwd}]\n\n\`\`\`\n${out}\n\`\`\``)
	}

	marvin.on("app.start", sendGitContext)
	marvin.on("session.clear", sendGitContext)
}

export default hook

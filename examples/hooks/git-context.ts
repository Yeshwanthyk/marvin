/**
 * Git context hook - injects recent commits on session start/clear
 * 
 * Install: cp examples/hooks/git-context.ts ~/.config/marvin/hooks/
 */

import type { HookModule } from "@marvin-agents/coding-agent/hooks"

async function loadGitContext({ marvin, ctx }: { marvin: any; ctx: any }) {
	const result = await ctx.exec("git", ["log", "--oneline", "-5"], { timeout: 5000 })
	
	if (result.code === 0 && result.stdout.trim()) {
		marvin.send(`[Git context - recent commits in ${ctx.cwd}]\n\`\`\`\n${result.stdout.trim()}\n\`\`\``)
	}
}

const hook: HookModule = {
	name: "git-context",
	events: {
		"app.start": loadGitContext,
		"session.clear": loadGitContext,
	},
}

export default hook

import type { AppMessage } from "@yeshwanthyk/agent-core"
import { handleCompact as summarizeBranch } from "../../../compact-handler.js"
import { addSystemMessage } from "../helpers.js"
import type { CommandDefinition } from "../types.js"

const TREE_SUMMARY_OPTIONS = [
	"No summary",
	"Summarize",
	"Summarize with custom prompt",
] as const

export const treeCommand: CommandDefinition = {
	name: "tree",
	description: "Navigate the current session tree",
	execute: async (_args, ctx) => {
		if (!ctx.showTreeSelector || !ctx.navigateTree) {
			return false
		}

		const selectedId = await ctx.showTreeSelector()
		if (selectedId === undefined) {
			return true
		}

		let summaryMessage: AppMessage | undefined
		if (ctx.showSelect) {
			const mode = await ctx.showSelect("Summarize branch?", [...TREE_SUMMARY_OPTIONS])
			if (mode === undefined) return true

			let customInstructions: string | undefined
			if (mode === "Summarize with custom prompt") {
				customInstructions = await ctx.showInput?.(
					"Custom summarization instructions",
					"What should the branch summary focus on?",
				)
				if (customInstructions === undefined) return true
			}

			if (mode !== "No summary") {
				if (ctx.agent.state.messages.length < 2) {
					addSystemMessage(ctx, "Nothing to summarize for this branch")
					return true
				}

				ctx.setActivityState("compacting")
				ctx.setIsResponding(true)
				try {
					const prevState = ctx.sessionManager.getCompactionState()
					const result = await summarizeBranch({
						agent: ctx.agent,
						currentProvider: ctx.currentProvider,
						getApiKey: ctx.getApiKey,
						codexTransport: ctx.codexTransport,
						customInstructions,
						previousSummary: prevState?.lastSummary,
						previousFileOps: prevState
							? {
								readFiles: prevState.readFiles,
								modifiedFiles: prevState.modifiedFiles,
							}
							: undefined,
					})
					summaryMessage = result.summaryMessage
					await ctx.hookRunner?.emit({
						type: "session.compact",
						sessionId: ctx.sessionManager.sessionId,
						summary: result.summary,
					})
				} catch (err) {
					addSystemMessage(ctx, `Branch summary failed: ${err instanceof Error ? err.message : String(err)}`)
					return true
				} finally {
					ctx.setIsResponding(false)
					ctx.setActivityState("idle")
				}
			}
		}

		const result = summaryMessage
			? await ctx.navigateTree(selectedId, { summaryMessage })
			: await ctx.navigateTree(selectedId)
		if (result?.editorText !== undefined) {
			ctx.setEditorText?.(result.editorText)
		} else {
			ctx.clearEditor?.()
		}
		return true
	},
}

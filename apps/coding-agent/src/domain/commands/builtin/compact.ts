import { handleCompact as doCompact } from "../../../compact-handler.js"
import { addSystemMessage } from "../helpers.js"
import type { CommandDefinition } from "../types.js"

export const compactCommand: CommandDefinition = {
	name: "compact",
	execute: async (args, ctx) => {
		if (ctx.isResponding()) {
			addSystemMessage(ctx, "Cannot compact while responding. Use /abort first.")
			return true
		}

		const messages = ctx.agent.state.messages
		if (messages.length < 2) {
			addSystemMessage(ctx, "Nothing to compact (need at least one exchange)")
			return true
		}

		const customInstructions = args.trim() || undefined

		// Emit session.before_compact hook - allows hooks to cancel or add context
		const beforeCompactEvent = {
			type: "session.before_compact" as const,
			input: { sessionId: ctx.sessionManager.sessionId },
			output: { cancel: false, prompt: undefined as string | undefined, context: [] as string[] },
		}
		await ctx.hookRunner?.emit(beforeCompactEvent)
		if (beforeCompactEvent.output.cancel) {
			addSystemMessage(ctx, "Compaction cancelled by hook")
			return true
		}

		// Merge hook-provided instructions with user-provided ones
		const hookPrompt = beforeCompactEvent.output.prompt
		const mergedInstructions = [customInstructions, hookPrompt, ...beforeCompactEvent.output.context]
			.filter(Boolean)
			.join("\n\n") || undefined

		ctx.setActivityState("compacting")
		ctx.setIsResponding(true)

		try {
			const prevState = ctx.sessionManager.getCompactionState()

			const { summary, summaryMessage, fileOps } = await doCompact({
				agent: ctx.agent,
				currentProvider: ctx.currentProvider,
				getApiKey: ctx.getApiKey,
				codexTransport: ctx.codexTransport,
				customInstructions: mergedInstructions,
				previousSummary: prevState?.lastSummary,
				previousFileOps: prevState
					? {
						readFiles: prevState.readFiles,
						modifiedFiles: prevState.modifiedFiles,
					}
					: undefined,
			})

			// Emit session.compact hook after successful compaction
			await ctx.hookRunner?.emit({
				type: "session.compact",
				sessionId: ctx.sessionManager.sessionId,
				summary,
			})

			ctx.agent.reset()
			ctx.agent.replaceMessages([summaryMessage])

			ctx.sessionManager.startSession(ctx.currentProvider, ctx.currentModelId, ctx.currentThinking)
			ctx.sessionManager.appendMessage(summaryMessage)

			const modified = new Set([...fileOps.edited, ...fileOps.written])
			const readOnly = [...fileOps.read].filter((file) => !modified.has(file))
			ctx.sessionManager.updateCompactionState({
				lastSummary: summary,
				readFiles: readOnly.sort(),
				modifiedFiles: [...modified].sort(),
			})

			ctx.setMessages(() => [
				{ id: crypto.randomUUID(), role: "assistant" as const, content: `Context compacted:\n\n${summary}` },
			])
			ctx.setToolBlocks(() => [])
			ctx.setContextTokens(0)
			ctx.setCacheStats(null)
		} catch (err) {
			addSystemMessage(ctx, `Compact failed: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			ctx.setIsResponding(false)
			ctx.setActivityState("idle")
		}

		return true
	},
}

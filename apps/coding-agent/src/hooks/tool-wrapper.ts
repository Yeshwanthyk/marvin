/**
 * Tool wrapper - wraps tools with hook callbacks for interception.
 */

import type { AgentTool, AgentToolUpdateCallback } from "@marvin-agents/ai"
import type { HookRunner } from "./runner.js"

/**
 * Wrap a tool with hook callbacks.
 * - Emits tool.execute.before event (can block or modify input)
 * - Emits tool.execute.after event (can modify result, fires on errors too)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapToolWithHooks<TDetails>(
	tool: AgentTool<any, TDetails>,
	hookRunner: HookRunner
): AgentTool<any, TDetails> {
	return {
		...tool,
		execute: async (
			toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<TDetails>
		) => {
			const sessionId = hookRunner.getSessionId()

			// Emit tool.execute.before - hooks can block or modify input
			const beforeResult = await hookRunner.emitToolExecuteBefore({
				type: "tool.execute.before",
				sessionId,
				toolName: tool.name,
				toolCallId,
				input: params as Record<string, unknown>,
			})

			if (beforeResult?.block) {
				const reason = beforeResult.reason ?? "Tool execution was blocked by a hook"
				throw new Error(reason)
			}

			// Use potentially modified input
			const effectiveParams = beforeResult?.input ?? params

			try {
				// Execute the actual tool
				const result = await tool.execute(toolCallId, effectiveParams, signal, onUpdate)

				// Emit tool.execute.after - hooks can modify the result
				const afterResult = await hookRunner.emitToolExecuteAfter({
					type: "tool.execute.after",
					sessionId,
					toolName: tool.name,
					toolCallId,
					input: effectiveParams as Record<string, unknown>,
					content: result.content,
					details: result.details,
					isError: false,
				})

				if (afterResult) {
					return {
						content: afterResult.content ?? result.content,
						details: (afterResult.details ?? result.details) as TDetails,
					}
				}

				return result
			} catch (err) {
				// Emit tool.execute.after on errors too
				await hookRunner.emitToolExecuteAfter({
					type: "tool.execute.after",
					sessionId,
					toolName: tool.name,
					toolCallId,
					input: effectiveParams as Record<string, unknown>,
					content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
					details: undefined as TDetails,
					isError: true,
				})
				throw err
			}
		},
	}
}

/**
 * Wrap all tools with hook callbacks.
 */
export function wrapToolsWithHooks(
	tools: AgentTool<any, any>[],
	hookRunner: HookRunner
): AgentTool<any, any>[] {
	return tools.map((tool) => wrapToolWithHooks(tool, hookRunner))
}

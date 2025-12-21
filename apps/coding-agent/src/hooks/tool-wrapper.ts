/**
 * Tool wrapper - wraps tools with hook callbacks for interception.
 */

import type { AgentTool, AgentToolUpdateCallback } from "@marvin-agents/ai"
import type { HookRunner } from "./runner.js"

/**
 * Wrap a tool with hook callbacks.
 * - Emits tool.execute.before event (can block)
 * - Emits tool.execute.after event (can modify result)
 */
export function wrapToolWithHooks<TDetails>(
	tool: AgentTool<any, TDetails>,
	hookRunner: HookRunner
): AgentTool<any, TDetails> {
	return {
		...tool,
		execute: async (
			toolCallId: string,
			params: any,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<TDetails>
		) => {
			// Emit tool.execute.before - hooks can block execution
			if (hookRunner.hasHandlers("tool.execute.before")) {
				try {
					const callResult = await hookRunner.emitToolExecuteBefore({
						type: "tool.execute.before",
						toolName: tool.name,
						toolCallId,
						input: params,
					})

					if (callResult?.block) {
						const reason = callResult.reason || "Tool execution was blocked by a hook"
						throw new Error(reason)
					}
				} catch (err) {
					// Hook error or explicit block - fail-safe by throwing
					if (err instanceof Error) throw err
					throw new Error(`Hook failed, blocking execution: ${String(err)}`)
				}
			}

			// Execute the actual tool
			const result = await tool.execute(toolCallId, params, signal, onUpdate)

			// Emit tool.execute.after - hooks can modify the result
			if (hookRunner.hasHandlers("tool.execute.after")) {
				const afterResult = await hookRunner.emitToolExecuteAfter({
					type: "tool.execute.after",
					toolName: tool.name,
					toolCallId,
					input: params,
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
			}

			return result
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

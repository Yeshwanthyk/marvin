import type { AgentTool, AgentToolUpdateCallback, ImageContent, TextContent } from "@yeshwanthyk/ai"
import type { HookRunner } from "./runner.js"
import type { RegisteredTool, HookEventContext } from "./types.js"

/**
 * Converts a hook-registered tool to an AgentTool.
 */
export function createHookToolAdapter(
	tool: RegisteredTool,
	getContext: () => HookEventContext
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): AgentTool<any, unknown> {
	const parameters = tool.schema ?? tool.parameters ?? { type: "object", properties: {}, required: [] }
	return {
		name: tool.name,
		label: tool.label ?? tool.name,
		description: tool.description,
		parameters,
		async execute(toolCallId, params, signal, onUpdate: AgentToolUpdateCallback<unknown> | undefined) {
			try {
				const ctx = getContext()
				const forwardUpdate = onUpdate === undefined
					? undefined
					: (update: { content?: (TextContent | ImageContent)[]; details?: unknown }) => {
						onUpdate({ content: update.content ?? [], details: update.details })
					}
				const result = await tool.execute(toolCallId, params as Record<string, unknown>, signal, forwardUpdate, ctx)
				if (typeof result === "string") {
					const content: TextContent[] = [{ type: "text", text: result }]
					return { content, details: undefined }
				}
				const content: (TextContent | ImageContent)[] = Array.isArray(result.content)
					? result.content
					: [{ type: "text", text: "" }]
				return { content, details: result.details }
			} catch (err) {
				const errorText = err instanceof Error ? err.message : String(err)
				const content: TextContent[] = [{ type: "text", text: `Error: ${errorText}` }]
				return { content, details: undefined }
			}
		},
	}
}

/**
 * Get all hook-registered tools as AgentTools.
 */
export function getHookTools(hookRunner: HookRunner): AgentTool[] {
	return hookRunner.getRegisteredTools().map((tool) =>
		createHookToolAdapter(tool, () => hookRunner.getContext())
	)
}

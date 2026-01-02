import type { AgentTool, TextContent } from "@marvin-agents/ai"
import type { HookRunner } from "./runner.js"
import type { RegisteredTool, HookEventContext } from "./types.js"

/**
 * Converts a hook-registered tool to an AgentTool.
 */
export function createHookToolAdapter(
	tool: RegisteredTool,
	getContext: () => HookEventContext
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): AgentTool<any, undefined> {
	return {
		name: tool.name,
		label: tool.name,
		description: tool.description,
		parameters: {
			type: "object",
			properties: Object.fromEntries(
				Object.entries(tool.schema.properties).map(([key, prop]) => [
					key,
					{ type: prop.type, description: prop.description, enum: prop.enum },
				])
			),
			required: tool.schema.required ?? [],
		},
		async execute(_toolCallId, params, _signal, _onUpdate) {
			try {
				const result = await tool.execute(params as Record<string, unknown>, getContext())
				const content: TextContent[] = [{ type: "text", text: result }]
				return { content, details: undefined }
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

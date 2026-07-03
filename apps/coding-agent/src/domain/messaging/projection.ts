import type { AppMessage } from "@yeshwanthyk/agent-core"
import type { AgentToolResult, AssistantMessage, UserMessage } from "@yeshwanthyk/ai"
import type { Theme } from "@yeshwanthyk/open-tui"
import type { JSX } from "solid-js"
import type { RenderResultOptions } from "@yeshwanthyk/runtime-effect/extensibility/custom-tools/types.js"
import type { ToolBlock, UIAssistantMessage, UIContentBlock, UIMessage } from "../../types.js"
import {
	extractOrderedBlocks,
	extractThinking,
	extractToolCalls,
	extractText,
	getEditDiffText,
	getToolText,
	orderedBlocksToUiContentBlocks,
} from "./content.js"

export interface ToolProjectionMeta {
	label: string
	source: "builtin" | "custom"
	sourcePath?: string
	renderCall?: (args: unknown, theme: Theme) => JSX.Element
	renderResult?: (result: AgentToolResult<unknown>, opts: RenderResultOptions, theme: Theme) => JSX.Element
}

export interface ProjectionIdContext {
	sessionId: string
	messageIndex: number
}

export interface AssistantProjectionOptions {
	id: string
	toolByName?: Map<string, ToolProjectionMeta>
	toolResults?: Map<string, { output: string; editDiff: string | null; isError: boolean }>
	isStreaming?: boolean
}

export interface SessionMessagesToViewOptions {
	sessionId: string
	toolByName: Map<string, ToolProjectionMeta>
	shellInjectionPrefix: string
}

export interface SessionMessagesView {
	messages: UIMessage[]
	contextTokens: number
}

export const uiMessageId = (context: ProjectionIdContext, role: string): string =>
	`${context.sessionId}:message:${context.messageIndex}:${role}`

export const textFromUserMessage = (message: UserMessage): string => {
	const content = message.content
	return typeof content === "string" ? content : Array.isArray(content) ? extractText(content) : ""
}

const latestContextTokens = (messages: AppMessage[]): number => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message?.role === "assistant" && message.usage.totalTokens) return message.usage.totalTokens
	}
	return 0
}

const toolResultsById = (messages: AppMessage[]): Map<string, { output: string; editDiff: string | null; isError: boolean }> => {
	const results = new Map<string, { output: string; editDiff: string | null; isError: boolean }>()
	for (const message of messages) {
		if (message.role !== "toolResult") continue
		results.set(message.toolCallId, {
			output: getToolText(message),
			editDiff: getEditDiffText(message),
			isError: message.isError,
		})
	}
	return results
}

export const appMessageToUiAssistant = (
	message: AssistantMessage,
	options: AssistantProjectionOptions,
): UIAssistantMessage => {
	const text = extractText(message.content)
	const thinking = extractThinking(message.content)
	const toolCalls = extractToolCalls(message.content)
	const tools: ToolBlock[] = toolCalls.map((toolCall) => {
		const result = options.toolResults?.get(toolCall.id)
		const meta = options.toolByName?.get(toolCall.name)
		return {
			id: toolCall.id,
			name: toolCall.name,
			args: toolCall.args,
			output: result?.output,
			editDiff: result?.editDiff || undefined,
			isError: result?.isError ?? false,
			isComplete: result !== undefined,
			label: meta?.label,
			source: meta?.source,
			sourcePath: meta?.sourcePath,
			renderCall: meta?.renderCall,
			renderResult: meta?.renderResult,
		}
	})
	const toolsById = new Map(tools.map((tool) => [tool.id, tool]))
	const contentBlocks: UIContentBlock[] = orderedBlocksToUiContentBlocks(extractOrderedBlocks(message.content)).map((block): UIContentBlock => {
		if (block.type !== "tool") return block
		return { type: "tool", tool: toolsById.get(block.tool.id) ?? block.tool }
	})

	return {
		id: options.id,
		role: "assistant",
		content: text,
		thinking: thinking || undefined,
		isStreaming: options.isStreaming ?? false,
		tools,
		contentBlocks,
	}
}

export const sessionMessagesToView = (
	sessionMessages: AppMessage[],
	options: SessionMessagesToViewOptions,
): SessionMessagesView => {
	const toolResults = toolResultsById(sessionMessages)
	const messages: UIMessage[] = []

	for (let i = 0; i < sessionMessages.length; i++) {
		const message = sessionMessages[i]
		if (message === undefined) continue
		const id = uiMessageId({ sessionId: options.sessionId, messageIndex: i }, message.role)

		if (message.role === "user") {
			const content = textFromUserMessage(message)
			if (content.startsWith(options.shellInjectionPrefix)) continue
			messages.push({ id, role: "user", content })
		} else if (message.role === "assistant") {
			messages.push(appMessageToUiAssistant(message, {
				id,
				toolByName: options.toolByName,
				toolResults,
				isStreaming: false,
			}))
		} else if (message.role === "shell") {
			messages.push({
				id,
				role: "shell",
				command: message.command,
				output: message.output,
				exitCode: message.exitCode,
				truncated: message.truncated,
				tempFilePath: message.tempFilePath,
				timestamp: message.timestamp,
			})
		}
	}

	return { messages, contextTokens: latestContextTokens(sessionMessages) }
}

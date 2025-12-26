/**
 * ACP session/update notification emitter
 * Bridges agent events to ACP protocol notifications
 */

import type {
	SessionUpdate,
	SessionUpdateParams,
	SlashCommand,
	ModelOption,
	ToolCallKind,
	ToolCallStatus,
	JsonRpcNotification,
} from "./protocol.js"
import { makeNotification } from "./protocol.js"

export interface UpdateEmitter {
	emit(update: SessionUpdate): void
	emitCommands(commands: SlashCommand[]): void
	emitModels(availableModels: ModelOption[], currentModelId: string): void
}

export function createUpdateEmitter(
	sessionId: string,
	write: (notification: JsonRpcNotification) => void
): UpdateEmitter {
	const emit = (update: SessionUpdate): void => {
		const params: SessionUpdateParams = { sessionId, update }
		write(makeNotification("session/update", params))
	}

	return {
		emit,

		emitCommands(commands: SlashCommand[]): void {
			emit({ sessionUpdate: "available_commands_update", availableCommands: commands })
		},

		emitModels(availableModels: ModelOption[], currentModelId: string): void {
			emit({ sessionUpdate: "models_update", models: { availableModels, currentModelId } })
		},
	}
}

// ============================================================================
// Convenience builders for common updates
// ============================================================================

export function textChunk(text: string): SessionUpdate {
	return { sessionUpdate: "agent_message_chunk", content: { type: "text", text } }
}

export function thoughtChunk(text: string): SessionUpdate {
	return { sessionUpdate: "agent_thought_chunk", content: { type: "text", text } }
}

export function toolCall(
	toolCallId: string,
	title: string,
	kind: ToolCallKind,
	rawInput?: unknown
): SessionUpdate {
	return {
		sessionUpdate: "tool_call",
		toolCallId,
		title,
		kind,
		status: "pending",
		rawInput,
	}
}

export function toolCallUpdate(
	toolCallId: string,
	status: ToolCallStatus,
	content?: string,
	title?: string
): SessionUpdate {
	return {
		sessionUpdate: "tool_call_update",
		toolCallId,
		status,
		title,
		content: content ? [{ type: "text" as const, text: content }] : undefined,
	}
}

// Map tool names to ACP kinds
export function toolNameToKind(name: string): ToolCallKind {
	const lower = name.toLowerCase()
	if (lower === "read" || lower.includes("read")) return "read"
	if (lower === "write" || lower.includes("write")) return "write"
	if (lower === "edit" || lower.includes("edit")) return "edit"
	if (lower === "bash" || lower === "command" || lower.includes("terminal")) return "command"
	return "other"
}

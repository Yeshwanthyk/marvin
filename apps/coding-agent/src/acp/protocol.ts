/**
 * ACP (Agent Client Protocol) JSON-RPC 2.0 types
 * Spec: https://agentclientprotocol.com
 */

// ============================================================================
// JSON-RPC 2.0 Base Types
// ============================================================================

export interface JsonRpcRequest {
	jsonrpc: "2.0"
	id: number | string
	method: string
	params?: unknown
}

export interface JsonRpcResponse {
	jsonrpc: "2.0"
	id: number | string
	result?: unknown
	error?: JsonRpcError
}

export interface JsonRpcNotification {
	jsonrpc: "2.0"
	method: string
	params: unknown
}

export interface JsonRpcError {
	code: number
	message: string
	data?: unknown
}

// Standard JSON-RPC error codes
export const ErrorCodes = {
	ParseError: -32700,
	InvalidRequest: -32600,
	MethodNotFound: -32601,
	InvalidParams: -32602,
	InternalError: -32603,
} as const

// ============================================================================
// Initialize
// ============================================================================

export interface InitializeParams {
	protocolVersion: number
	clientInfo?: { name: string; version: string }
	clientCapabilities?: {
		fs?: { readTextFile?: boolean; writeTextFile?: boolean }
		terminal?: boolean
	}
}

export interface InitializeResult {
	protocolVersion: number
	agentInfo: { name: string; version: string }
	agentCapabilities: {
		promptCapabilities: { image: boolean; embeddedContext: boolean }
	}
	authMethods: Array<{ id: string; name: string; description: string }>
}

// ============================================================================
// Session
// ============================================================================

export interface NewSessionParams {
	cwd: string
	mcpServers?: unknown[]
}

export interface SlashCommand {
	name: string
	description: string
}

export interface ModelOption {
	modelId: string
	name: string
}

export interface NewSessionResult {
	sessionId: string
	availableCommands?: SlashCommand[]
	models?: {
		availableModels: ModelOption[]
		currentModelId: string
	}
}

export interface PromptParams {
	sessionId: string
	prompt: ContentBlock[]
}

export interface ContentBlock {
	type: "text" | "image" | "resource" | "resource_link"
	text?: string
	data?: string // base64 for images
	mimeType?: string
	uri?: string
}

export type StopReason = "end_turn" | "cancelled" | "max_turn_requests"

export interface PromptResult {
	stopReason: StopReason
}

export interface CancelParams {
	sessionId: string
}

export interface SetModeParams {
	sessionId: string
	mode: "default" | "acceptEdits" | "bypassPermissions" | "dontAsk" | "plan"
}

export interface SetModelParams {
	sessionId: string
	modelId: string
}

export interface SetModelResult {
	modelId: string
}

// ============================================================================
// Session Update (Agent → Client notifications)
// ============================================================================

export type SessionUpdateType =
	| "agent_message_chunk"
	| "user_message_chunk"
	| "agent_thought_chunk"
	| "tool_call"
	| "tool_call_update"
	| "plan"
	| "available_commands_update"
	| "current_mode_update"
	| "models_update"

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed"
export type ToolCallKind = "read" | "write" | "edit" | "command" | "other"

export interface SessionUpdateParams {
	sessionId: string
	update: SessionUpdate
}

export type SessionUpdate =
	| { sessionUpdate: "agent_message_chunk"; content: { type: "text"; text: string } }
	| { sessionUpdate: "user_message_chunk"; content: { type: "text"; text: string } }
	| { sessionUpdate: "agent_thought_chunk"; content: { type: "text"; text: string } }
	| {
			sessionUpdate: "tool_call"
			toolCallId: string
			title: string
			kind: ToolCallKind
			status: ToolCallStatus
			rawInput?: unknown
	  }
	| {
			sessionUpdate: "tool_call_update"
			toolCallId: string
			status: ToolCallStatus
			title?: string
			content?: Array<{ type: "text"; text: string }>
	  }
	| { sessionUpdate: "available_commands_update"; availableCommands: SlashCommand[] }
	| { sessionUpdate: "models_update"; models: { availableModels: ModelOption[]; currentModelId: string } }
	| { sessionUpdate: "current_mode_update"; currentModeId: string }

// ============================================================================
// Helpers
// ============================================================================

export function makeResponse(id: number | string, result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result }
}

export function makeError(id: number | string, code: number, message: string): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message } }
}

export function makeNotification(method: string, params: unknown): JsonRpcNotification {
	return { jsonrpc: "2.0", method, params }
}

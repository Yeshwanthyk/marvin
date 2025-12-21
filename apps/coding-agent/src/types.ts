/**
 * Shared types for TUI application
 */

export interface UIMessage {
	id: string
	role: "user" | "assistant"
	content: string
	thinking?: { summary: string; full: string }
	isStreaming?: boolean
	tools?: ToolBlock[]
	timestamp?: number
}

export interface ToolBlock {
	id: string
	name: string
	args: unknown
	output?: string
	editDiff?: string
	isError: boolean
	isComplete: boolean
}

export type ActivityState = "idle" | "thinking" | "streaming" | "tool"

export type ContentItem =
	| { type: "user"; content: string }
	| { type: "thinking"; id: string; summary: string; full: string; isStreaming?: boolean }
	| { type: "assistant"; content: string; isStreaming?: boolean }
	| { type: "tool"; tool: ToolBlock }

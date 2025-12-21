/**
 * Shared types for TUI application
 */

/** Content block that preserves order from API response */
export type UIContentBlock =
	| { type: "thinking"; id: string; summary: string; full: string }
	| { type: "text"; text: string }
	| { type: "tool"; tool: ToolBlock }

export interface UIMessage {
	id: string
	role: "user" | "assistant"
	content: string
	/** Ordered content blocks - preserves interleaving of thinking, text, tools */
	contentBlocks?: UIContentBlock[]
	/** @deprecated Use contentBlocks instead - kept for backward compat */
	thinking?: { summary: string; full: string }
	isStreaming?: boolean
	/** @deprecated Use contentBlocks instead - kept for backward compat */
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

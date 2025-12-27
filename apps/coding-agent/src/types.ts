/**
 * Shared types for TUI application
 */

/** Content block that preserves order from API response */
export type UIContentBlock =
	| { type: "thinking"; id: string; summary: string; full: string }
	| { type: "text"; text: string }
	| { type: "tool"; tool: ToolBlock }

/** User message */
export interface UIUserMessage {
	id: string
	role: "user"
	content: string
	timestamp?: number
}

/** Assistant message with optional tool calls and thinking */
export interface UIAssistantMessage {
	id: string
	role: "assistant"
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

/** Shell command execution result (from ! prefix) */
export interface UIShellMessage {
	id: string
	role: "shell"
	command: string
	output: string
	exitCode: number | null
	truncated: boolean
	tempFilePath?: string
	timestamp?: number
}

export type UIMessage = UIUserMessage | UIAssistantMessage | UIShellMessage

import type { AgentToolResult } from "@marvin-agents/ai"
import type { Theme } from "@marvin-agents/open-tui"
import type { JSX } from "solid-js"
import type { RenderResultOptions } from "./custom-tools/types.js"

export interface ToolBlock {
	id: string
	name: string
	args: unknown
	/** Monotonic counter to invalidate UI caches on tool updates */
	updateSeq?: number
	output?: string
	editDiff?: string
	isError: boolean
	isComplete: boolean
	// Custom tool metadata
	label?: string
	source?: "builtin" | "custom"
	sourcePath?: string
	result?: AgentToolResult<any>
	renderCall?: (args: any, theme: Theme) => JSX.Element
	renderResult?: (result: AgentToolResult<any>, opts: RenderResultOptions, theme: Theme) => JSX.Element
}

export type ActivityState = "idle" | "thinking" | "streaming" | "tool" | "compacting"

/** Grouped section for display - thinking header with nested tools */
export interface SectionItem {
	type: "section"
	id: string
	thinking: { id: string; summary: string; full: string } | null
	tools: ToolBlock[]
	isComplete: boolean // true when all tools complete
}

export type ContentItem =
	| { type: "user"; content: string }
	| { type: "thinking"; id: string; summary: string; full: string; isStreaming?: boolean }
	| { type: "assistant"; content: string; isStreaming?: boolean }
	| { type: "tool"; tool: ToolBlock }
	| { type: "section"; section: SectionItem }
	| { type: "shell"; command: string; output: string; exitCode: number | null; truncated: boolean; tempFilePath?: string }

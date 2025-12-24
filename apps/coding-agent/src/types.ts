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

export type ContentItem =
	| { type: "user"; content: string }
	| { type: "thinking"; id: string; summary: string; full: string; isStreaming?: boolean }
	| { type: "assistant"; content: string; isStreaming?: boolean }
	| { type: "tool"; tool: ToolBlock }

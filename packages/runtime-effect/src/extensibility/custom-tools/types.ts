/**
 * Custom tool types for user-defined tools.
 */

import type { AgentTool, AgentToolResult } from "@yeshwanthyk/ai"
import type { JSX } from "solid-js"
import type { ValidationIssue } from "../schema.js"
import type { HookTheme } from "../../hooks/types.js"

/**
 * Options passed to custom tool result renderers.
 */
export interface RenderResultOptions {
	expanded: boolean
	isPartial: boolean
}

/**
 * Session lifecycle event types for custom tools.
 */
export type SessionEvent =
	| { type: "session.start"; sessionId: string }
	| { type: "session.resume"; sessionId: string }
	| { type: "session.end"; sessionId: string }

/**
 * Extended AgentTool with optional UI hooks for first-class rendering.
 * Uses `any` for TParams to avoid TypeBox version constraint issues.
 */
export interface CustomAgentTool<TDetails = any> extends AgentTool<any, TDetails> {
	/** Custom header/call rendering */
	renderCall?: (args: any, theme: HookTheme) => JSX.Element
	/** Custom result rendering */
	renderResult?: (result: AgentToolResult<TDetails>, opts: RenderResultOptions, theme: HookTheme) => JSX.Element
	/** Session lifecycle hook */
	onSession?: (ev: SessionEvent) => void | Promise<void>
	/** Cleanup on app exit */
	dispose?: () => void | Promise<void>
}

/**
 * Result from executing a command.
 */
export interface ExecResult {
	stdout: string
	stderr: string
	code: number
	killed: boolean
}

/**
 * Options for command execution.
 */
export interface ExecOptions {
	/** Timeout in milliseconds */
	timeout?: number
	/** Abort signal for cancellation */
	signal?: AbortSignal
}

/**
 * Ref for send handler - allows late binding of the send function.
 */
export type SendRef = { current: (text: string) => void }

/**
 * API provided to custom tool factories.
 */
export interface ToolAPI {
	/** Current working directory */
	cwd: string
	/** Whether running in interactive mode (TUI). False for headless/ACP modes. */
	hasUI: boolean
	/** Execute a command */
	exec: (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>
	/** Send a message to the agent (queued as user input) */
	send: (text: string) => void
}

/**
 * Factory function that creates one or more tools.
 * Default export from tool modules.
 */
export type CustomToolFactory = (
	api: ToolAPI,
) => CustomAgentTool | CustomAgentTool[] | Promise<CustomAgentTool | CustomAgentTool[]>

/**
 * A loaded custom tool with its source path.
 */
export interface LoadedCustomTool {
	/** Original file path */
	path: string
	/** Resolved absolute path */
	resolvedPath: string
	/** The loaded tool */
	tool: CustomAgentTool
}

/**
 * Result of loading custom tools.
 */
export interface CustomToolsLoadResult {
	tools: LoadedCustomTool[]
	issues: ValidationIssue[]
}

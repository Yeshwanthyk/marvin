/**
 * Custom tool types for user-defined tools.
 */

import type { AgentTool } from "@marvin-agents/ai"

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
 * API provided to custom tool factories.
 */
export interface ToolAPI {
	/** Current working directory */
	cwd: string
	/** Execute a command */
	exec: (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>
}

/**
 * Factory function that creates one or more tools.
 * Default export from tool modules.
 */
export type CustomToolFactory = (api: ToolAPI) => AgentTool | AgentTool[] | Promise<AgentTool | AgentTool[]>

/**
 * A loaded custom tool with its source path.
 */
export interface LoadedCustomTool {
	/** Original file path */
	path: string
	/** Resolved absolute path */
	resolvedPath: string
	/** The loaded tool */
	tool: AgentTool
}

/**
 * Result of loading custom tools.
 */
export interface CustomToolsLoadResult {
	tools: LoadedCustomTool[]
	errors: Array<{ path: string; error: string }>
}

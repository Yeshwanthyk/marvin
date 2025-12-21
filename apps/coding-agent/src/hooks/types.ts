/**
 * Hook system types.
 *
 * Hooks are TypeScript modules that subscribe to agent lifecycle events.
 * Load from ~/.config/marvin/hooks/*.ts
 */

import type { AppMessage, ThinkingLevel } from "@marvin-agents/agent-core"
import type { AgentTool, ImageContent, TextContent, ToolResultMessage } from "@marvin-agents/ai"

// ============================================================================
// Execution Context
// ============================================================================

/** Result of executing a command via ctx.exec() */
export interface ExecResult {
	stdout: string
	stderr: string
	code: number
	killed?: boolean
}

export interface ExecOptions {
	signal?: AbortSignal
	timeout?: number
}

/** Context passed to hook event handlers */
export interface HookEventContext {
	/** Execute a shell command */
	exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>
	/** Current working directory */
	cwd: string
	/** Config directory (~/.config/marvin) */
	configDir: string
}

// ============================================================================
// Events
// ============================================================================

/** Fired after config load, before agent starts */
export interface AppStartEvent {
	type: "app.start"
}

/** Fired when session starts/resumes/clears */
export interface SessionEvent {
	type: "session.start" | "session.resume" | "session.clear"
	sessionId: string | null
}

/** Fired when agent loop starts (once per user prompt) */
export interface AgentStartEvent {
	type: "agent.start"
}

/** Fired when agent loop ends */
export interface AgentEndEvent {
	type: "agent.end"
	messages: AppMessage[]
}

/** Fired when a turn starts (one LLM call cycle) */
export interface TurnStartEvent {
	type: "turn.start"
	turnIndex: number
}

/** Fired when a turn ends */
export interface TurnEndEvent {
	type: "turn.end"
	turnIndex: number
	message: AppMessage
	toolResults: ToolResultMessage[]
}

/** Fired before a tool executes. Hooks can block. */
export interface ToolExecuteBeforeEvent {
	type: "tool.execute.before"
	toolName: string
	toolCallId: string
	input: Record<string, unknown>
}

/** Fired after a tool executes. Hooks can modify result. */
export interface ToolExecuteAfterEvent {
	type: "tool.execute.after"
	toolName: string
	toolCallId: string
	input: Record<string, unknown>
	content: (TextContent | ImageContent)[]
	details: unknown
	isError: boolean
}

/** Union of all hook event types */
export type HookEvent =
	| AppStartEvent
	| SessionEvent
	| AgentStartEvent
	| AgentEndEvent
	| TurnStartEvent
	| TurnEndEvent
	| ToolExecuteBeforeEvent
	| ToolExecuteAfterEvent

// ============================================================================
// Event Results
// ============================================================================

/** Return type for tool.execute.before handlers - can block execution */
export interface ToolExecuteBeforeResult {
	block?: boolean
	reason?: string
}

/** Return type for tool.execute.after handlers - can modify result */
export interface ToolExecuteAfterResult {
	content?: (TextContent | ImageContent)[]
	details?: unknown
	isError?: boolean
}

// ============================================================================
// Hook API
// ============================================================================

/** Handler function type */
export type HookHandler<E, R = void> = (event: E, ctx: HookEventContext) => Promise<R> | R

/** Event type string literals */
export type HookEventType = HookEvent["type"]

/** Map event type to event data */
export interface HookEventMap {
	"app.start": AppStartEvent
	"session.start": SessionEvent
	"session.resume": SessionEvent
	"session.clear": SessionEvent
	"agent.start": AgentStartEvent
	"agent.end": AgentEndEvent
	"turn.start": TurnStartEvent
	"turn.end": TurnEndEvent
	"tool.execute.before": ToolExecuteBeforeEvent
	"tool.execute.after": ToolExecuteAfterEvent
}

/** Map event type to result type */
export interface HookResultMap {
	"app.start": void
	"session.start": void
	"session.resume": void
	"session.clear": void
	"agent.start": void
	"agent.end": void
	"turn.start": void
	"turn.end": void
	"tool.execute.before": ToolExecuteBeforeResult | undefined
	"tool.execute.after": ToolExecuteAfterResult | undefined
}

/**
 * HookAPI passed to hook factory functions.
 * Hooks use marvin.on() to subscribe to events and marvin.send() to inject messages.
 */
export interface HookAPI {
	on<T extends HookEventType>(
		event: T,
		handler: HookHandler<HookEventMap[T], HookResultMap[T]>
	): void
	
	/**
	 * Send a message to the agent.
	 * If agent is streaming, message is queued.
	 * If agent is idle, triggers a new agent loop.
	 */
	send(text: string): void
}

/**
 * Hook factory function type.
 * Hooks export a default function that receives the HookAPI.
 */
export type HookFactory = (marvin: HookAPI) => void | Promise<void>

// ============================================================================
// Errors
// ============================================================================

/** Error emitted when a hook fails */
export interface HookError {
	hookPath: string
	event: string
	error: string
}

/**
 * Hook system types.
 *
 * Hooks are TypeScript modules that subscribe to agent lifecycle events.
 * Load from ~/.config/marvin/hooks/*.ts
 */

import type { AppMessage } from "@yeshwanthyk/agent-core"
import type { Api, ImageContent, Message, Model, SimpleStreamOptions, TextContent, ToolResultMessage } from "@yeshwanthyk/ai"
import type { JSX } from "solid-js"
import type { ReadonlySessionManager } from "../session-manager.js"
import type { PromptDeliveryMode } from "../session/prompt-queue.js"

export interface HookTheme {
	name?: string
	mode?: string
	readonly [key: string]: unknown
}

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
	/** Current session ID (null if no session) */
	sessionId: string | null
	/** Read-only session manager for accessing session data */
	sessionManager: ReadonlySessionManager
	/** Current model (null if not set) */
	model: Model<Api> | null
	/** UI context for prompts/notifications */
	ui: HookUIContext
	/** Whether UI is available (false in headless/ACP) */
	hasUI: boolean
	/** Session operations (summarize, toast, etc.) */
	session: HookSessionContext
	/** Delivery-aware helpers */
	isIdle(): boolean
	steer(text: string): Promise<void>
	followUp(text: string): Promise<void>
	sendUserMessage(text: string, options?: { deliverAs?: PromptDeliveryMode }): Promise<void>
}

// ============================================================================
// UI Context + Messages + Commands
// ============================================================================

/** UI context for hook prompts and notifications */
export interface HookUIContext {
	select(title: string, options: string[]): Promise<string | undefined>
	confirm(title: string, message: string): Promise<boolean>
	input(title: string, placeholder?: string): Promise<string | undefined>
	editor(title: string, initialText?: string): Promise<string | undefined>
	notify(message: string, type?: "info" | "warning" | "error"): void
	custom<T>(factory: (done: (result: T) => void) => JSX.Element): Promise<T | undefined>
	setEditorText(text: string): void
	getEditorText(): string
}

/** Token usage stats */
export interface TokenUsage {
	input: number
	output: number
	cacheRead?: number
	cacheWrite?: number
	total: number
}

/** Result from an LLM completion */
export interface CompletionResult {
	text: string
	stopReason: "end" | "tool_use" | "max_tokens" | "aborted" | "error"
}

/** Session operations available to hooks */
export interface HookSessionContext {
	/** Trigger session compaction/summarization */
	summarize(): Promise<void>
	/** Show toast notification (TUI only, no-op in headless) */
	toast(title: string, message: string, variant?: "info" | "warning" | "success" | "error"): void
	/** Get current token usage for the session */
	getTokenUsage(): TokenUsage | undefined
	/** Get model context limit */
	getContextLimit(): number | undefined
	/** Create a new session, optionally linking to parent */
	newSession(opts?: { parentSession?: string }): Promise<{ cancelled: boolean; sessionId?: string }>
	/** Get API key for a model's provider (may not work for OAuth) */
	getApiKey(model: Model<Api>): Promise<string | undefined>
	/** Make an LLM completion using the app's transport (handles OAuth, etc.) */
	complete(systemPrompt: string, userText: string): Promise<CompletionResult>
}

/** Message part (text or image) */
export type MessagePart = TextContent | ImageContent

/** Hook-injected message */
export interface HookMessage<T = unknown> {
	role: "hookMessage"
	customType: string
	content: string | MessagePart[]
	display: boolean
	details?: T
	timestamp: number
}

/** Registered slash command from a hook */
export interface RegisteredCommand {
	name: string
	description?: string
	handler: (args: string, ctx: HookEventContext) => Promise<void>
}

/** Renderer for hook messages */
export type HookMessageRenderer<T = unknown> = (
	message: HookMessage<T>,
	options: { expanded: boolean },
	theme: HookTheme
) => JSX.Element | undefined

/** Schema for hook-registered tool */
export interface HookToolSchema {
	type: "object"
	properties: Record<string, {
		type: "string" | "number" | "boolean" | "array" | "object"
		description?: string
		enum?: string[]
		optional?: boolean
	}>
	required?: string[]
}

/** Tool registered by a hook */
export interface RegisteredTool {
	name: string
	description: string
	schema: HookToolSchema
	execute: (args: Record<string, unknown>, ctx: HookEventContext) => Promise<string>
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
	sessionId: string | null
}

/** Fired when agent loop ends */
export interface AgentEndEvent {
	type: "agent.end"
	sessionId: string | null
	messages: AppMessage[]
	totalTokens: TokenUsage
	contextLimit: number
}

/** Fired when a turn starts (one LLM call cycle) */
export interface TurnStartEvent {
	type: "turn.start"
	sessionId: string | null
	turnIndex: number
}

/** Context usage info for hooks */
export interface ContextUsage {
	/** Current token count */
	current: number
	/** Max context window */
	max: number
	/** Usage percentage (0-100) */
	percent: number
}

/** Fired when a turn ends */
export interface TurnEndEvent {
	type: "turn.end"
	sessionId: string | null
	turnIndex: number
	message: AppMessage
	toolResults: ToolResultMessage[]
	tokens: TokenUsage
	contextLimit: number
	/** @deprecated Use tokens and contextLimit instead */
	usage?: ContextUsage
}

/** Fired before a tool executes. Hooks can block or modify input. */
export interface ToolExecuteBeforeEvent {
	type: "tool.execute.before"
	sessionId: string | null
	toolName: string
	toolCallId: string
	input: Record<string, unknown>
}

/** Fired after a tool executes. Hooks can modify result. */
export interface ToolExecuteAfterEvent<TDetails = unknown> {
	type: "tool.execute.after"
	sessionId: string | null
	toolName: string
	toolCallId: string
	input: Record<string, unknown>
	content: (TextContent | ImageContent)[]
	details: TDetails
	isError: boolean
}

/** Fired before agent starts, allows injecting context */
export interface BeforeAgentStartEvent {
	type: "agent.before_start"
	prompt: string
	images?: ImageContent[]
}

/** Result from agent.before_start handler */
export interface BeforeAgentStartResult {
	message?: Pick<HookMessage, "customType" | "content" | "display" | "details">
}

/** Mutates user input before sending to LLM */
export interface ChatMessageEvent {
	type: "chat.message"
	input: { sessionId: string | null; text: string }
	output: { parts: MessagePart[] }
}

/** Transforms full message history before LLM call */
export interface ChatMessagesTransformEvent {
	type: "chat.messages.transform"
	messages: Message[]
}

/** Transforms system prompt before LLM call */
export interface ChatSystemTransformEvent {
	type: "chat.system.transform"
	input: { sessionId: string | null; systemPrompt: string }
	output: { systemPrompt: string }
}

/** Mutates stream options before LLM call */
export interface ChatParamsEvent {
	type: "chat.params"
	input: { sessionId: string | null }
	output: { streamOptions: SimpleStreamOptions }
}

/** Provides auth overrides per request */
export interface AuthGetEvent {
	type: "auth.get"
	input: { sessionId: string | null; provider: string; modelId: string }
	output: { apiKey?: string; headers?: Record<string, string>; baseUrl?: string }
}

/** Resolves/overrides model for request */
export interface ModelResolveEvent {
	type: "model.resolve"
	input: { sessionId: string | null; model: Model<Api> }
	output: { model: Model<Api> }
}

/** Fired before session compaction */
export interface SessionBeforeCompactEvent {
	type: "session.before_compact"
	input: { sessionId: string | null }
	output: { cancel?: boolean; prompt?: string; context?: string[] }
}

/** Fired after session compaction completes */
export interface SessionCompactEvent {
	type: "session.compact"
	sessionId: string | null
	summary: string
}

/** Fired when session/app is shutting down */
export interface SessionShutdownEvent {
	type: "session.shutdown"
	sessionId: string | null
}

/** Union of all hook event types */
export type HookEvent =
	| AppStartEvent
	| SessionEvent
	| SessionBeforeCompactEvent
	| SessionCompactEvent
	| SessionShutdownEvent
	| BeforeAgentStartEvent
	| AgentStartEvent
	| AgentEndEvent
	| TurnStartEvent
	| TurnEndEvent
	| ToolExecuteBeforeEvent
	| ToolExecuteAfterEvent
	| ChatMessageEvent
	| ChatMessagesTransformEvent
	| ChatSystemTransformEvent
	| ChatParamsEvent
	| AuthGetEvent
	| ModelResolveEvent

// ============================================================================
// Event Results
// ============================================================================

/** Return type for tool.execute.before handlers - can block execution or modify input */
export interface ToolExecuteBeforeResult {
	block?: boolean
	reason?: string
	/** Modified input to use instead of original */
	input?: Record<string, unknown>
}

/** Return type for tool.execute.after handlers - can modify result */
export interface ToolExecuteAfterResult<TDetails = unknown> {
	content?: (TextContent | ImageContent)[]
	details?: TDetails
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
	"session.before_compact": SessionBeforeCompactEvent
	"session.compact": SessionCompactEvent
	"session.shutdown": SessionShutdownEvent
	"agent.before_start": BeforeAgentStartEvent
	"agent.start": AgentStartEvent
	"agent.end": AgentEndEvent
	"turn.start": TurnStartEvent
	"turn.end": TurnEndEvent
	"tool.execute.before": ToolExecuteBeforeEvent
	"tool.execute.after": ToolExecuteAfterEvent
	"chat.message": ChatMessageEvent
	"chat.messages.transform": ChatMessagesTransformEvent
	"chat.system.transform": ChatSystemTransformEvent
	"chat.params": ChatParamsEvent
	"auth.get": AuthGetEvent
	"model.resolve": ModelResolveEvent
}

/** Map event type to result type */
export interface HookResultMap {
	"app.start": void
	"session.start": void
	"session.resume": void
	"session.clear": void
	"session.before_compact": void
	"session.compact": void
	"session.shutdown": void
	"agent.before_start": BeforeAgentStartResult | undefined
	"agent.start": void
	"agent.end": void
	"turn.start": void
	"turn.end": void
	"tool.execute.before": ToolExecuteBeforeResult | undefined
	"tool.execute.after": ToolExecuteAfterResult | undefined
	"chat.message": void
	"chat.messages.transform": void
	"chat.system.transform": void
	"chat.params": void
	"auth.get": void
	"model.resolve": void
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
	/**
	 * Send a user message with explicit delivery mode.
	 * Defaults to follow-up when agent is busy, otherwise triggers a new turn.
	 */
	sendUserMessage(text: string, options?: { deliverAs?: PromptDeliveryMode }): Promise<void>
	/** Queue steering instructions or send immediately if idle. */
	steer(text: string): Promise<void>
	/** Queue follow-up instructions or send immediately if idle. */
	followUp(text: string): Promise<void>
	/** True when the agent is not currently streaming or running tools. */
	isIdle(): boolean

	/**
	 * Send a hook message to the agent.
	 * Message is persisted and optionally triggers a new turn.
	 */
	sendMessage<T = unknown>(
		message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
		triggerTurn?: boolean,
	): void

	/**
	 * Append a custom entry to the session log.
	 * Does not affect agent state, only persists data.
	 */
	appendEntry<T = unknown>(customType: string, data?: T): void

	/**
	 * Register a custom renderer for hook messages of a given type.
	 */
	registerMessageRenderer<T = unknown>(customType: string, renderer: HookMessageRenderer<T>): void

	/**
	 * Register a slash command.
	 */
	registerCommand(name: string, options: { description?: string; handler: RegisteredCommand["handler"] }): void

	/**
	 * Register a tool that will be available to the agent.
	 */
	registerTool(tool: RegisteredTool): void
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

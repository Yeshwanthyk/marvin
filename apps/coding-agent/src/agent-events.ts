/**
 * Agent event handler for TUI application
 */

import { batch } from "solid-js"
import { profile } from "./profiler.js"
import type { AgentEvent, AppMessage } from "@yeshwanthyk/agent-core"
import type { AgentToolResult, AssistantMessage, ToolResultMessage } from "@yeshwanthyk/ai"
import type { Theme } from "@yeshwanthyk/open-tui"
import type { JSX } from "solid-js"
import type { SessionManager } from "./session-manager.js"
import type { UIMessage, UIAssistantMessage, ToolBlock, ActivityState, UIContentBlock } from "./types.js"
import {
	appendWithCap,
	extractStreamingSnapshot,
	extractText,
	getEditDiffText,
	getToolText,
} from "@domain/messaging/content.js"
import { appMessageToUiAssistant } from "@domain/messaging/projection.js"
import type { PromptQueue } from "./hooks/usePromptQueue.js"
import type { HookRunner } from "./hooks/index.js"
import type { RenderResultOptions } from "@yeshwanthyk/runtime-effect/extensibility/custom-tools/types.js"

/** Tool metadata for UI rendering */
export interface ToolMeta {
	label: string
	source: "builtin" | "custom"
	sourcePath?: string
	renderCall?: (args: unknown, theme: Theme) => JSX.Element
	renderResult?: (result: AgentToolResult<unknown>, opts: RenderResultOptions, theme: Theme) => JSX.Element
}

export interface EventHandlerContext {
	// State setters
	setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void
	setToolBlocks: (updater: (prev: ToolBlock[]) => ToolBlock[]) => void
	setActivityState: (s: ActivityState) => void
	setIsResponding: (v: boolean) => void
	setContextTokens: (v: number) => void
	setCacheStats: (v: { cacheRead: number; input: number } | null) => void
	setRetryStatus: (v: string | null) => void
	setTurnCount: (v: number) => void

	// Queue management
	promptQueue: PromptQueue

	// Session management
	sessionManager: SessionManager

	// Streaming message tracking (mutable ref)
	streamingMessageId: { current: string | null }

	// Retry configuration
	retryConfig: { enabled: boolean; maxRetries: number; baseDelayMs: number }
	retryablePattern: RegExp
	retryState: { attempt: number; abortController: AbortController | null }

	// Agent reference for retry logic
	agent: {
		getMessages: () => AppMessage[]
		replaceMessages: (messages: AppMessage[]) => void
		continue: () => Promise<void>
	}

	// Hook runner for lifecycle events (optional for backwards compat)
	hookRunner?: HookRunner

	// Tool metadata registry for custom tool rendering
	toolByName?: Map<string, ToolMeta>

	// Context window getter for usage calculations
	getContextWindow?: () => number
}

export type AgentEventHandler = ((event: AgentEvent) => void) & { dispose: () => void }

const UPDATE_THROTTLE_MS = 60 // ~16fps during streaming: smooth without repainting every token.
const UPDATE_THROTTLE_SLOW_MS = 90
const UPDATE_THROTTLE_SLOWEST_MS = 130
const TOOL_UPDATE_THROTTLE_MS = 50 // Throttle tool streaming updates
const STREAMING_TAIL_CHARS = 4000

function computeUpdateThrottleMs(textLength: number): number {
	if (textLength > 12000) return UPDATE_THROTTLE_SLOWEST_MS
	if (textLength > 6000) return UPDATE_THROTTLE_SLOW_MS
	return UPDATE_THROTTLE_MS
}

/** Type guard to check if a message is an AppMessage */
function isAppMessage(message: unknown): message is AppMessage {
	return typeof message === "object" && 
		message !== null && 
		"role" in message &&
		typeof (message as any).role === "string" &&
		["user", "assistant", "toolResult"].includes((message as any).role)
}

/** Type guard to check if a message is an AssistantMessage */
function isAssistantMessage(message: unknown): message is AssistantMessage {
	return typeof message === "object" && 
		message !== null && 
		"role" in message &&
		(message as any).role === "assistant" &&
		"content" in message &&
		Array.isArray((message as any).content)
}

/** Type guard to check if tool results array is valid */
function isToolResultMessageArray(toolResults: unknown): toolResults is ToolResultMessage[] {
	return Array.isArray(toolResults) && 
		toolResults.every(result => 
			typeof result === "object" && 
			result !== null && 
			"role" in result &&
			(result as any).role === "toolResult"
		)
}

/** Type guard to check if an object has usage statistics */
function hasUsageStats(obj: unknown): obj is { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number } } {
	return typeof obj === "object" && obj !== null
}

/** Type guard to check if an object has basic usage info */
function hasBasicUsage(obj: unknown): obj is { usage?: { totalTokens?: number; cacheRead?: number; input?: number } } {
	return typeof obj === "object" && obj !== null
}

/** Type guard to check if message has content array */
function hasContentArray(message: unknown): message is { content: unknown[] } {
	return typeof message === "object" && 
		message !== null && 
		"content" in message &&
		Array.isArray((message as any).content)
}

type ExtractionCache = ReturnType<typeof extractStreamingSnapshot>

function createExtractionCache(): ExtractionCache {
	return {
		textLength: 0,
		textTail: "",
		thinking: null,
		contentBlocks: [],
	}
}

export function createAgentEventHandler(ctx: EventHandlerContext): AgentEventHandler {
	let pendingUpdate: Extract<AgentEvent, { type: "message_update" }> | null = null
	let updateTimeout: ReturnType<typeof setTimeout> | null = null
	let disposed = false
	let turnIndex = 0
	
	// Streaming extraction cache - reset on each new assistant message.
	let extractionCache = createExtractionCache()
	
	// Tool update throttling - track pending updates per tool
	const pendingToolUpdates = new Map<string, Extract<AgentEvent, { type: "tool_execution_update" }>>()
	let toolUpdateTimeout: ReturnType<typeof setTimeout> | null = null

	const dispose = () => {
		disposed = true
		pendingUpdate = null
		pendingToolUpdates.clear()
		extractionCache = createExtractionCache()
		if (updateTimeout) clearTimeout(updateTimeout)
		if (toolUpdateTimeout) clearTimeout(toolUpdateTimeout)
		updateTimeout = null
		toolUpdateTimeout = null
	}

	// Inline update handler - accesses extractionCache from closure
	const handleMessageUpdate = (ev: Extract<AgentEvent, { type: "message_update" }>) =>
		profile("stream_message_update", () => {
			if (!hasContentArray(ev.message)) return
			const content = ev.message.content

			// Rebuild the small block snapshot. Providers mutate the current content
			// block in place, so block count alone cannot tell us whether text changed.
			extractionCache = extractStreamingSnapshot(content, STREAMING_TAIL_CHARS)
			const { textLength, textTail, thinking, contentBlocks } = extractionCache
			updateThrottleMs = computeUpdateThrottleMs(textLength)

			updateStreamingMessage(ctx, (msg) => {
				const nextThinking = thinking || msg.thinking
				return { ...msg, content: textTail, thinking: nextThinking, contentBlocks }
			})

			if (thinking && textLength === 0) ctx.setActivityState("thinking")
		})
	
	const flushPendingUpdate = () => {
		if (!pendingUpdate) return
		const event = pendingUpdate
		pendingUpdate = null
		handleMessageUpdate(event)
	}

	let updateThrottleMs = UPDATE_THROTTLE_MS

	const scheduleUpdate = () => {
		if (updateTimeout) return
		updateTimeout = setTimeout(() => {
			updateTimeout = null
			if (disposed) return
			flushPendingUpdate()
		}, updateThrottleMs)
	}
	
	const flushToolUpdates = () => {
		if (pendingToolUpdates.size === 0) return
		for (const event of pendingToolUpdates.values()) {
			handleToolUpdateImmediate(event, ctx)
		}
		pendingToolUpdates.clear()
	}
	
	const scheduleToolUpdate = () => {
		if (toolUpdateTimeout) return
		toolUpdateTimeout = setTimeout(() => {
			toolUpdateTimeout = null
			if (disposed) return
			flushToolUpdates()
		}, TOOL_UPDATE_THROTTLE_MS)
	}

	const handleEvent = (event: AgentEvent) => {
		if (disposed) return

		// Emit hook events for agent lifecycle (fire-and-forget)
		if (event.type === "agent_start") {
			turnIndex = 0
			ctx.setTurnCount(0) // Reset turn count for new agent run
			extractionCache = createExtractionCache() // Reset for new agent run
			void ctx.hookRunner?.emit({
				type: "agent.start",
				sessionId: ctx.sessionManager.sessionId,
			})
		}

		if (event.type === "turn_start") {
			ctx.setTurnCount(turnIndex + 1) // Update UI with current turn (1-indexed for display)
			void ctx.hookRunner?.emit({
				type: "turn.start",
				sessionId: ctx.sessionManager.sessionId,
				turnIndex,
			})
		}

		if (event.type === "turn_end") {
			// Extract usage from message for hook consumption
			const contextWindow = ctx.getContextWindow?.() ?? 0
			const currentTokens = hasUsageStats(event.message) ? (event.message.usage?.totalTokens ?? 0) : 0

			const tokens = {
				input: hasUsageStats(event.message) ? (event.message.usage?.inputTokens ?? 0) : 0,
				output: hasUsageStats(event.message) ? (event.message.usage?.outputTokens ?? 0) : 0,
				cacheRead: hasUsageStats(event.message) ? event.message.usage?.cacheReadInputTokens : undefined,
				cacheWrite: hasUsageStats(event.message) ? event.message.usage?.cacheCreationInputTokens : undefined,
				total: currentTokens,
			}

			// Update hook runner with token usage for session context
			ctx.hookRunner?.updateTokenUsage(tokens, contextWindow)

			if (isToolResultMessageArray(event.toolResults)) {
				void ctx.hookRunner?.emit({
					type: "turn.end",
					sessionId: ctx.sessionManager.sessionId,
					turnIndex,
					message: event.message,
					toolResults: event.toolResults,
					tokens,
					contextLimit: contextWindow,
					usage: contextWindow > 0 && currentTokens > 0
						? { current: currentTokens, max: contextWindow, percent: (currentTokens / contextWindow) * 100 }
						: undefined,
				})
			}
			turnIndex++
		}

		if (event.type === "message_start") {
			handleMessageStart(event, ctx, { current: extractionCache, set: (c) => { extractionCache = c } })
		}

		if (event.type === "message_update" && event.message.role === "assistant") {
			pendingUpdate = event
			scheduleUpdate()
		}

		if (event.type === "message_end" && event.message.role === "assistant") {
			pendingUpdate = null
			handleMessageEnd(event, ctx)
		}

		if (event.type === "message_end" && event.message.role === "toolResult") {
			// Persist tool results so sessions can be resumed with tool output context.
			if (isAppMessage(event.message)) {
				ctx.sessionManager.appendMessage(event.message)
			}
		}

		if (event.type === "tool_execution_start") {
			handleToolStart(event, ctx)
		}

		if (event.type === "tool_execution_update") {
			// Throttle tool updates - coalesce per tool
			pendingToolUpdates.set(event.toolCallId, event)
			scheduleToolUpdate()
		}

		if (event.type === "tool_execution_end") {
			// Clear any pending throttled update for this tool
			pendingToolUpdates.delete(event.toolCallId)
			handleToolEnd(event, ctx)
		}

		if (event.type === "turn_end") {
			ctx.streamingMessageId.current = null
		}

		if (event.type === "agent_end") {
			handleAgentEnd(event, ctx)
		}
	}
	
	const handler: AgentEventHandler = Object.assign(handleEvent, { dispose })
	return handler
}

function updateStreamingMessage(ctx: EventHandlerContext, updater: (msg: UIAssistantMessage) => UIAssistantMessage): void {
	const streamingId = ctx.streamingMessageId.current
	if (!streamingId) return

	ctx.setMessages((prev) => {
		if (prev.length === 0) return prev

		const lastIdx = prev.length - 1
		const last = prev[lastIdx]
		if (last?.id === streamingId && last.role === "assistant") {
			const nextLast = updater(last)
			if (nextLast === last) return prev
			const next = prev.slice()
			next[lastIdx] = nextLast
			return next
		}

		const idx = prev.findIndex((m) => m.id === streamingId)
		if (idx === -1) return prev

		const current = prev[idx]
		if (!current || current.role !== "assistant") return prev
		const updated = updater(current)
		if (updated === current) return prev

		const next = prev.slice()
		next[idx] = updated
		return next
	})
}

function handleMessageStart(
	event: Extract<AgentEvent, { type: "message_start" }>,
	ctx: EventHandlerContext,
	cache: { current: ExtractionCache; set: (c: ExtractionCache) => void }
): void {
	// Handle queued user message being processed
	if (event.message.role === "user") {
		const text = typeof event.message.content === "string"
			? event.message.content
			: extractText(event.message.content as unknown[])

		// Only consume from queue if this message matches the queued text
		const peeked = ctx.promptQueue.peek()
		if (peeked !== undefined && peeked.text === text) {
			ctx.promptQueue.shift() // consume the matched message
			ctx.setMessages((prev) => appendWithCap(prev, { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() }))
			ctx.setActivityState("thinking")
		}
	}

	// Create streaming assistant message
	if (event.message.role === "assistant") {
		const messageId = crypto.randomUUID()
		ctx.streamingMessageId.current = messageId
		cache.current = createExtractionCache() // Reset cache for new message
		batch(() => {
			ctx.setActivityState("streaming")
			ctx.setMessages((prev) => appendWithCap(prev, {
				id: messageId,
				role: "assistant",
				content: "",
				isStreaming: true,
				tools: [],
				timestamp: Date.now(),
			}))
		})
	}
}

function handleMessageEnd(
	event: Extract<AgentEvent, { type: "message_end" }>,
	ctx: EventHandlerContext
): void {
	if (!hasContentArray(event.message)) return
	if (event.message.role !== "assistant") return
	
	const projected = appMessageToUiAssistant(event.message, {
		id: ctx.streamingMessageId.current ?? crypto.randomUUID(),
		toolByName: ctx.toolByName,
		isStreaming: false,
	})

	updateStreamingMessage(ctx, (msg) => {
		const nextThinking = projected.thinking || msg.thinking
		return { ...msg, ...projected, id: msg.id, thinking: nextThinking, isStreaming: false }
	})

	ctx.streamingMessageId.current = null

	// Save message to session
	if (isAppMessage(event.message)) {
		ctx.sessionManager.appendMessage(event.message)
	}

	// Update usage - context window budget includes input + output for the full request
	// totalTokens is already computed by providers as: (uncached_input + cacheRead + cacheWrite) + output
	// Only update if totalTokens > 0 to avoid clearing bar on aborted responses
	if (hasBasicUsage(event.message) && event.message.usage?.totalTokens) {
		ctx.setContextTokens(event.message.usage.totalTokens)
	}
	// Update cache stats for efficiency indicator
	if (hasBasicUsage(event.message) && event.message.usage && 
		typeof event.message.usage.cacheRead === "number" && 
		typeof event.message.usage.input === "number") {
		ctx.setCacheStats({ cacheRead: event.message.usage.cacheRead, input: event.message.usage.input })
	}
}

/** Update a tool in both tools array and contentBlocks */
function updateToolInContentBlocks(
	contentBlocks: UIContentBlock[] | undefined,
	toolId: string,
	updater: (tool: ToolBlock) => ToolBlock
): UIContentBlock[] | undefined {
	if (!contentBlocks) return undefined
	for (let i = 0; i < contentBlocks.length; i++) {
		const block = contentBlocks[i]
		if (block.type !== "tool" || block.tool.id !== toolId) continue
		const updated = updater(block.tool)
		if (updated === block.tool) return contentBlocks
		contentBlocks[i] = { ...block, tool: updated }
		return contentBlocks
	}
	return contentBlocks
}

function updateToolById(
	tools: ToolBlock[],
	toolId: string,
	updater: (tool: ToolBlock) => ToolBlock
): ToolBlock[] {
	const idx = tools.findIndex((t) => t.id === toolId)
	if (idx === -1) return tools
	const current = tools[idx]
	if (!current) return tools
	const updated = updater(current)
	if (updated === current) return tools
	const next = tools.slice()
	next[idx] = updated
	return next
}

function handleToolStart(
	event: Extract<AgentEvent, { type: "tool_execution_start" }>,
	ctx: EventHandlerContext
): void {
	ctx.setActivityState("tool")

	// Attach tool metadata from registry if available
	const meta = ctx.toolByName?.get(event.toolName)

	const newTool: ToolBlock = {
		id: event.toolCallId,
		name: event.toolName,
		args: event.args,
		updateSeq: 0,
		isError: false,
		isComplete: false,
		// Attach metadata for custom rendering
		label: meta?.label,
		source: meta?.source,
		sourcePath: meta?.sourcePath,
		renderCall: meta?.renderCall,
		renderResult: meta?.renderResult,
	}

	updateStreamingMessage(ctx, (msg) => ({
		...msg,
		tools: [...(msg.tools || []), newTool],
		// Update tool in contentBlocks if it exists there (as stub from message_end)
		contentBlocks: updateToolInContentBlocks(msg.contentBlocks, event.toolCallId, () => newTool),
	}))

	ctx.setToolBlocks((prev) => [...prev, newTool])
}

function handleToolUpdateImmediate(
	event: Extract<AgentEvent, { type: "tool_execution_update" }>,
	ctx: EventHandlerContext
): void {
	const toolUpdater = (t: ToolBlock): ToolBlock => ({
		...t,
		updateSeq: (t.updateSeq ?? 0) + 1,
		output: getToolText(event.partialResult),
		result: event.partialResult,
	})
	const updateTools = (tools: ToolBlock[]) => updateToolById(tools, event.toolCallId, toolUpdater)

	batch(() => {
		ctx.setToolBlocks(updateTools)
		updateStreamingMessage(ctx, (msg) => ({
			...msg,
			tools: updateTools(msg.tools || []),
			contentBlocks: updateToolInContentBlocks(msg.contentBlocks, event.toolCallId, toolUpdater),
		}))
	})
}

function handleToolEnd(
	event: Extract<AgentEvent, { type: "tool_execution_end" }>,
	ctx: EventHandlerContext
): void {
	const toolUpdater = (t: ToolBlock): ToolBlock => ({
		...t,
		output: getToolText(event.result),
		editDiff: getEditDiffText(event.result) || undefined,
		isError: event.isError,
		isComplete: true,
		result: event.result,
	})

	const updateTools = (tools: ToolBlock[]) => updateToolById(tools, event.toolCallId, toolUpdater)
	ctx.setToolBlocks(updateTools)

	// Update message containing this tool - find by tool ID since streamingMessageId
	// may be null if message_end fired before tool_execution_end
	ctx.setMessages((prev) => {
		const idx = prev.findIndex(
			(m) =>
				m.role === "assistant" && (
					m.tools?.some((t: ToolBlock) => t.id === event.toolCallId) ||
					m.contentBlocks?.some((b: UIContentBlock) => b.type === "tool" && b.tool.id === event.toolCallId)
				)
		)
		if (idx === -1) return prev

		const msg = prev[idx]
		if (!msg || msg.role !== "assistant") return prev
		const updated: UIAssistantMessage = {
			...msg,
			tools: updateTools(msg.tools || []),
			contentBlocks: updateToolInContentBlocks(msg.contentBlocks, event.toolCallId, toolUpdater),
		}
		const next = prev.slice()
		next[idx] = updated
		return next
	})
}

function handleAgentEnd(
	event: Extract<AgentEvent, { type: "agent_end" }>,
	ctx: EventHandlerContext
): void {
	ctx.streamingMessageId.current = null

	// Emit hook event - aggregate total tokens from all turns
	const totalTokens = ctx.hookRunner?.getContext?.()?.session?.getTokenUsage?.() ?? { input: 0, output: 0, total: 0 }
	const contextLimit = ctx.getContextWindow?.() ?? 0
	void ctx.hookRunner?.emit({
		type: "agent.end",
		sessionId: ctx.sessionManager.sessionId,
		messages: event.messages,
		totalTokens,
		contextLimit,
	})

	// Check for retryable error
	const currentMessages = ctx.agent.getMessages()
	const lastMsg = currentMessages[currentMessages.length - 1]
	const errorMsg = isAssistantMessage(lastMsg) ? lastMsg.errorMessage : undefined
	const isRetryable = errorMsg && ctx.retryablePattern.test(errorMsg)

	if (isRetryable && ctx.retryConfig.enabled && ctx.retryState.attempt < ctx.retryConfig.maxRetries) {
		ctx.retryState.attempt++
		const delay = ctx.retryConfig.baseDelayMs * Math.pow(2, ctx.retryState.attempt - 1)
		ctx.setRetryStatus(`Retrying (${ctx.retryState.attempt}/${ctx.retryConfig.maxRetries}) in ${Math.round(delay / 1000)}s... (esc to cancel)`)

		ctx.retryState.abortController = new AbortController()
		const signal = ctx.retryState.abortController.signal

		const sleep = (ms: number) =>
			new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(resolve, ms)
				signal.addEventListener(
					"abort",
					() => {
						clearTimeout(timeout)
						reject(new Error("cancelled"))
					},
					{ once: true }
				)
			})

		sleep(delay)
			.then(() => {
				if (signal.aborted) return
				ctx.setRetryStatus(null)
				ctx.retryState.abortController = null
				// Remove last error message and retry
				ctx.agent.replaceMessages(ctx.agent.getMessages().slice(0, -1))
				ctx.setActivityState("thinking")
				void ctx.agent.continue().catch((err) => {
					ctx.setActivityState("idle")
					ctx.setIsResponding(false)
					ctx.setMessages((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							role: "assistant",
							content: `Error: ${err instanceof Error ? err.message : String(err)}`,
						},
					])
				})
			})
			.catch(() => {
				// Retry cancelled
				ctx.setIsResponding(false)
				ctx.setActivityState("idle")
			})
		return
	}

	ctx.retryState.attempt = 0
	batch(() => {
		ctx.setIsResponding(false)
		ctx.setActivityState("idle")
		ctx.setTurnCount(0) // Reset turn count when agent completes
	})
}

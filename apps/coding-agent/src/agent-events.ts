/**
 * Agent event handler for TUI application
 */

import { batch } from "solid-js"
import { profile } from "./profiler.js"
import type { AgentEvent, AppMessage } from "@marvin-agents/agent-core"
import type { AgentToolResult, AssistantMessage, ToolResultMessage } from "@marvin-agents/ai"
import type { Theme } from "@marvin-agents/open-tui"
import type { JSX } from "solid-js"
import type { SessionManager } from "./session-manager.js"
import type { UIMessage, UIAssistantMessage, ToolBlock, ActivityState, UIContentBlock } from "./types.js"
import { extractText, extractThinking, extractOrderedBlocks, getToolText, getEditDiffText } from "./utils.js"
import type { HookRunner } from "./hooks/index.js"
import type { RenderResultOptions } from "./custom-tools/types.js"

/** Tool metadata for UI rendering */
export interface ToolMeta {
	label: string
	source: "builtin" | "custom"
	sourcePath?: string
	renderCall?: (args: any, theme: Theme) => JSX.Element
	renderResult?: (result: AgentToolResult<any>, opts: RenderResultOptions, theme: Theme) => JSX.Element
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
	queuedMessages: string[]

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
		state: { messages: unknown[] }
		replaceMessages: (messages: unknown[]) => void
		continue: () => Promise<void>
	}

	// Hook runner for lifecycle events (optional for backwards compat)
	hookRunner?: HookRunner

	// Tool metadata registry for custom tool rendering
	toolByName?: Map<string, ToolMeta>
}

export type AgentEventHandler = ((event: AgentEvent) => void) & { dispose: () => void }

const UPDATE_THROTTLE_MS = 150 // ~7fps during streaming - smoother perceived text flow
const UPDATE_THROTTLE_SLOW_MS = 180
const UPDATE_THROTTLE_SLOWEST_MS = 220
const TOOL_UPDATE_THROTTLE_MS = 50 // Throttle tool streaming updates

function computeUpdateThrottleMs(textLength: number): number {
	if (textLength > 12000) return UPDATE_THROTTLE_SLOWEST_MS
	if (textLength > 6000) return UPDATE_THROTTLE_SLOW_MS
	return UPDATE_THROTTLE_MS
}

/** Incremental extraction cache - avoids re-parsing entire content array each update */
interface ExtractionCache {
	// Track processed content length for incremental updates
	lastContentLength: number
	// Accumulated extracted values
	text: string
	thinking: { summary: string; full: string } | null
	orderedBlocks: ReturnType<typeof extractOrderedBlocks>
	// For thinking block ID generation
	thinkingCounter: number
}

function createExtractionCache(): ExtractionCache {
	return { lastContentLength: 0, text: "", thinking: null, orderedBlocks: [], thinkingCounter: 0 }
}

/** Incrementally extract new content blocks, appending to cached results */
function extractIncremental(content: unknown[], cache: ExtractionCache): ExtractionCache {
	const len = content.length
	if (len === cache.lastContentLength) return cache // No change

	// Process only new blocks
	let text = cache.text
	let thinking = cache.thinking
	const orderedBlocks = cache.orderedBlocks.slice() // Clone for mutation
	let thinkingCounter = cache.thinkingCounter

	for (let i = cache.lastContentLength; i < len; i++) {
		const block = content[i]
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>

		if (b.type === "text" && typeof b.text === "string") {
			text += b.text
			// Merge with last text block or add new
			const lastBlock = orderedBlocks[orderedBlocks.length - 1]
			if (lastBlock?.type === "text") {
				(lastBlock as { type: "text"; text: string }).text += b.text
			} else {
				orderedBlocks.push({ type: "text", text: b.text })
			}
		} else if (b.type === "thinking" && typeof b.thinking === "string") {
			const full = b.thinking
			const lines = full.trim().split("\n").filter((l) => l.trim().length > 20)
			const summary = lines[0]?.trim().slice(0, 80) || full.trim().slice(0, 80)
			const truncated = summary.length >= 80 ? summary + "..." : summary
			thinking = { summary: truncated, full }
			orderedBlocks.push({ type: "thinking", id: `thinking-${thinkingCounter++}`, summary: truncated, full })
		} else if (b.type === "toolCall" && typeof b.id === "string" && typeof b.name === "string") {
			orderedBlocks.push({ type: "toolCall", id: b.id, name: b.name, args: b.arguments ?? {} })
		}
	}

	return { lastContentLength: len, text, thinking, orderedBlocks, thinkingCounter }
}

export function createAgentEventHandler(ctx: EventHandlerContext): AgentEventHandler {
	let pendingUpdate: Extract<AgentEvent, { type: "message_update" }> | null = null
	let updateTimeout: ReturnType<typeof setTimeout> | null = null
	let disposed = false
	let turnIndex = 0
	
	// Incremental extraction cache - reset on new message
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
			const content = ev.message.content as unknown[]

			// Use incremental extraction - only processes new blocks
			extractionCache = extractIncremental(content, extractionCache)
			const { text, thinking, orderedBlocks } = extractionCache
			updateThrottleMs = computeUpdateThrottleMs(text.length)

			// Convert ordered blocks to UIContentBlocks
			const contentBlocks: UIContentBlock[] = orderedBlocks.map((block) => {
				if (block.type === "thinking") {
					return { type: "thinking" as const, id: block.id, summary: block.summary, full: block.full }
				} else if (block.type === "text") {
					return { type: "text" as const, text: block.text }
				} else {
					return {
						type: "tool" as const,
						tool: { id: block.id, name: block.name, args: block.args, isError: false, isComplete: false },
					}
				}
			})

			updateStreamingMessage(ctx, (msg) => {
				const nextThinking = thinking || msg.thinking
				return { ...msg, content: text, thinking: nextThinking, contentBlocks }
			})

			if (thinking && !text) ctx.setActivityState("thinking")
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

	const handler = ((event: AgentEvent) => {
		if (disposed) return

		// Emit hook events for agent lifecycle (fire-and-forget)
		if (event.type === "agent_start") {
			turnIndex = 0
			ctx.setTurnCount(0) // Reset turn count for new agent run
			extractionCache = createExtractionCache() // Reset for new agent run
			void ctx.hookRunner?.emit({ type: "agent.start" })
		}

		if (event.type === "turn_start") {
			ctx.setTurnCount(turnIndex + 1) // Update UI with current turn (1-indexed for display)
			void ctx.hookRunner?.emit({ type: "turn.start", turnIndex })
		}

		if (event.type === "turn_end") {
			void ctx.hookRunner?.emit({
				type: "turn.end",
				turnIndex,
				message: event.message,
				toolResults: event.toolResults as ToolResultMessage[],
			})
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
			ctx.sessionManager.appendMessage(event.message as AppMessage)
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
	}) as AgentEventHandler

	handler.dispose = dispose
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

		const current = prev[idx]!
		if (current.role !== "assistant") return prev
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
		if (ctx.queuedMessages.length > 0) {
			ctx.queuedMessages.shift()
			ctx.sessionManager.appendMessage(event.message as AppMessage)

			const text = typeof event.message.content === "string"
				? event.message.content
				: extractText(event.message.content as unknown[])

			ctx.setMessages((prev) => [
				...prev,
				{ id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() },
			])
			ctx.setActivityState("thinking")
		}
	}

	// Create streaming assistant message
	if (event.message.role === "assistant") {
		ctx.streamingMessageId.current = crypto.randomUUID()
		cache.current = createExtractionCache() // Reset cache for new message
		batch(() => {
			ctx.setActivityState("streaming")
			ctx.setMessages((prev) => [
				...prev,
				{
					id: ctx.streamingMessageId.current!,
					role: "assistant",
					content: "",
					isStreaming: true,
					tools: [],
					timestamp: Date.now(),
				},
			])
		})
	}
}

function handleMessageEnd(
	event: Extract<AgentEvent, { type: "message_end" }>,
	ctx: EventHandlerContext
): void {
	const content = event.message.content as unknown[]
	const text = extractText(content)
	const thinking = extractThinking(content)
	const orderedBlocks = extractOrderedBlocks(content)

	// Convert ordered blocks to UIContentBlocks, preserving order
	const contentBlocks: UIContentBlock[] = orderedBlocks.map((block) => {
		if (block.type === "thinking") {
			return { type: "thinking" as const, id: block.id, summary: block.summary, full: block.full }
		} else if (block.type === "text") {
			return { type: "text" as const, text: block.text }
		} else {
			// toolCall - create a stub tool block (will be updated by handleToolEnd)
			return {
				type: "tool" as const,
				tool: { id: block.id, name: block.name, args: block.args, isError: false, isComplete: false },
			}
		}
	})

	updateStreamingMessage(ctx, (msg) => {
		const nextThinking = thinking || msg.thinking
		return { ...msg, content: text, thinking: nextThinking, contentBlocks, isStreaming: false }
	})

	ctx.streamingMessageId.current = null

	// Save message to session
	ctx.sessionManager.appendMessage(event.message as AppMessage)

	// Update usage - context window budget includes input + output for the full request
	// totalTokens is already computed by providers as: (uncached_input + cacheRead + cacheWrite) + output
	// Only update if totalTokens > 0 to avoid clearing bar on aborted responses
	const msg = event.message as { usage?: { totalTokens?: number; cacheRead?: number; input?: number } }
	if (msg.usage?.totalTokens) {
		ctx.setContextTokens(msg.usage.totalTokens)
	}
	// Update cache stats for efficiency indicator
	if (msg.usage && typeof msg.usage.cacheRead === "number" && typeof msg.usage.input === "number") {
		ctx.setCacheStats({ cacheRead: msg.usage.cacheRead, input: msg.usage.input })
	}
}

/** Update a tool in both tools array and contentBlocks */
function updateToolInContentBlocks(
	contentBlocks: UIContentBlock[] | undefined,
	toolId: string,
	updater: (tool: ToolBlock) => ToolBlock
): UIContentBlock[] | undefined {
	if (!contentBlocks) return undefined
	return contentBlocks.map((block) => {
		if (block.type === "tool" && block.tool.id === toolId) {
			return { ...block, tool: updater(block.tool) }
		}
		return block
	})
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
	const makeToolUpdater = (toolCallId: string, partialResult: typeof event.partialResult) =>
		(t: ToolBlock) =>
			t.id === toolCallId
				? {
						...t,
						updateSeq: (t.updateSeq ?? 0) + 1,
						output: getToolText(partialResult),
						result: partialResult,
					}
				: t

	const toolUpdater = makeToolUpdater(event.toolCallId, event.partialResult)
	const updateTools = (tools: ToolBlock[]) => tools.map(toolUpdater)

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
	const updateTool = (tools: ToolBlock[]) =>
		tools.map((t) =>
			t.id === event.toolCallId
				? {
						...t,
						output: getToolText(event.result),
						editDiff: getEditDiffText(event.result) || undefined,
						isError: event.isError,
						isComplete: true,
						result: event.result,
					}
				: t
		)

	const toolUpdater = (t: ToolBlock): ToolBlock => ({
		...t,
		output: getToolText(event.result),
		editDiff: getEditDiffText(event.result) || undefined,
		isError: event.isError,
		isComplete: true,
		result: event.result,
	})

	ctx.setToolBlocks(updateTool)

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

		const msg = prev[idx]!
		if (msg.role !== "assistant") return prev
		const updated: UIAssistantMessage = {
			...msg,
			tools: updateTool(msg.tools || []),
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

	// Emit hook event
	void ctx.hookRunner?.emit({ type: "agent.end", messages: event.messages })

	// Check for retryable error
	const lastMsg = ctx.agent.state.messages[ctx.agent.state.messages.length - 1] as AssistantMessage | undefined
	const errorMsg = lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).errorMessage
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
				ctx.agent.replaceMessages(ctx.agent.state.messages.slice(0, -1))
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

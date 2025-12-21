/**
 * Agent event handler for TUI application
 */

import { batch } from "solid-js"
import type { AgentEvent, AppMessage } from "@marvin-agents/agent-core"
import type { AssistantMessage } from "@marvin-agents/ai"
import type { SessionManager } from "./session-manager.js"
import type { UIMessage, ToolBlock, ActivityState, UIContentBlock } from "./types.js"
import { extractText, extractThinking, extractOrderedBlocks, getToolText, getEditDiffText } from "./utils.js"

export interface EventHandlerContext {
	// State setters
	setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void
	setToolBlocks: (updater: (prev: ToolBlock[]) => ToolBlock[]) => void
	setActivityState: (s: ActivityState) => void
	setIsResponding: (v: boolean) => void
	setContextTokens: (v: number) => void
	setRetryStatus: (v: string | null) => void

	// Queue management
	queuedMessages: string[]
	setQueueCount: (v: number) => void

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
}

export type AgentEventHandler = ((event: AgentEvent) => void) & { dispose: () => void }

const UPDATE_THROTTLE_MS = 32 // ~30fps for UI updates

export function createAgentEventHandler(ctx: EventHandlerContext): AgentEventHandler {
	let pendingUpdate: Extract<AgentEvent, { type: "message_update" }> | null = null
	let updateTimeout: ReturnType<typeof setTimeout> | null = null
	let disposed = false

	const dispose = () => {
		disposed = true
		pendingUpdate = null
		if (updateTimeout) clearTimeout(updateTimeout)
		updateTimeout = null
	}

	const flushPendingUpdate = () => {
		if (!pendingUpdate) return
		const event = pendingUpdate
		pendingUpdate = null
		handleMessageUpdateImmediate(event, ctx)
	}

	const scheduleUpdate = () => {
		if (updateTimeout) return
		updateTimeout = setTimeout(() => {
			updateTimeout = null
			if (disposed) return
			flushPendingUpdate()
		}, UPDATE_THROTTLE_MS)
	}

	const handler = ((event: AgentEvent) => {
		if (disposed) return

		if (event.type === "message_start") {
			handleMessageStart(event, ctx)
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
			handleToolUpdate(event, ctx)
		}

		if (event.type === "tool_execution_end") {
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

function updateStreamingMessage(ctx: EventHandlerContext, updater: (msg: UIMessage) => UIMessage): void {
	const streamingId = ctx.streamingMessageId.current
	if (!streamingId) return

	ctx.setMessages((prev) => {
		if (prev.length === 0) return prev

		const lastIdx = prev.length - 1
		const last = prev[lastIdx]
		if (last?.id === streamingId) {
			const nextLast = updater(last)
			if (nextLast === last) return prev
			const next = prev.slice()
			next[lastIdx] = nextLast
			return next
		}

		const idx = prev.findIndex((m) => m.id === streamingId)
		if (idx === -1) return prev

		const current = prev[idx]!
		const updated = updater(current)
		if (updated === current) return prev

		const next = prev.slice()
		next[idx] = updated
		return next
	})
}

function handleMessageStart(
	event: Extract<AgentEvent, { type: "message_start" }>,
	ctx: EventHandlerContext
): void {
	// Handle queued user message being processed
	if (event.message.role === "user") {
		if (ctx.queuedMessages.length > 0) {
			ctx.queuedMessages.shift()
			ctx.setQueueCount(ctx.queuedMessages.length)
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

function handleMessageUpdateImmediate(
	event: Extract<AgentEvent, { type: "message_update" }>,
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
			// toolCall - create a stub tool block
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

	// Update usage
	const msg = event.message as { usage?: { input: number; output: number; cacheRead: number; cacheWrite?: number } }
	if (msg.usage) {
		const tokens = msg.usage.input + msg.usage.output + msg.usage.cacheRead + (msg.usage.cacheWrite || 0)
		ctx.setContextTokens(tokens)
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
	const newTool: ToolBlock = {
		id: event.toolCallId,
		name: event.toolName,
		args: event.args,
		isError: false,
		isComplete: false,
	}

	updateStreamingMessage(ctx, (msg) => ({
		...msg,
		tools: [...(msg.tools || []), newTool],
		// Update tool in contentBlocks if it exists there (as stub from message_end)
		contentBlocks: updateToolInContentBlocks(msg.contentBlocks, event.toolCallId, () => newTool),
	}))

	ctx.setToolBlocks((prev) => [...prev, newTool])
}

function handleToolUpdate(
	event: Extract<AgentEvent, { type: "tool_execution_update" }>,
	ctx: EventHandlerContext
): void {
	const updateTool = (tools: ToolBlock[]) =>
		tools.map((t) =>
			t.id === event.toolCallId
				? { ...t, output: getToolText(event.partialResult) }
				: t
		)

	const toolUpdater = (t: ToolBlock) =>
		t.id === event.toolCallId ? { ...t, output: getToolText(event.partialResult) } : t

	ctx.setToolBlocks(updateTool)
	updateStreamingMessage(ctx, (msg) => ({
		...msg,
		tools: updateTool(msg.tools || []),
		contentBlocks: updateToolInContentBlocks(msg.contentBlocks, event.toolCallId, toolUpdater),
	}))
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
					}
				: t
		)

	const toolUpdater = (t: ToolBlock): ToolBlock => ({
		...t,
		output: getToolText(event.result),
		editDiff: getEditDiffText(event.result) || undefined,
		isError: event.isError,
		isComplete: true,
	})

	ctx.setToolBlocks(updateTool)
	updateStreamingMessage(ctx, (msg) => ({
		...msg,
		tools: updateTool(msg.tools || []),
		contentBlocks: updateToolInContentBlocks(msg.contentBlocks, event.toolCallId, toolUpdater),
	}))
}

function handleAgentEnd(
	_event: Extract<AgentEvent, { type: "agent_end" }>,
	ctx: EventHandlerContext
): void {
	ctx.streamingMessageId.current = null

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
	})
}

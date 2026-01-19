import { describe, expect, it, mock, beforeEach } from "bun:test"
import { createAgentEventHandler, type EventHandlerContext } from "../src/agent-events.js"
import type { AgentEvent } from "@yeshwanthyk/agent-core"
import type { PromptQueueItem } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"

// Mock context factory
function createMockContext(overrides: Partial<EventHandlerContext> = {}): EventHandlerContext {
	const messages: unknown[] = []
	const toolBlocks: unknown[] = []

	const queue: PromptQueueItem[] = []
	const promptQueue = {
		push: mock((item: PromptQueueItem) => {
			queue.push(item)
		}),
		shift: mock(() => queue.shift()),
		drainToScript: mock(() => {
			if (queue.length === 0) return null
			const combined = queue
				.map((item) => {
					const command = item.mode === "steer" ? "/steer" : "/followup"
					return item.text ? `${command} ${item.text}` : command
				})
				.join("\n")
			queue.length = 0
			return combined
		}),
		clear: mock(() => {
			queue.length = 0
		}),
		size: mock(() => queue.length),
		peekAll: mock(() => [...queue]),
		peek: mock(() => queue[0]),
		counts: mock(() => ({
			steer: queue.filter((q) => q.mode === "steer").length,
			followUp: queue.filter((q) => q.mode === "followUp").length,
		})),
	}

	return {
		setMessages: mock((updater) => {
			const result = updater(messages as any)
			messages.length = 0
			messages.push(...result)
		}),
		setToolBlocks: mock((updater) => {
			const result = updater(toolBlocks as any)
			toolBlocks.length = 0
			toolBlocks.push(...result)
		}),
		setActivityState: mock(() => {}),
		setIsResponding: mock(() => {}),
		setContextTokens: mock(() => {}),
		setCacheStats: mock(() => {}),
		setRetryStatus: mock(() => {}),
		setTurnCount: mock(() => {}),

		promptQueue,

		sessionManager: {
			appendMessage: mock(() => {}),
		} as any,

		streamingMessageId: { current: null },

		retryConfig: { enabled: false, maxRetries: 3, baseDelayMs: 2000 },
		retryablePattern: /overloaded/i,
		retryState: { attempt: 0, abortController: null },

		agent: {
			state: { messages: [] },
			replaceMessages: mock(() => {}),
			continue: mock(async () => {}),
		},

		...overrides,
	}
}

describe("createAgentEventHandler", () => {
	describe("message_start", () => {
		it("creates streaming assistant message", () => {
			const ctx = createMockContext()
			const handler = createAgentEventHandler(ctx)

			handler({
				type: "message_start",
				message: { role: "assistant", content: [] },
			} as unknown as AgentEvent)

			expect(ctx.streamingMessageId.current).not.toBeNull()
			expect(ctx.setMessages).toHaveBeenCalled()
			expect(ctx.setActivityState).toHaveBeenCalledWith("streaming")
		})

		it("processes queued user messages", () => {
			const ctx = createMockContext()
			ctx.promptQueue.push({ text: "test message", mode: "followUp" })
			const handler = createAgentEventHandler(ctx)

			handler({
				type: "message_start",
				message: { role: "user", content: [{ type: "text", text: "test message" }] },
			} as unknown as AgentEvent)

			expect(ctx.promptQueue.shift).toHaveBeenCalled()
			expect(ctx.setActivityState).toHaveBeenCalledWith("thinking")
		})
	})

	describe("message_update", () => {
		it("updates streaming message content", async () => {
			const ctx = createMockContext()
			ctx.streamingMessageId.current = "test-id"
			const handler = createAgentEventHandler(ctx)

			handler({
				type: "message_update",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "hello world" }],
				},
			} as unknown as AgentEvent)

			// Wait for throttled update (150ms throttle + buffer)
			await new Promise((r) => setTimeout(r, 180))
			expect(ctx.setMessages).toHaveBeenCalled()
		})

		it("sets thinking state when only thinking block exists", async () => {
			const ctx = createMockContext()
			ctx.streamingMessageId.current = "test-id"
			const handler = createAgentEventHandler(ctx)

			handler({
				type: "message_update",
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "considering the problem carefully and thoroughly" }],
				},
			} as unknown as AgentEvent)

			// Wait for throttled update (150ms throttle + buffer)
			await new Promise((r) => setTimeout(r, 180))
			expect(ctx.setActivityState).toHaveBeenCalledWith("thinking")
		})
	})

	describe("message_end", () => {
		it("finalizes streaming message", () => {
			const ctx = createMockContext()
			ctx.streamingMessageId.current = "test-id"
			const handler = createAgentEventHandler(ctx)

			handler({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "done" }],
					usage: { input: 100, output: 50, cacheRead: 10, totalTokens: 160 },
				},
			} as unknown as AgentEvent)

			expect(ctx.streamingMessageId.current).toBeNull()
			expect(ctx.sessionManager.appendMessage).toHaveBeenCalled()
			expect(ctx.setContextTokens).toHaveBeenCalledWith(160)
		})
	})

	describe("tool_execution_start", () => {
		it("creates tool block", () => {
			const ctx = createMockContext()
			ctx.streamingMessageId.current = "test-id"
			const handler = createAgentEventHandler(ctx)

			handler({
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "bash",
				args: { command: "ls" },
			} as unknown as AgentEvent)

			expect(ctx.setActivityState).toHaveBeenCalledWith("tool")
			expect(ctx.setToolBlocks).toHaveBeenCalled()
		})
	})

	describe("tool_execution_end", () => {
		it("completes tool block", () => {
			const ctx = createMockContext()
			ctx.streamingMessageId.current = "test-id"
			const handler = createAgentEventHandler(ctx)

			handler({
				type: "tool_execution_end",
				toolCallId: "tool-1",
				result: { content: [{ type: "text", text: "output" }] },
				isError: false,
			} as unknown as AgentEvent)

			expect(ctx.setToolBlocks).toHaveBeenCalled()
		})
	})

	describe("tool_execution_update", () => {
		it("increments updateSeq even when output is empty", async () => {
			const toolBlocks: any[] = []
			const ctx = createMockContext({
				streamingMessageId: { current: "test-id" },
				setToolBlocks: mock((updater) => {
					const result = updater(toolBlocks as any)
					toolBlocks.length = 0
					toolBlocks.push(...result)
				}),
			})
			const handler = createAgentEventHandler(ctx)

			handler({
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "custom",
				args: {},
			} as unknown as AgentEvent)

			handler({
				type: "tool_execution_update",
				toolCallId: "tool-1",
				toolName: "custom",
				args: {},
				partialResult: { content: [], details: { ui: { kind: "agent_delegation", mode: "single", items: [] } } },
			} as unknown as AgentEvent)

			await new Promise((r) => setTimeout(r, 180))

			handler({
				type: "tool_execution_update",
				toolCallId: "tool-1",
				toolName: "custom",
				args: {},
				partialResult: { content: [], details: { ui: { kind: "agent_delegation", mode: "single", items: [] } } },
			} as unknown as AgentEvent)

			await new Promise((r) => setTimeout(r, 180))

			expect(toolBlocks.length).toBe(1)
			expect(toolBlocks[0].id).toBe("tool-1")
			expect(toolBlocks[0].updateSeq).toBe(2)
		})
	})

	describe("agent_end", () => {
		it("sets idle state on completion", () => {
			const ctx = createMockContext()
			const handler = createAgentEventHandler(ctx)

			handler({ type: "agent_end" } as unknown as AgentEvent)

			expect(ctx.setIsResponding).toHaveBeenCalledWith(false)
			expect(ctx.setActivityState).toHaveBeenCalledWith("idle")
		})

		it("resets retry attempt counter", () => {
			const ctx = createMockContext()
			ctx.retryState.attempt = 2
			const handler = createAgentEventHandler(ctx)

			handler({ type: "agent_end" } as unknown as AgentEvent)

			expect(ctx.retryState.attempt).toBe(0)
		})
	})
})

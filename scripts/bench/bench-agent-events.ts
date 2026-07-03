// Bench hint: bun scripts/bench/bench-agent-events.ts
import type { AgentEvent, AppMessage } from "@yeshwanthyk/agent-core"
import type { AssistantMessage, AssistantMessageEvent, ToolResultMessage } from "@yeshwanthyk/ai"
import { createPromptQueue } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import type { SessionManager } from "../../apps/coding-agent/src/session-manager.js"
import { createAgentEventHandler, type EventHandlerContext } from "../../apps/coding-agent/src/agent-events.js"
import type { ActivityState, ToolBlock, UIMessage } from "../../apps/coding-agent/src/types.js"

type BenchEventType = AgentEvent["type"]

interface TimingStats {
	count: number
	totalMs: number
	maxMs: number
}

const eventOrder: BenchEventType[] = [
	"agent_start",
	"turn_start",
	"message_start",
	"message_update",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"message_end",
	"turn_end",
	"agent_end",
]

const createStats = (): Record<BenchEventType, TimingStats> =>
	Object.fromEntries(eventOrder.map((type) => [type, { count: 0, totalMs: 0, maxMs: 0 }])) as Record<BenchEventType, TimingStats>

const recordTiming = (stats: Record<BenchEventType, TimingStats>, type: BenchEventType, elapsedMs: number): void => {
	const stat = stats[type]
	stat.count += 1
	stat.totalMs += elapsedMs
	if (elapsedMs > stat.maxMs) stat.maxMs = elapsedMs
}

const formatMs = (value: number): string => value.toFixed(4)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const textResult = (text: string) => ({
	content: [{ type: "text" as const, text }],
	details: { bytes: text.length },
})

const makeAssistant = (text: string): AssistantMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
})

const makeMessageUpdate = (text: string): Extract<AgentEvent, { type: "message_update" }> => {
	const message = makeAssistant(text)
	const assistantMessageEvent: AssistantMessageEvent = {
		type: "text_delta",
		contentIndex: 0,
		delta: text.slice(-8),
		partial: message,
	}
	return { type: "message_update", message, assistantMessageEvent }
}

const timed = (handler: (event: AgentEvent) => void, stats: Record<BenchEventType, TimingStats>, event: AgentEvent): void => {
	const start = performance.now()
	handler(event)
	recordTiming(stats, event.type, performance.now() - start)
}

function createBenchContext(): { ctx: EventHandlerContext; messages: UIMessage[]; toolBlocks: ToolBlock[] } {
	const messages: UIMessage[] = []
	const toolBlocks: ToolBlock[] = []
	let activityState: ActivityState = "idle"
	let isResponding = false
	let contextTokens = 0
	let cacheStats: { cacheRead: number; input: number } | null = null
	let retryStatus: string | null = null
	let turnCount = 0
	const appendedMessages: AppMessage[] = []
	const agentMessages: AppMessage[] = []

	const sessionManager = {
		sessionId: "bench-session",
		appendMessage: (message: AppMessage) => {
			appendedMessages.push(message)
		},
	} as unknown as SessionManager

	const ctx: EventHandlerContext = {
		setMessages: (updater) => {
			const next = updater(messages)
			messages.length = 0
			messages.push(...next)
		},
		setToolBlocks: (updater) => {
			const next = updater(toolBlocks)
			toolBlocks.length = 0
			toolBlocks.push(...next)
		},
		setActivityState: (state) => {
			activityState = state
		},
		setIsResponding: (value) => {
			isResponding = value
		},
		setContextTokens: (value) => {
			contextTokens = value
		},
		setCacheStats: (value) => {
			cacheStats = value
		},
		setRetryStatus: (value) => {
			retryStatus = value
		},
		setTurnCount: (value) => {
			turnCount = value
		},
		promptQueue: createPromptQueue(() => {}),
		sessionManager,
		streamingMessageId: { current: null },
		retryConfig: { enabled: false, maxRetries: 3, baseDelayMs: 2000 },
		retryablePattern: /overloaded/i,
		retryState: { attempt: 0, abortController: null },
		agent: {
			getMessages: () => agentMessages,
			replaceMessages: (next) => {
				agentMessages.length = 0
				agentMessages.push(...next)
			},
			continue: async () => {},
		},
		getContextWindow: () => 200_000,
	}

	void activityState
	void isResponding
	void contextTokens
	void cacheStats
	void retryStatus
	void turnCount
	void appendedMessages

	return { ctx, messages, toolBlocks }
}

async function runBench(): Promise<void> {
	const { ctx, messages, toolBlocks } = createBenchContext()
	const handler = createAgentEventHandler(ctx)
	const stats = createStats()
	const finalText = Array.from({ length: 300 }, (_, i) => `chunk-${i.toString().padStart(3, "0")} payload\n`).join("")
	const finalMessage = makeAssistant(finalText)
	const toolIds = ["tool-read", "tool-edit", "tool-run"]

	try {
		timed(handler, stats, { type: "agent_start" })
		timed(handler, stats, { type: "turn_start" })
		timed(handler, stats, { type: "message_start", message: { role: "assistant", content: [] } })

		let text = ""
		for (let i = 0; i < 300; i++) {
			text += `chunk-${i.toString().padStart(3, "0")} payload\n`
			timed(handler, stats, makeMessageUpdate(text))
		}
		await sleep(150)

		for (let i = 0; i < toolIds.length; i++) {
			const toolCallId = toolIds[i] ?? `tool-${i}`
			const command = i === 1 ? "sed -n 1,80p file.ts" : i === 2 ? "bun test apps/coding-agent/tests" : "rg buildContentItems"
			timed(handler, stats, { type: "tool_execution_start", toolCallId, toolName: "bash", args: { command } })
			timed(handler, stats, {
				type: "tool_execution_update",
				toolCallId,
				toolName: "bash",
				args: { command },
				partialResult: textResult(`partial ${toolCallId}`),
			})
			await sleep(70)
			timed(handler, stats, {
				type: "tool_execution_end",
				toolCallId,
				toolName: "bash",
				result: textResult(`final ${toolCallId}`),
				isError: false,
			})
		}

		timed(handler, stats, {
			type: "message_end",
			message: {
				...finalMessage,
				usage: { input: 12_000, output: 1_200, cacheRead: 8_000, totalTokens: 13_200 },
			},
		})
		const toolResults: ToolResultMessage[] = toolIds.map((id) => ({
			role: "toolResult",
			toolCallId: id,
			content: [{ type: "text", text: `result ${id}` }],
		}))
		timed(handler, stats, { type: "turn_end", message: finalMessage, toolResults })
		timed(handler, stats, { type: "agent_end", messages: [finalMessage] })
	} finally {
		handler.dispose()
	}

	console.log("# bench-agent-events")
	console.log(`messages=${messages.length} toolBlocks=${toolBlocks.length}`)
	console.log("event,count,total_ms,avg_ms,max_ms")
	for (const type of eventOrder) {
		const stat = stats[type]
		if (stat.count === 0) continue
		const avg = stat.totalMs / stat.count
		console.log(`${type},${stat.count},${formatMs(stat.totalMs)},${formatMs(avg)},${formatMs(stat.maxMs)}`)
	}
}

await runBench()

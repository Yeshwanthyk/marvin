import { describe, expect, it } from "bun:test"
import { Agent, type AgentTransport, type AppMessage } from "@yeshwanthyk/agent-core"
import { getModels } from "@yeshwanthyk/ai"
import type { Message } from "@yeshwanthyk/ai"
import type { ToolProjectionMeta } from "../src/domain/messaging/projection.js"
import { appMessageToUiAssistant, uiMessageId } from "../src/domain/messaging/projection.js"
import { MESSAGE_CAP } from "../src/domain/messaging/content.js"
import { createSessionController, renderLoadedSessionView, type SessionControllerOptions } from "../src/runtime/session/session-controller.js"
import type { LoadedSession } from "../src/session-manager.js"

const usage = {
	input: 10,
	output: 5,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 15,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

const toolByName = new Map<string, ToolProjectionMeta>()

const createUserMessages = (count: number): AppMessage[] =>
	Array.from({ length: count }, (_, index) => ({
		role: "user",
		content: `message ${index}`,
		timestamp: index,
	}))

async function* emptyAgentEvents() {
}

const noopTransport: AgentTransport = {
	run: (_messages: Message[], _userMessage: Message) => emptyAgentEvents(),
	continue: (_messages: Message[]) => emptyAgentEvents(),
}

describe("session message projection", () => {
	it("uses deterministic loaded-session ids across renders", () => {
		const sessionId = "session-a"
		const messages: AppMessage[] = [
			{ role: "user", content: "hello", timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "hi" }],
				api: "messages",
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				usage,
				stopReason: "stop",
				timestamp: 2,
			},
			{
				role: "shell",
				command: "pwd",
				output: "/work/marvin",
				exitCode: 0,
				truncated: false,
				timestamp: 3,
			},
		]

		const first = renderLoadedSessionView(messages, { sessionId, toolByName, shellInjectionPrefix: "!" })
		const second = renderLoadedSessionView(messages, { sessionId, toolByName, shellInjectionPrefix: "!" })

		expect(second.messages.map((message) => message.id)).toEqual(first.messages.map((message) => message.id))
		expect(first.messages.map((message) => message.id)).toEqual([
			"session-a:message:0:user",
			"session-a:message:1:assistant",
			"session-a:message:2:shell",
		])
	})

	it("projects live and loaded assistant messages identically", () => {
		const sessionId = "session-b"
		const assistant = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "considering the projection path carefully" },
				{ type: "text", text: "Use one projection." },
				{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "pwd" } },
			],
			api: "messages",
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			usage,
			stopReason: "stop",
			timestamp: 4,
		} satisfies Extract<AppMessage, { role: "assistant" }>
		const id = uiMessageId({ sessionId, messageIndex: 0 }, "assistant")

		const live = appMessageToUiAssistant(assistant, { id, toolByName, isStreaming: false })
		const loaded = renderLoadedSessionView([assistant], { sessionId, toolByName, shellInjectionPrefix: "" })

		expect(loaded.messages).toEqual([live])
	})

	it("caps loaded-session UI while preserving original ids, full context, and full agent state", () => {
		const model = getModels("anthropic")[0]
		if (!model) throw new Error("missing test model")

		const sessionId = "session-c"
		const messages = createUserMessages(299)
		messages.push({
			role: "assistant",
			content: [{ type: "text", text: "final usage" }],
			api: "messages",
			provider: "anthropic",
			model: model.id,
			usage: { ...usage, totalTokens: 300 },
			stopReason: "stop",
			timestamp: 299,
		})
		const view = renderLoadedSessionView(messages, { sessionId, toolByName, shellInjectionPrefix: "!" })

		expect(view.messages).toHaveLength(MESSAGE_CAP)
		expect(view.messages[0]?.id).toBe(`${sessionId}:message:${messages.length - MESSAGE_CAP}:user`)
		expect(view.messages.at(-1)?.id).toBe(`${sessionId}:message:${messages.length - 1}:assistant`)
		expect(view.contextTokens).toBe(300)

		const agent = new Agent({ transport: noopTransport, initialState: { model } })
		let renderedMessages: unknown[] = []
		let contextTokens = 0
		const loadedSession: LoadedSession = {
			metadata: {
				type: "session",
				id: sessionId,
				timestamp: 1,
				cwd: "/tmp/marvin",
				provider: "anthropic",
				modelId: model.id,
				thinkingLevel: "off",
			},
			messages,
			leafId: null,
		}
		const options: SessionControllerOptions = {
			initialProvider: "anthropic",
			initialModel: model,
			initialModelId: model.id,
			initialThinking: "off",
			agent,
			sessionManager: {
				startSession: () => sessionId,
				clearCurrentSession: () => {},
				listSessions: () => [],
				loadSession: () => null,
				continueSession: () => {},
				branch: () => {},
				getEntry: () => undefined,
				resetLeaf: () => {},
				appendMessage: () => {},
				getBranch: () => [],
				getTree: () => [],
				getLeafId: () => null,
				getCompactionState: () => undefined,
				getEntries: () => [],
				findSession: () => null,
				loadLatest: () => null,
				sessionId: null,
				sessionPath: null,
				projectCwd: "/tmp/marvin",
			},
			hookRunner: { emit: async () => {} },
			toolByName,
			setMessages: (updater) => {
				renderedMessages = updater([])
			},
			setContextTokens: (value) => {
				contextTokens = value
			},
			setDisplayProvider: () => {},
			setDisplayModelId: () => {},
			setDisplayThinking: () => {},
			setDisplayContextWindow: () => {},
			shellInjectionPrefix: "!",
		}

		createSessionController(options).restoreSession(loadedSession)

		expect(renderedMessages).toHaveLength(MESSAGE_CAP)
		expect(contextTokens).toBe(300)
		expect(agent.state.messages).toHaveLength(300)
	})
})

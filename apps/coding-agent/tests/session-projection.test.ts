import { describe, expect, it } from "bun:test"
import type { AppMessage } from "@yeshwanthyk/agent-core"
import type { ToolProjectionMeta } from "../src/domain/messaging/projection.js"
import { appMessageToUiAssistant, uiMessageId } from "../src/domain/messaging/projection.js"
import { renderLoadedSessionView } from "../src/runtime/session/session-controller.js"

const usage = {
	input: 10,
	output: 5,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 15,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

const toolByName = new Map<string, ToolProjectionMeta>()

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
})

import { describe, expect, it, mock } from "bun:test"
import type { Agent, AppMessage } from "@yeshwanthyk/agent-core"
import { getModels } from "@yeshwanthyk/ai"
import { createPromptQueue, type PromptQueueItem } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import { createSessionController, type SessionControllerOptions } from "../src/runtime/session/session-controller.js"

describe("prompt queue", () => {
	it("tracks size when pushing and shifting", () => {
		const snapshots: Array<{ steer: number; followUp: number }> = []
		const queue = createPromptQueue((counts) => snapshots.push(counts))

		const entries: PromptQueueItem[] = [
			{ text: "one", mode: "followUp" },
			{ text: "two", mode: "steer" },
		]

		queue.push(entries[0]!)
		queue.push(entries[1]!)
		expect(queue.size()).toBe(2)
		expect(queue.shift()).toEqual(entries[0])
		expect(queue.size()).toBe(1)
		expect(queue.peekAll()).toEqual([entries[1]])

		expect(snapshots).toEqual([
			{ followUp: 1, steer: 0 },
			{ followUp: 1, steer: 1 },
			{ followUp: 0, steer: 1 },
		])
	})

	it("drains queued text as slash command script", () => {
		const queue = createPromptQueue(() => {})
		expect(queue.drainToScript()).toBeNull()
		queue.push({ text: "line 1", mode: "followUp" })
		queue.push({ text: "line 2", mode: "steer" })
		expect(queue.drainToScript()).toBe("/followup line 1\n/steer line 2")
		expect(queue.size()).toBe(0)
	})

	it("preserves multiline content when draining", () => {
		const queue = createPromptQueue(() => {})
		queue.push({ text: "multi line\nvalue", mode: "followUp" })
		const script = queue.drainToScript()
		expect(script).toBe(`/followup multi line\nvalue`)
		expect(queue.size()).toBe(0)
	})

	it("routes user-message queueing through the runtime submitter exactly once", async () => {
		const model = getModels("anthropic")[0]
		if (!model) throw new Error("missing test model")

		const steer = mock(async (_message: AppMessage) => {})
		const followUp = mock(async (_message: AppMessage) => {})
		const submitPrompt = mock(async (_text: string, _options?: { mode?: "steer" | "followUp" }) => {})

		const options: SessionControllerOptions = {
			initialProvider: "anthropic",
			initialModel: model,
			initialModelId: model.id,
			initialThinking: "off",
			agent: {
				steer,
				followUp,
				replaceMessages: (_messages: AppMessage[]) => {},
			} as unknown as Agent,
			sessionManager: {
				startSession: () => "session",
				clearCurrentSession: () => {},
				listSessions: () => [],
				loadSession: () => null,
				continueSession: () => {},
				branch: () => {},
				getEntry: () => null,
				resetLeaf: () => {},
				appendMessage: () => {},
				getBranch: () => [],
				getTree: () => [],
				getLeafId: () => null,
				sessionId: null,
				projectCwd: "/tmp",
			} as unknown as SessionControllerOptions["sessionManager"],
			hookRunner: {
				emit: async () => {},
			} as unknown as SessionControllerOptions["hookRunner"],
			toolByName: new Map(),
			setMessages: () => {},
			setContextTokens: () => {},
			setDisplayProvider: () => {},
			setDisplayModelId: () => {},
			setDisplayThinking: () => {},
			setDisplayContextWindow: () => {},
			shellInjectionPrefix: "[Shell output]",
			submitPrompt,
		}

		const controller = createSessionController(options)
		await controller.sendUserMessage("run once", { deliverAs: "steer" })

		expect(submitPrompt).toHaveBeenCalledTimes(1)
		expect(submitPrompt).toHaveBeenCalledWith("run once", { mode: "steer" })
		expect(steer).not.toHaveBeenCalled()
		expect(followUp).not.toHaveBeenCalled()
	})
})

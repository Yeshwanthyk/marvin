import { describe, expect, it } from "bun:test"
import type { ToolBlock, UIMessage } from "../src/types.js"

async function loadMessageListModel() {
	await import("@opentui/solid/preload")
	await import("../src/solid-preload.js")
	const messageList = await import("../src/components/MessageList.js")
	return {
		buildContentItems: messageList.buildContentItems,
		buildTranscriptMarkIds: messageList.buildTranscriptMarkIds,
	}
}

const bashTool = (overrides: Partial<ToolBlock> = {}): ToolBlock => ({
	id: "tool-call-1",
	name: "bash",
	args: { command: "pwd" },
	output: "/work/marvin",
	isError: false,
	isComplete: true,
	...overrides,
})

describe("MessageList transcript model", () => {
	it("assigns stable marks to prompts, streamed text, tools, and shell output", async () => {
		const model = await loadMessageListModel()
		const tool = bashTool()
		const messages: UIMessage[] = [
			{ id: "user-1", role: "user", content: "which dir is this in?" },
			{
				id: "assistant-1",
				role: "assistant",
				content: "",
				isStreaming: true,
				contentBlocks: [
					{ type: "text", text: "Checking now" },
					{ type: "tool", tool },
				],
			},
			{ id: "shell-1", role: "shell", command: "pwd", output: "/work/marvin", exitCode: 0, truncated: false },
		]

		const items = model.buildContentItems(messages, [], true)

		expect(items.map((item) => item.mark.label)).toEqual(["§1", "live", "cmd", "$"])
		expect(model.buildTranscriptMarkIds(messages, [], true)).toEqual(items.map((item) => item.mark.id))
	})

	it("marks failing tools as error anchors", async () => {
		const model = await loadMessageListModel()
		const tool = bashTool({ id: "tool-error", isError: true, output: "nope" })
		const messages: UIMessage[] = [{
			id: "assistant-1",
			role: "assistant",
			content: "",
			tools: [tool],
		}]

		const [item] = model.buildContentItems(messages, [], true)

		expect(item?.mark.kind).toBe("error")
		expect(item?.mark.label).toBe("error")
	})
})

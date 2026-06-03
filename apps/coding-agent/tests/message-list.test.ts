import { describe, expect, it } from "bun:test"
import type { ToolBlock, UIMessage } from "../src/types.js"
import type { HumanTuiHarness } from "./helpers/tui-harness.js"

async function loadMessageListModel() {
	await import("@opentui/solid/preload")
	await import("../src/solid-preload.js")
	const messageList = await import("../src/components/MessageList.js")
	return {
		buildContentItems: messageList.buildContentItems,
		buildTranscriptMarkIds: messageList.buildTranscriptMarkIds,
	}
}

async function renderMessageList(messages: UIMessage[]): Promise<HumanTuiHarness> {
	await import("@opentui/solid/preload")
	await import("../src/solid-preload.js")
	const { createComponent } = await import("solid-js")
	const { ThemeProvider } = await import("@yeshwanthyk/open-tui")
	const { MessageList } = await import("../src/components/MessageList.js")
	const { renderHumanTui } = await import("./helpers/tui-harness.js")

	return renderHumanTui(() => (
		createComponent(ThemeProvider, {
			mode: "dark",
			themeName: "marvin",
			get children() {
				return createComponent(MessageList, {
					messages,
					toolBlocks: [],
					thinkingVisible: true,
					diffWrapMode: "word",
					isToolExpanded: () => false,
					toggleToolExpanded: () => {},
					isThinkingExpanded: () => false,
					toggleThinkingExpanded: () => {},
				})
			},
		})
	), { width: 120, height: 24 })
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

		expect(items.map((item) => item.mark.label)).toEqual(["§1", "live", "read", "shell"])
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
		expect(item?.mark.label).toBe("fail")
	})

	it("groups consecutive runtime work under one transcript mark", async () => {
		const model = await loadMessageListModel()
		const messages: UIMessage[] = [{
			id: "assistant-1",
			role: "assistant",
			content: "",
			contentBlocks: [
				{ type: "thinking", id: "thinking-1", summary: "Checking files", preview: "Checking files", full: "Checking files" },
				{ type: "tool", tool: bashTool({ id: "tool-1", args: { command: "rg foo" } }) },
				{ type: "tool", tool: bashTool({ id: "tool-2", args: { command: "sed -n 1,80p file.ts" } }) },
				{ type: "text", text: "Done." },
			],
		}]

		const items = model.buildContentItems(messages, [], true)

		expect(items.map((item) => item.type)).toEqual(["work", "assistant"])
		const [workItem] = items
		expect(workItem?.mark.label).toBe("read")
		expect(workItem?.mark.detail).toBe("1 think · 2 read")
		if (workItem?.type !== "work") throw new Error("expected work item")
		expect(workItem.entries.map((entry) => entry.mark.label)).toEqual(["think", "read", "read"])
		expect(model.buildTranscriptMarkIds(messages, [], true)).toEqual(items.map((item) => item.mark.id))
	})

	it("labels mixed runtime groups as work with tokenized counts", async () => {
		const model = await loadMessageListModel()
		const messages: UIMessage[] = [{
			id: "assistant-mixed",
			role: "assistant",
			content: "",
			contentBlocks: [
				{ type: "thinking", id: "thinking-mixed", summary: "Checking files", preview: "Checking files", full: "Checking files" },
				{ type: "tool", tool: bashTool({ id: "tool-read-mixed", args: { command: "rg foo" } }) },
				{ type: "tool", tool: bashTool({ id: "tool-edit-mixed", name: "edit", editDiff: "diff" }) },
			],
		}]

		const [workItem] = model.buildContentItems(messages, [], true)

		expect(workItem?.type).toBe("work")
		expect(workItem?.mark.label).toBe("work")
		expect(workItem?.mark.detail).toBe("1 think · 1 read · 1 edit")
	})

	it("renders grouped runtime work collapsed by default", async () => {
		const messages: UIMessage[] = [{
			id: "assistant-1",
			role: "assistant",
			content: "",
			contentBlocks: [
				{ type: "thinking", id: "thinking-1", summary: "Checking files", preview: "Checking files", full: "Checking files" },
				{ type: "tool", tool: bashTool({ id: "tool-1", args: { command: "rg foo" } }) },
				{ type: "tool", tool: bashTool({ id: "tool-2", args: { command: "sed -n 1,80p file.ts" } }) },
			],
		}]
		const harness = await renderMessageList(messages)
		try {
			const frame = harness.frame()
			expect(frame).toContain("read")
			expect(frame).toContain("1")
			expect(frame).toContain("think")
			expect(frame).toContain("2")
			expect(frame).not.toContain("rg foo")
			expect(frame).not.toContain("sed -n")
		} finally {
			harness.renderer.destroy()
		}
	})

	it("does not render empty thinking rows", async () => {
		const model = await loadMessageListModel()
		const messages: UIMessage[] = [{
			id: "assistant-1",
			role: "assistant",
			content: "done",
			contentBlocks: [
				{ type: "thinking", id: "thinking-empty", summary: "", preview: "", full: "  " },
				{ type: "text", text: "done" },
			],
		}]

		const items = model.buildContentItems(messages, [], true)

		expect(items.map((item) => item.type)).toEqual(["assistant"])
		expect(model.buildTranscriptMarkIds(messages, [], true)).toEqual(items.map((item) => item.mark.id))
	})
})

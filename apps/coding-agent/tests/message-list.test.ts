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
		createTranscriptContentCache: messageList.createTranscriptContentCache,
		expandedTranscriptWindowSizeForIndex: messageList.expandedTranscriptWindowSizeForIndex,
		transcriptWindowForItems: messageList.transcriptWindowForItems,
	}
}

async function renderMessageList(messages: UIMessage[]): Promise<HumanTuiHarness> {
	await import("@opentui/solid/preload")
	await import("../src/solid-preload.js")
	const { createComponent } = await import("solid-js")
	const { ThemeProvider } = await import("@yeshwanthyk/open-tui")
	const { MessageList, buildContentItems } = await import("../src/components/MessageList.js")
	const { renderHumanTui } = await import("./helpers/tui-harness.js")
	const contentItems = buildContentItems(messages, [], true)

	return renderHumanTui(() => (
		createComponent(ThemeProvider, {
			mode: "dark",
			themeName: "marvin",
			get children() {
				return createComponent(MessageList, {
					contentItems,
					sessionKey: "test-session",
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
	it("keeps short transcripts unwindowed", async () => {
		const model = await loadMessageListModel()
		const messages: UIMessage[] = Array.from({ length: 4 }, (_, index) => ({
			id: `user-${index}`,
			role: "user",
			content: `prompt ${index}`,
		}))
		const items = model.buildContentItems(messages, [], true)
		const window = model.transcriptWindowForItems(items, 75)

		expect(window.startIndex).toBe(0)
		expect(window.endIndex).toBe(items.length)
		expect(window.hiddenBefore).toBe(0)
		expect(window.items).toEqual(items)
	})

	it("windows long transcripts from the tail by item index", async () => {
		const model = await loadMessageListModel()
		const messages: UIMessage[] = Array.from({ length: 100 }, (_, index) => ({
			id: `user-${index}`,
			role: "user",
			content: `prompt ${index}`,
		}))
		const items = model.buildContentItems(messages, [], true)
		const window = model.transcriptWindowForItems(items, 75)

		expect(window.startIndex).toBe(25)
		expect(window.endIndex).toBe(100)
		expect(window.hiddenBefore).toBe(25)
		expect(window.items).toHaveLength(75)
		expect(window.items[0]?.mark.id).toBe(items[25]?.mark.id)
		expect(window.items[74]?.mark.id).toBe(items[99]?.mark.id)
	})

	it("expands by chunks to include a hidden mark", async () => {
		const model = await loadMessageListModel()

		expect(model.expandedTranscriptWindowSizeForIndex(200, 75, 124)).toBe(150)
		expect(model.expandedTranscriptWindowSizeForIndex(200, 75, 49)).toBe(200)
		expect(model.expandedTranscriptWindowSizeForIndex(200, 180, 120)).toBe(180)
		expect(model.expandedTranscriptWindowSizeForIndex(10, 75, 0)).toBe(10)
	})

	it("preserves mark ids when expanding the transcript window", async () => {
		const model = await loadMessageListModel()
		const messages: UIMessage[] = Array.from({ length: 90 }, (_, index) => ({
			id: `user-${index}`,
			role: "user",
			content: `prompt ${index}`,
		}))
		const items = model.buildContentItems(messages, [], true)
		const initialWindow = model.transcriptWindowForItems(items, 75)
		const expandedWindow = model.transcriptWindowForItems(items, 90)

		expect(initialWindow.items.map((item) => item.mark.id)).toEqual(
			expandedWindow.items.slice(15).map((item) => item.mark.id)
		)
		expect(model.buildTranscriptMarkIds(messages, [], true)).toEqual(items.map((item) => item.mark.id))
	})

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

	it("reuses settled content items when only the streaming tail changes", async () => {
		const model = await loadMessageListModel()
		const cache = model.createTranscriptContentCache()
		const settled: UIMessage[] = [
			{ id: "user-1", role: "user", content: "inspect transcript rendering" },
			{
				id: "assistant-1",
				role: "assistant",
				content: "",
				contentBlocks: [{ type: "text", text: "settled answer" }],
			},
		]
		const firstTail: UIMessage = {
			id: "assistant-live",
			role: "assistant",
			content: "",
			isStreaming: true,
			contentBlocks: [{ type: "text", text: "one" }],
		}
		const secondTail: UIMessage = {
			id: "assistant-live",
			role: "assistant",
			content: "",
			isStreaming: true,
			contentBlocks: [{ type: "text", text: "one two" }],
		}

		const firstItems = model.buildContentItems([...settled, firstTail], [], true, cache)
		const secondItems = model.buildContentItems([...settled, secondTail], [], true, cache)

		expect(secondItems[0]).toBe(firstItems[0])
		expect(secondItems[1]).toBe(firstItems[1])
		expect(secondItems[2]).not.toBe(firstItems[2])
	})
})

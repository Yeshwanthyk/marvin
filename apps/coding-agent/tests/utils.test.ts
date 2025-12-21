import { describe, expect, it } from "bun:test"
import { extractText, extractThinking, extractOrderedBlocks } from "../src/utils.js"

describe("extractText", () => {
	it("extracts text from content blocks", () => {
		const content = [
			{ type: "text", text: "Hello " },
			{ type: "text", text: "world" },
		]
		expect(extractText(content)).toBe("Hello world")
	})

	it("ignores non-text blocks", () => {
		const content = [
			{ type: "thinking", thinking: "some thought" },
			{ type: "text", text: "visible" },
			{ type: "tool_use", id: "123", name: "bash" },
		]
		expect(extractText(content)).toBe("visible")
	})

	it("returns empty string for empty array", () => {
		expect(extractText([])).toBe("")
	})

	it("handles null/undefined in array", () => {
		const content = [null, undefined, { type: "text", text: "ok" }]
		expect(extractText(content as unknown[])).toBe("ok")
	})
})

describe("extractThinking", () => {
	it("extracts thinking block with summary", () => {
		const content = [
			{ type: "thinking", thinking: "This is a long thought that spans multiple lines.\nSecond line here.\nThird line." },
		]
		const result = extractThinking(content)
		expect(result).not.toBeNull()
		expect(result!.full).toContain("This is a long thought")
		expect(result!.summary.length).toBeLessThanOrEqual(83) // 80 + "..."
	})

	it("returns null when no thinking block", () => {
		const content = [{ type: "text", text: "hello" }]
		expect(extractThinking(content)).toBeNull()
	})

	it("truncates long summaries with ellipsis", () => {
		const longThought = "A".repeat(100)
		const content = [{ type: "thinking", thinking: longThought }]
		const result = extractThinking(content)
		expect(result).not.toBeNull()
		expect(result!.summary.endsWith("...")).toBe(true)
		expect(result!.summary.length).toBe(83)
	})

	it("handles empty array", () => {
		expect(extractThinking([])).toBeNull()
	})
})

describe("extractOrderedBlocks", () => {
	it("preserves interleaved order of thinking, text, and tools", () => {
		const content = [
			{ type: "thinking", thinking: "First thought with enough text to create summary" },
			{ type: "toolCall", id: "tool1", name: "bash", arguments: { command: "ls" } },
			{ type: "text", text: "First text" },
			{ type: "thinking", thinking: "Second thought with enough text to create summary" },
			{ type: "toolCall", id: "tool2", name: "read", arguments: { path: "file.txt" } },
			{ type: "text", text: "Second text" },
		]
		const blocks = extractOrderedBlocks(content)
		expect(blocks.length).toBe(6)
		expect(blocks[0].type).toBe("thinking")
		expect(blocks[1].type).toBe("toolCall")
		expect((blocks[1] as { type: "toolCall"; name: string }).name).toBe("bash")
		expect(blocks[2].type).toBe("text")
		expect((blocks[2] as { type: "text"; text: string }).text).toBe("First text")
		expect(blocks[3].type).toBe("thinking")
		expect(blocks[4].type).toBe("toolCall")
		expect((blocks[4] as { type: "toolCall"; name: string }).name).toBe("read")
		expect(blocks[5].type).toBe("text")
	})

	it("assigns unique ids to thinking blocks", () => {
		const content = [
			{ type: "thinking", thinking: "First thought" },
			{ type: "thinking", thinking: "Second thought" },
		]
		const blocks = extractOrderedBlocks(content)
		expect(blocks[0].type).toBe("thinking")
		expect(blocks[1].type).toBe("thinking")
		expect((blocks[0] as { type: "thinking"; id: string }).id).not.toBe((blocks[1] as { type: "thinking"; id: string }).id)
	})

	it("extracts tool call arguments", () => {
		const content = [
			{ type: "toolCall", id: "tc1", name: "bash", arguments: { command: "echo hello", timeout: 30 } },
		]
		const blocks = extractOrderedBlocks(content)
		expect(blocks.length).toBe(1)
		expect(blocks[0].type).toBe("toolCall")
		const toolBlock = blocks[0] as { type: "toolCall"; id: string; name: string; args: unknown }
		expect(toolBlock.id).toBe("tc1")
		expect(toolBlock.name).toBe("bash")
		expect(toolBlock.args).toEqual({ command: "echo hello", timeout: 30 })
	})

	it("handles empty array", () => {
		expect(extractOrderedBlocks([])).toEqual([])
	})

	it("ignores unknown block types", () => {
		const content = [
			{ type: "unknown", data: "ignored" },
			{ type: "text", text: "visible" },
		]
		const blocks = extractOrderedBlocks(content)
		expect(blocks.length).toBe(1)
		expect(blocks[0].type).toBe("text")
	})
})

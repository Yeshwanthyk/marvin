import { describe, expect, it } from "bun:test"
import { extractText, extractThinking } from "../src/utils.js"

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

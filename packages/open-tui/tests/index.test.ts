import { describe, expect, it } from "bun:test"
import { visibleWidth, stripAnsi, truncateToWidth } from "../src/utils/text-width"

describe("open-tui text utilities", () => {
	it("visibleWidth calculates width correctly", () => {
		expect(visibleWidth("hello")).toBe(5)
		expect(visibleWidth("🎉")).toBe(2) // emoji is 2 cells wide
		expect(visibleWidth("日本語")).toBe(6) // CJK chars are 2 cells each
	})

	it("stripAnsi removes ANSI codes", () => {
		expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red")
		expect(stripAnsi("\x1b[1;32mbold green\x1b[0m")).toBe("bold green")
		expect(stripAnsi("plain text")).toBe("plain text")
	})

	it("truncateToWidth truncates with ellipsis", () => {
		// The function adds \x1b[0m (reset code) before ellipsis
		const result = truncateToWidth("hello world", 8)
		expect(stripAnsi(result)).toBe("hello...")
		expect(visibleWidth(result)).toBe(8)
	})

	it("truncateToWidth returns short strings unchanged", () => {
		expect(truncateToWidth("short", 10)).toBe("short")
		expect(truncateToWidth("exact", 5)).toBe("exact")
	})

	it("truncateToWidth handles custom ellipsis", () => {
		const result = truncateToWidth("hello world", 8, "…")
		expect(stripAnsi(result)).toBe("hello w…")
		expect(visibleWidth(result)).toBe(8)
	})
})

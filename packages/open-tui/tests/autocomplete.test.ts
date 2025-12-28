import { describe, expect, it, beforeEach, mock } from "bun:test"
import { CombinedAutocompleteProvider } from "../src/autocomplete/autocomplete"

// Mock the file index to avoid filesystem dependencies
const mockSearch = mock(() => [
	{ path: "src/index.ts", isDirectory: false, score: 1 },
	{ path: "src/utils/", isDirectory: true, score: 0.9 },
	{ path: "package.json", isDirectory: false, score: 0.8 },
])

describe("CombinedAutocompleteProvider", () => {
	let provider: CombinedAutocompleteProvider

	beforeEach(() => {
		provider = new CombinedAutocompleteProvider(
			[
				{ name: "help", description: "Show help" },
				{ name: "quit", description: "Exit" },
			],
			"/test/path"
		)
		// @ts-expect-error - accessing private for testing
		provider.fileIndex.search = mockSearch
		// @ts-expect-error - mark as indexed
		provider.fileIndex.indexed = true
	})

	describe("slash commands", () => {
		it("completes command names starting with /", () => {
			const result = provider.getSuggestions(["/he"], 0, 3)
			expect(result).not.toBeNull()
			expect(result!.items).toHaveLength(1)
			expect(result!.items[0]!.value).toBe("help")
			expect(result!.prefix).toBe("/he")
		})

		it("returns all commands for just /", () => {
			const result = provider.getSuggestions(["/"], 0, 1)
			expect(result).not.toBeNull()
			expect(result!.items).toHaveLength(2)
		})

		it("returns null for non-matching command", () => {
			const result = provider.getSuggestions(["/xyz"], 0, 4)
			expect(result).toBeNull()
		})
	})

	describe("@ file attachments", () => {
		it("completes files with @ prefix", () => {
			const result = provider.getSuggestions(["@sr"], 0, 3)
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("@sr")
			// Values should have @ prefix
			for (const item of result!.items) {
				expect(item.value.startsWith("@")).toBe(true)
			}
		})

		it("completes @ after space", () => {
			const result = provider.getSuggestions(["hello @sr"], 0, 9)
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("@sr")
		})
	})

	describe("relative path completion (no @)", () => {
		it("completes relative paths without @ prefix", () => {
			const result = provider.getSuggestions(["src/"], 0, 4)
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("src/")
			// Values should NOT have @ prefix for path completion
			for (const item of result!.items) {
				expect(item.value.startsWith("@")).toBe(false)
			}
		})

		it("completes paths starting with ./", () => {
			const result = provider.getSuggestions(["./src"], 0, 5)
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("./src")
		})
	})

	describe("applyCompletion", () => {
		it("applies slash command with trailing space", () => {
			const result = provider.applyCompletion(
				["/he"],
				0,
				3,
				{ value: "help", label: "help" },
				"/he"
			)
			expect(result.lines[0]).toBe("/help ")
			expect(result.cursorCol).toBe(6)
		})

		it("applies @ file completion with trailing space", () => {
			const result = provider.applyCompletion(
				["@src"],
				0,
				4,
				{ value: "@src/index.ts", label: "index.ts" },
				"@src"
			)
			expect(result.lines[0]).toBe("@src/index.ts ")
			expect(result.cursorCol).toBe(14)
		})

		it("applies path completion without @", () => {
			const result = provider.applyCompletion(
				["src/"],
				0,
				4,
				{ value: "src/index.ts", label: "index.ts" },
				"src/"
			)
			expect(result.lines[0]).toBe("src/index.ts")
			expect(result.cursorCol).toBe(12)
		})
	})

	describe("edge cases", () => {
		it("handles empty input by returning file suggestions", () => {
			const result = provider.getSuggestions([""], 0, 0)
			// Empty input returns file suggestions for fuzzy search
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("")
		})

		it("handles multiline with cursor on different line", () => {
			const result = provider.getSuggestions(["first line", "/he"], 1, 3)
			expect(result).not.toBeNull()
			expect(result!.items[0]!.value).toBe("help")
		})

		it("triggers path completion when text contains /", () => {
			const result = provider.getSuggestions(["hello/world"], 0, 8)
			// Text containing / is treated as path completion
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("hello/wo")
		})
	})
})

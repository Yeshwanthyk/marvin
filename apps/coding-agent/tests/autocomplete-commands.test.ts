import { describe, expect, it } from "bun:test"
import { createAutocompleteCommands } from "../src/autocomplete-commands.js"
import { THEME_NAMES } from "../src/theme-names.js"

describe("autocomplete /theme", () => {
	it("suggests built-in themes", () => {
		const cmds = createAutocompleteCommands(() => ({ currentProvider: "openai" as any }))
		const theme = cmds.find((c) => c.name === "theme")
		expect(theme).toBeTruthy()
		const items = theme!.getArgumentCompletions!("a")
		expect(items.some((i) => i.value === "aura")).toBe(true)
	})
})

describe("THEME_NAMES", () => {
	it("contains marvin as first entry", () => {
		expect(THEME_NAMES[0]).toBe("marvin")
	})

	it("contains all expected themes", () => {
		// Verify some key themes exist
		expect(THEME_NAMES).toContain("aura")
		expect(THEME_NAMES).toContain("dracula")
		expect(THEME_NAMES).toContain("nord")
		expect(THEME_NAMES).toContain("tokyonight")
	})

	it("has no duplicates", () => {
		const unique = new Set(THEME_NAMES)
		expect(unique.size).toBe(THEME_NAMES.length)
	})
})

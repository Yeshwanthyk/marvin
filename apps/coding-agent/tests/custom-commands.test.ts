import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
	loadCustomCommands,
	expandCommand,
	tryExpandCustomCommand,
} from "@yeshwanthyk/runtime-effect/extensibility/custom-commands.js"

describe("loadCustomCommands", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "marvin-test-"))
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	test("returns empty map when commands dir doesn't exist", () => {
		const { commands, issues } = loadCustomCommands(tempDir)
		expect(commands.size).toBe(0)
		expect(issues.length).toBe(0)
	})

	test("loads .md files from commands directory", () => {
		const commandsDir = join(tempDir, "commands")
		mkdirSync(commandsDir)
		writeFileSync(join(commandsDir, "review.md"), "Please review the following code:\n\n$ARGUMENTS")
		writeFileSync(join(commandsDir, "explain.md"), "Explain this code in detail")

		const { commands, issues } = loadCustomCommands(tempDir)

		expect(commands.size).toBe(2)
		expect(commands.has("review")).toBe(true)
		expect(commands.has("explain")).toBe(true)
		expect(commands.get("review")?.template).toContain("$ARGUMENTS")
		expect(commands.get("explain")?.description).toBe("Explain this code in detail")
		expect(issues.length).toBe(0)
	})

	test("ignores non-.md files", () => {
		const commandsDir = join(tempDir, "commands")
		mkdirSync(commandsDir)
		writeFileSync(join(commandsDir, "valid.md"), "Valid command")
		writeFileSync(join(commandsDir, "invalid.txt"), "Invalid file")
		writeFileSync(join(commandsDir, "also-invalid.json"), "{}")

		const { commands, issues } = loadCustomCommands(tempDir)

		expect(commands.size).toBe(1)
		expect(commands.has("valid")).toBe(true)
		expect(issues.length).toBe(0)
	})

	test("ignores files with invalid names", () => {
		const commandsDir = join(tempDir, "commands")
		mkdirSync(commandsDir)
		writeFileSync(join(commandsDir, "valid-name.md"), "Valid")
		writeFileSync(join(commandsDir, "valid_name2.md"), "Also valid")
		writeFileSync(join(commandsDir, "-invalid.md"), "Invalid: starts with dash")
		writeFileSync(join(commandsDir, "_invalid.md"), "Invalid: starts with underscore")
		writeFileSync(join(commandsDir, "has spaces.md"), "Invalid: has spaces")

		const { commands, issues } = loadCustomCommands(tempDir)

		expect(commands.size).toBe(2)
		expect(commands.has("valid-name")).toBe(true)
		expect(commands.has("valid_name2")).toBe(true)
		expect(issues.length).toBe(3)
	})

	test("extracts description from first non-empty line", () => {
		const commandsDir = join(tempDir, "commands")
		mkdirSync(commandsDir)
		writeFileSync(join(commandsDir, "test.md"), "\n\n  First real line here\n\nMore content")

		const { commands, issues } = loadCustomCommands(tempDir)

		expect(commands.get("test")?.description).toBe("First real line here")
		expect(issues.length).toBe(0)
	})

	test("truncates long descriptions", () => {
		const commandsDir = join(tempDir, "commands")
		mkdirSync(commandsDir)
		const longLine = "A".repeat(100)
		writeFileSync(join(commandsDir, "long.md"), longLine)

		const { commands, issues } = loadCustomCommands(tempDir)

		const desc = commands.get("long")?.description || ""
		expect(desc.length).toBeLessThanOrEqual(60)
		expect(desc.endsWith("...")).toBe(true)
		expect(issues.length).toBe(0)
	})
})

describe("expandCommand", () => {
	test("replaces $ARGUMENTS placeholder", () => {
		const template = "Review this: $ARGUMENTS"
		const result = expandCommand(template, "  some code  ")

		expect(result).toBe("Review this: some code")
	})

	test("replaces multiple $ARGUMENTS placeholders", () => {
		const template = "First: $ARGUMENTS\nSecond: $ARGUMENTS"
		const result = expandCommand(template, "value")

		expect(result).toBe("First: value\nSecond: value")
	})

	test("appends args when no placeholder and args exist", () => {
		const template = "Do something useful"
		const result = expandCommand(template, "with this input")

		expect(result).toBe("Do something useful\n\nwith this input")
	})

	test("returns template unchanged when no placeholder and no args", () => {
		const template = "Just a template"
		const result = expandCommand(template, "   ")

		expect(result).toBe("Just a template")
	})

	test("handles empty args with placeholder", () => {
		const template = "Value: [$ARGUMENTS]"
		const result = expandCommand(template, "")

		expect(result).toBe("Value: []")
	})
})

describe("tryExpandCustomCommand", () => {
	const builtInNames = new Set(["clear", "exit", "model"])

	test("returns null for non-slash input", () => {
		const commands = new Map([["test", { name: "test", description: "Test", template: "Template" }]])
		const result = tryExpandCustomCommand("not a command", builtInNames, commands)

		expect(result).toBeNull()
	})

	test("returns null for built-in commands", () => {
		const commands = new Map([["clear", { name: "clear", description: "Custom clear", template: "Template" }]])
		const result = tryExpandCustomCommand("/clear", builtInNames, commands)

		expect(result).toBeNull()
	})

	test("expands custom command without args", () => {
		const commands = new Map([["review", { name: "review", description: "Review", template: "Review the code" }]])
		const result = tryExpandCustomCommand("/review", builtInNames, commands)

		expect(result).toBe("Review the code")
	})

	test("expands custom command with args", () => {
		const commands = new Map([
			["review", { name: "review", description: "Review", template: "Review: $ARGUMENTS" }],
		])
		const result = tryExpandCustomCommand("/review this code", builtInNames, commands)

		expect(result).toBe("Review: this code")
	})

	test("returns null for unknown commands", () => {
		const commands = new Map([["review", { name: "review", description: "Review", template: "Template" }]])
		const result = tryExpandCustomCommand("/unknown arg", builtInNames, commands)

		expect(result).toBeNull()
	})

	test("handles extra whitespace in input", () => {
		const commands = new Map([
			["test", { name: "test", description: "Test", template: "Args: $ARGUMENTS" }],
		])
		const result = tryExpandCustomCommand("  /test   some args  ", builtInNames, commands)

		expect(result).toBe("Args: some args")
	})
})

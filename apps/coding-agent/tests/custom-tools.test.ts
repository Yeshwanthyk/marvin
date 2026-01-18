import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	loadCustomTools,
	getToolNames,
} from "@marvin-agents/runtime-effect/extensibility/custom-tools/loader.js"
import type { SendRef } from "@marvin-agents/runtime-effect/extensibility/custom-tools/types.js"

describe("custom-tools", () => {
	let tempDir: string
	let configDir: string
	let toolsDir: string
	const cwd = process.cwd()
	const sendRef: SendRef = { current: () => {} }

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "marvin-custom-tools-test-"))
		configDir = tempDir
		toolsDir = join(configDir, "tools")
		mkdirSync(toolsDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	describe("loadCustomTools", () => {
		test("returns empty for nonexistent directory", async () => {
			const nonExistentDir = join(tempDir, "nonexistent")
			const result = await loadCustomTools(nonExistentDir, cwd, [], sendRef)
			expect(result.tools).toEqual([])
			expect(result.issues).toEqual([])
		})

		test("returns empty for empty directory", async () => {
			const result = await loadCustomTools(configDir, cwd, [], sendRef)
			expect(result.tools).toEqual([])
			expect(result.issues).toEqual([])
		})

		// Note: Tests that load actual tool files require @sinclair/typebox to be
		// resolvable from the temp directory. These are better as integration tests.
		// Here we test the loader's structural behavior with simpler cases.

		test("loads valid tool module without external imports", async () => {
			// Tool that doesn't import external modules
			const toolCode = `
export default function(api) {
	return {
		name: "test-tool",
		label: "Test Tool",
		description: "A test tool",
		parameters: { type: "object", properties: { input: { type: "string" } } },
		execute: async (toolCallId, params) => ({
			content: [{ type: "text", text: "result: " + params.input }],
			details: {}
		})
	}
}
`
			writeFileSync(join(toolsDir, "test-tool.ts"), toolCode)

			const result = await loadCustomTools(configDir, cwd, [], sendRef)
			expect(result.issues).toEqual([])
			expect(result.tools.length).toBe(1)
			expect(result.tools[0]!.tool.name).toBe("test-tool")
		})

		test("loads multiple tools from array export", async () => {
			const toolCode = `
export default function(api) {
	return [
		{
			name: "tool-one",
			label: "Tool One",
			description: "First tool",
			parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text", text: "one" }], details: {} })
		},
		{
			name: "tool-two",
			label: "Tool Two",
			description: "Second tool",
			parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text", text: "two" }], details: {} })
		}
	]
}
`
			writeFileSync(join(toolsDir, "multi-tool.ts"), toolCode)

			const result = await loadCustomTools(configDir, cwd, [], sendRef)
			expect(result.issues).toEqual([])
			expect(result.tools.length).toBe(2)
			expect(result.tools.map((t) => t.tool.name).sort()).toEqual(["tool-one", "tool-two"])
		})

		test("reports conflict with built-in tool name", async () => {
			const toolCode = `
export default function(api) {
	return {
		name: "bash",
		label: "Fake Bash",
		description: "Conflicts with built-in",
		parameters: { type: "object", properties: {} },
		execute: async () => ({ content: [], details: {} })
	}
}
`
			writeFileSync(join(toolsDir, "conflict.ts"), toolCode)

			const result = await loadCustomTools(configDir, cwd, ["bash", "read", "write", "edit"], sendRef)
			expect(result.tools).toEqual([])
			expect(result.issues.length).toBeGreaterThanOrEqual(1)
			expect(result.issues[0]?.message).toContain('conflicts with existing tool')
		})

		test("reports conflict between custom tools", async () => {
			const tool1 = `
export default (api) => ({
	name: "duplicate",
	label: "First",
	description: "First instance",
	parameters: { type: "object", properties: {} },
	execute: async () => ({ content: [], details: {} })
})
`
			const tool2 = `
export default (api) => ({
	name: "duplicate",
	label: "Second",
	description: "Second instance",
	parameters: { type: "object", properties: {} },
	execute: async () => ({ content: [], details: {} })
})
`
			writeFileSync(join(toolsDir, "first.ts"), tool1)
			writeFileSync(join(toolsDir, "second.ts"), tool2)

			const result = await loadCustomTools(configDir, cwd, [], sendRef)
			// One succeeds, one fails due to conflict
			expect(result.tools.length).toBe(1)
			expect(result.issues.length).toBeGreaterThanOrEqual(1)
			expect(result.issues[0]?.message).toContain('conflicts with existing tool')
		})

		test("reports error for non-function export", async () => {
			writeFileSync(join(toolsDir, "invalid.ts"), 'export default "not a function"')

			const result = await loadCustomTools(configDir, cwd, [], sendRef)
			expect(result.tools).toEqual([])
			expect(result.issues.length).toBeGreaterThanOrEqual(1)
			expect(result.issues[0]?.message).toContain("must export a default function")
		})

		test("ignores non-.ts files", async () => {
			writeFileSync(join(toolsDir, "readme.md"), "# Not a tool")
			writeFileSync(join(toolsDir, "config.json"), '{}')

			const result = await loadCustomTools(configDir, cwd, [], sendRef)
			expect(result.tools).toEqual([])
			expect(result.issues).toEqual([])
		})

		test("tool receives cwd in api", async () => {
			const toolCode = `
export default function(api) {
	return {
		name: "cwd-test",
		label: "CWD Test",
		description: "Returns cwd",
		parameters: { type: "object", properties: {} },
		execute: async () => ({
			content: [{ type: "text", text: api.cwd }],
			details: { cwd: api.cwd }
		})
	}
}
`
			writeFileSync(join(toolsDir, "cwd-test.ts"), toolCode)

			const result = await loadCustomTools(configDir, cwd, [], sendRef)
			expect(result.issues).toEqual([])
			expect(result.tools.length).toBe(1)

			// Execute the tool to verify it has access to cwd
			const execResult = await result.tools[0]!.tool.execute("test-call", {})
			expect(execResult.content[0]).toEqual({ type: "text", text: cwd })
		})

		test("tool can use exec api", async () => {
			const toolCode = `
export default function(api) {
	return {
		name: "exec-test",
		label: "Exec Test",
		description: "Uses exec API",
		parameters: { type: "object", properties: {} },
		execute: async () => {
			const result = await api.exec("echo", ["hello"])
			return {
				content: [{ type: "text", text: result.stdout.trim() }],
				details: result
			}
		}
	}
}
`
			writeFileSync(join(toolsDir, "exec-test.ts"), toolCode)

			const result = await loadCustomTools(configDir, cwd, [], sendRef)
			expect(result.issues).toEqual([])
			expect(result.tools.length).toBe(1)

			const execResult = await result.tools[0]!.tool.execute("test-call", {})
			expect(execResult.content[0]).toEqual({ type: "text", text: "hello" })
		})

		test("tool can use send api", async () => {
			const messages: string[] = []
			const testSendRef: SendRef = { current: (text) => messages.push(text) }

			const toolCode = `
export default function(api) {
	return {
		name: "send-test",
		label: "Send Test",
		description: "Uses send API",
		parameters: { type: "object", properties: {} },
		execute: async () => {
			api.send("hello from tool")
			return {
				content: [{ type: "text", text: "sent" }],
				details: {}
			}
		}
	}
}
`
			writeFileSync(join(toolsDir, "send-test.ts"), toolCode)

			const result = await loadCustomTools(configDir, cwd, [], testSendRef)
			expect(result.issues).toEqual([])
			expect(result.tools.length).toBe(1)

			await result.tools[0]!.tool.execute("test-call", {})
			expect(messages).toEqual(["hello from tool"])
		})
	})

	describe("getToolNames", () => {
		test("extracts names from tools", () => {
			const tools = [
				{ name: "tool-a", label: "", description: "", parameters: {}, execute: async () => ({ content: [], details: {} }) },
				{ name: "tool-b", label: "", description: "", parameters: {}, execute: async () => ({ content: [], details: {} }) },
			] as any
			expect(getToolNames(tools)).toEqual(["tool-a", "tool-b"])
		})

		test("returns empty array for empty tools", () => {
			expect(getToolNames([])).toEqual([])
		})
	})
})

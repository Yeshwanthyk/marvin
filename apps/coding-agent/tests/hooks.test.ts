/**
 * Tests for the hook system
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadHooks, HookRunner, wrapToolWithHooks } from "../src/hooks/index.js"
import type { AgentTool, AgentToolResult } from "@marvin-agents/ai"

describe("hooks loader", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "marvin-hooks-test-"))
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	it("returns empty result when hooks directory does not exist", async () => {
		const result = await loadHooks(tempDir)
		expect(result.hooks).toHaveLength(0)
		expect(result.errors).toHaveLength(0)
	})

	it("loads hook modules from hooks directory", async () => {
		const hooksDir = join(tempDir, "hooks")
		mkdirSync(hooksDir)

		writeFileSync(
			join(hooksDir, "test-hook.ts"),
			`export default function(marvin) {
				marvin.on("app.start", async () => {})
			}`
		)

		const result = await loadHooks(tempDir)
		expect(result.hooks).toHaveLength(1)
		expect(result.hooks[0]?.path).toContain("test-hook.ts")
		expect(result.hooks[0]?.handlers.get("app.start")).toHaveLength(1)
		expect(result.errors).toHaveLength(0)
	})

	it("reports error for hooks without default export function", async () => {
		const hooksDir = join(tempDir, "hooks")
		mkdirSync(hooksDir)

		writeFileSync(
			join(hooksDir, "bad-hook.ts"),
			`export const foo = "bar"`
		)

		const result = await loadHooks(tempDir)
		expect(result.hooks).toHaveLength(0)
		expect(result.errors).toHaveLength(1)
		expect(result.errors[0]?.error).toContain("must export a default function")
	})

	it("ignores non-.ts files", async () => {
		const hooksDir = join(tempDir, "hooks")
		mkdirSync(hooksDir)

		writeFileSync(join(hooksDir, "readme.md"), "# readme")
		writeFileSync(join(hooksDir, "config.json"), "{}")

		const result = await loadHooks(tempDir)
		expect(result.hooks).toHaveLength(0)
		expect(result.errors).toHaveLength(0)
	})

	it("supports multiple event handlers from single hook", async () => {
		const hooksDir = join(tempDir, "hooks")
		mkdirSync(hooksDir)

		writeFileSync(
			join(hooksDir, "multi.ts"),
			`export default function(marvin) {
				marvin.on("app.start", async () => {})
				marvin.on("agent.start", async () => {})
				marvin.on("agent.end", async () => {})
			}`
		)

		const result = await loadHooks(tempDir)
		expect(result.hooks).toHaveLength(1)
		expect(result.hooks[0]?.handlers.get("app.start")).toHaveLength(1)
		expect(result.hooks[0]?.handlers.get("agent.start")).toHaveLength(1)
		expect(result.hooks[0]?.handlers.get("agent.end")).toHaveLength(1)
	})
})

describe("hooks runner", () => {
	let tempDir: string
	let hooksDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "marvin-hooks-test-"))
		hooksDir = join(tempDir, "hooks")
		mkdirSync(hooksDir)
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	it("emits events to registered handlers", async () => {
		const events: string[] = []

		writeFileSync(
			join(hooksDir, "tracking.ts"),
			`export default function(marvin) {
				marvin.on("app.start", async () => {
					(globalThis as any).hookEvents = (globalThis as any).hookEvents || []
					;(globalThis as any).hookEvents.push("app.start")
				})
			}`
		)

		const { hooks } = await loadHooks(tempDir)
		const runner = new HookRunner(hooks, process.cwd(), tempDir)

		await runner.emit({ type: "app.start" })

		expect((globalThis as any).hookEvents).toContain("app.start")
		delete (globalThis as any).hookEvents
	})

	it("reports errors from handlers without crashing", async () => {
		writeFileSync(
			join(hooksDir, "error.ts"),
			`export default function(marvin) {
				marvin.on("app.start", async () => {
					throw new Error("test error")
				})
			}`
		)

		const { hooks } = await loadHooks(tempDir)
		const runner = new HookRunner(hooks, process.cwd(), tempDir)

		const errors: any[] = []
		runner.onError((err) => errors.push(err))

		// Should not throw
		await runner.emit({ type: "app.start" })

		expect(errors).toHaveLength(1)
		expect(errors[0]?.error).toContain("test error")
	})

	it("hasHandlers returns correct value", async () => {
		writeFileSync(
			join(hooksDir, "partial.ts"),
			`export default function(marvin) {
				marvin.on("app.start", async () => {})
			}`
		)

		const { hooks } = await loadHooks(tempDir)
		const runner = new HookRunner(hooks, process.cwd(), tempDir)

		expect(runner.hasHandlers("app.start")).toBe(true)
		expect(runner.hasHandlers("agent.start")).toBe(false)
	})
})

describe("turn.end with usage", () => {
	let tempDir: string
	let hooksDir: string

	// Minimal mock message for tests
	const mockMessage = { role: "assistant", content: [], timestamp: Date.now() } as any

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "marvin-hooks-test-"))
		hooksDir = join(tempDir, "hooks")
		mkdirSync(hooksDir)
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	it("receives usage data on turn.end event", async () => {
		writeFileSync(
			join(hooksDir, "usage-tracker.ts"),
			`export default function(marvin) {
				marvin.on("turn.end", async (event) => {
					(globalThis as any).lastUsage = event.usage
				})
			}`
		)

		const { hooks } = await loadHooks(tempDir)
		const runner = new HookRunner(hooks, process.cwd(), tempDir)

		await runner.emit({
			type: "turn.end",
			turnIndex: 0,
			message: mockMessage,
			toolResults: [],
			usage: { current: 50000, max: 100000, percent: 50 },
		})

		expect((globalThis as any).lastUsage).toEqual({ current: 50000, max: 100000, percent: 50 })
		delete (globalThis as any).lastUsage
	})

	it("can trigger send on high usage", async () => {
		const sentMessages: string[] = []

		writeFileSync(
			join(hooksDir, "auto-compact.ts"),
			`let triggered = false
			export default function(marvin) {
				marvin.on("turn.end", async (event) => {
					if (event.usage && event.usage.percent >= 85 && !triggered) {
						triggered = true
						marvin.send("/compact")
					}
				})
			}`
		)

		const { hooks } = await loadHooks(tempDir)
		const runner = new HookRunner(hooks, process.cwd(), tempDir)
		runner.setSendHandler((text) => sentMessages.push(text))

		// First turn at 50% - no compact
		await runner.emit({
			type: "turn.end",
			turnIndex: 0,
			message: mockMessage,
			toolResults: [],
			usage: { current: 50000, max: 100000, percent: 50 },
		})
		expect(sentMessages).toEqual([])

		// Second turn at 90% - triggers compact
		await runner.emit({
			type: "turn.end",
			turnIndex: 1,
			message: mockMessage,
			toolResults: [],
			usage: { current: 90000, max: 100000, percent: 90 },
		})
		expect(sentMessages).toEqual(["/compact"])

		// Third turn still high - should not trigger again
		await runner.emit({
			type: "turn.end",
			turnIndex: 2,
			message: mockMessage,
			toolResults: [],
			usage: { current: 92000, max: 100000, percent: 92 },
		})
		expect(sentMessages).toEqual(["/compact"])
	})
})

describe("hooks send", () => {
	let tempDir: string
	let hooksDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "marvin-hooks-test-"))
		hooksDir = join(tempDir, "hooks")
		mkdirSync(hooksDir)
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	it("routes send() calls to the registered handler", async () => {
		const sentMessages: string[] = []

		writeFileSync(
			join(hooksDir, "sender.ts"),
			`export default function(marvin) {
				marvin.on("app.start", async () => {
					marvin.send("hello from hook")
				})
			}`
		)

		const { hooks } = await loadHooks(tempDir)
		const runner = new HookRunner(hooks, process.cwd(), tempDir)
		runner.setSendHandler((text) => sentMessages.push(text))

		await runner.emit({ type: "app.start" })

		expect(sentMessages).toEqual(["hello from hook"])
	})
})

describe("tool wrapper", () => {
	let tempDir: string
	let hooksDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "marvin-hooks-test-"))
		hooksDir = join(tempDir, "hooks")
		mkdirSync(hooksDir)
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	it("blocks tool execution when hook returns block: true", async () => {
		writeFileSync(
			join(hooksDir, "blocker.ts"),
			`export default function(marvin) {
				marvin.on("tool.execute.before", async (event) => {
					if (event.toolName === "blocked-tool") {
						return { block: true, reason: "Not allowed" }
					}
				})
			}`
		)

		const { hooks } = await loadHooks(tempDir)
		const runner = new HookRunner(hooks, process.cwd(), tempDir)

		const mockTool: AgentTool<any, any> = {
			name: "blocked-tool",
			label: "Blocked Tool",
			description: "A tool that should be blocked",
			parameters: { type: "object", properties: {} } as any,
			execute: async () => ({ content: [{ type: "text", text: "success" }], details: undefined }),
		}

		const wrappedTool = wrapToolWithHooks(mockTool, runner)

		let error: Error | null = null
		try {
			await wrappedTool.execute("call-1", {})
		} catch (e) {
			error = e as Error
		}

		expect(error).not.toBeNull()
		expect(error?.message).toBe("Not allowed")
	})

	it("allows tool execution when hook does not block", async () => {
		writeFileSync(
			join(hooksDir, "allow.ts"),
			`export default function(marvin) {
				marvin.on("tool.execute.before", async (event) => {
					// Don't return block
				})
			}`
		)

		const { hooks } = await loadHooks(tempDir)
		const runner = new HookRunner(hooks, process.cwd(), tempDir)

		const mockTool: AgentTool<any, any> = {
			name: "allowed-tool",
			label: "Allowed Tool",
			description: "A tool that should run",
			parameters: { type: "object", properties: {} } as any,
			execute: async () => ({ content: [{ type: "text", text: "success" }], details: undefined }),
		}

		const wrappedTool = wrapToolWithHooks(mockTool, runner)
		const result = await wrappedTool.execute("call-1", {})

		expect(result.content[0]).toEqual({ type: "text", text: "success" })
	})

	it("allows tool.execute.after to modify result", async () => {
		writeFileSync(
			join(hooksDir, "modify.ts"),
			`export default function(marvin) {
				marvin.on("tool.execute.after", async (event) => {
					return {
						content: [{ type: "text", text: "modified: " + event.content[0].text }],
					}
				})
			}`
		)

		const { hooks } = await loadHooks(tempDir)
		const runner = new HookRunner(hooks, process.cwd(), tempDir)

		const mockTool: AgentTool<any, any> = {
			name: "modifiable-tool",
			label: "Modifiable Tool",
			description: "A tool whose result can be modified",
			parameters: { type: "object", properties: {} } as any,
			execute: async () => ({ content: [{ type: "text", text: "original" }], details: undefined }),
		}

		const wrappedTool = wrapToolWithHooks(mockTool, runner)
		const result = await wrappedTool.execute("call-1", {})

		expect(result.content[0]).toEqual({ type: "text", text: "modified: original" })
	})
})

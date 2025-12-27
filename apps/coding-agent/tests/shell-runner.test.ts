import { describe, expect, test } from "bun:test"
import { runShellCommand } from "../src/shell-runner.js"

describe("shell-runner", () => {
	test("executes simple command", async () => {
		const result = await runShellCommand("echo hello")
		expect(result.output.trim()).toBe("hello")
		expect(result.exitCode).toBe(0)
		expect(result.truncated).toBe(false)
		expect(result.cancelled).toBe(false)
	})

	test("captures exit code", async () => {
		const result = await runShellCommand("exit 42")
		expect(result.exitCode).toBe(42)
	})

	test("captures stderr", async () => {
		const result = await runShellCommand("echo error >&2")
		expect(result.output.trim()).toBe("error")
	})

	test("respects timeout", async () => {
		const result = await runShellCommand("sleep 10", { timeout: 100 })
		expect(result.cancelled).toBe(true)
	})

	test("truncates large output", async () => {
		// Generate output that exceeds 100KB (DEFAULT_MAX_BYTES)
		// yes outputs "y\n" (2 bytes), so 60000 lines = 120KB > 100KB limit
		const result = await runShellCommand("yes | head -n 60000")
		expect(result.truncated).toBe(true)
		// tempFilePath is set when output exceeds threshold during streaming
		expect(result.tempFilePath).toBeDefined()
	})
})

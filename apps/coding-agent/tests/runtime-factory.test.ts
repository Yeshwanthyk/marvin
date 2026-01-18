import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createRuntime } from "../src/runtime/factory.js"
import { createTestConfigDir } from "./helpers/config.js"

const runtimes: Array<{ cleanup: () => Promise<void> | void }> = []

afterEach(async () => {
	while (runtimes.length) {
		const { cleanup } = runtimes.pop()!
		await cleanup()
	}
})

describe("runtime factory", () => {
	it("creates runtime context for the headless adapter", async () => {
		const config = createTestConfigDir()
		const runtime = await createRuntime({ configDir: config.configDir, configPath: config.configPath }, "headless")
		runtimes.push({
			cleanup: async () => {
				await runtime.close().catch(() => {})
				config.cleanup()
			},
		})

		expect(runtime.adapter).toBe("headless")
		expect(runtime.customCommands.size).toBe(0)
		expect(runtime.validationIssues).toHaveLength(0)
	})

	it("surfaces validation issues from invalid extensions", async () => {
		const config = createTestConfigDir()
		const commandsDir = join(config.configDir, "commands")
		mkdirSync(commandsDir, { recursive: true })
		writeFileSync(join(commandsDir, "bad name.md"), "")

		const runtime = await createRuntime({ configDir: config.configDir, configPath: config.configPath }, "headless")
		runtimes.push({
			cleanup: async () => {
				await runtime.close().catch(() => {})
				config.cleanup()
			},
		})

		expect(runtime.validationIssues.length).toBeGreaterThan(0)
		expect(runtime.validationIssues[0]?.path).toContain("bad name.md")
	})
})

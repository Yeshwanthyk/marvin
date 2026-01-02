import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { createTestConfigDir } from "./helpers/config.js"

const repoRoot = new URL("../../..", import.meta.url).pathname

const runCli = (args: string[]) =>
	spawnSync(process.execPath, ["apps/coding-agent/src/index.ts", ...args], {
		cwd: repoRoot,
		env: { ...process.env, NO_COLOR: "1" },
		encoding: "utf8",
	})

describe("marvin CLI", () => {
	it("prints help text", () => {
		const result = runCli(["--help"])
		expect(result.status).toBe(0)
		expect(result.stdout).toContain("Usage:")
		expect(result.stdout).toContain("marvin validate")
	})

	it("validates config directories", () => {
		const config = createTestConfigDir()
		const result = runCli(["validate", "--config-dir", config.configDir])
		config.cleanup()

		expect(result.status).toBe(0)
		expect(result.stdout).toContain("No validation issues")
	})
})

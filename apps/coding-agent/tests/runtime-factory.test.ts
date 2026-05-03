import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createHookToolAdapter } from "@yeshwanthyk/runtime-effect/hooks/hook-tool-adapter.js"
import type { HookEventContext, RegisteredTool } from "@yeshwanthyk/runtime-effect/hooks/types.js"
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

	it("loads extension modules from the extensions directory", async () => {
		const config = createTestConfigDir()
		const extensionsDir = join(config.configDir, "extensions")
		mkdirSync(extensionsDir, { recursive: true })
		writeFileSync(
			join(extensionsDir, "hello.ts"),
			`export default function (marvin) {
				marvin.registerCommand("hello-ext", {
					description: "hello from extension",
					handler: async () => {}
				})
			}`,
		)

		const runtime = await createRuntime({ configDir: config.configDir, configPath: config.configPath }, "headless")
		runtimes.push({
			cleanup: async () => {
				await runtime.close().catch(() => {})
				config.cleanup()
			},
		})

		expect(runtime.hookRunner.getCommand("hello-ext")?.description).toBe("hello from extension")
	})

	it("honors package manifests in discovered extension directories", async () => {
		const config = createTestConfigDir()
		const packageDir = join(config.configDir, "extensions", "manifest-package")
		mkdirSync(join(packageDir, "src"), { recursive: true })
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				type: "module",
				pi: { extensions: ["./src/entry.ts"] },
			}),
		)
		writeFileSync(
			join(packageDir, "src", "entry.ts"),
			`export default function (marvin) {
				marvin.registerCommand("manifest-ext", {
					description: "loaded from manifest",
					handler: async () => {}
				})
			}`,
		)

		const runtime = await createRuntime({ configDir: config.configDir, configPath: config.configPath }, "headless")
		runtimes.push({
			cleanup: async () => {
				await runtime.close().catch(() => {})
				config.cleanup()
			},
		})

		expect(runtime.hookRunner.getCommand("manifest-ext")?.description).toBe("loaded from manifest")
	})

	it("does not auto-discover managed npm install internals as extensions", async () => {
		const config = createTestConfigDir()
		const managedPackageDir = join(config.configDir, "extensions", "npm", "node_modules", "managed-package")
		mkdirSync(managedPackageDir, { recursive: true })
		writeFileSync(
			join(managedPackageDir, "index.js"),
			`throw new Error("managed package dependency should not be auto-loaded")`,
		)

		const runtime = await createRuntime({ configDir: config.configDir, configPath: config.configPath }, "headless")
		runtimes.push({
			cleanup: async () => {
				await runtime.close().catch(() => {})
				config.cleanup()
			},
		})

		expect(runtime.validationIssues).toHaveLength(0)
	})

	it("rewrites Pi package imports to Marvin runtime packages", async () => {
		const config = createTestConfigDir()
		const packageDir = join(config.configDir, "extensions", "pi-shim-package")
		mkdirSync(join(packageDir, "node_modules", "@mariozechner", "pi-ai"), { recursive: true })
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				type: "module",
				pi: { extensions: ["./index.ts"] },
			}),
		)
		writeFileSync(
			join(packageDir, "node_modules", "@mariozechner", "pi-ai", "package.json"),
			JSON.stringify({
				name: "@mariozechner/pi-ai",
				version: "0.0.0-marvin-compat",
				type: "module",
				main: "./index.js",
			}),
		)
		writeFileSync(
			join(packageDir, "node_modules", "@mariozechner", "pi-ai", "index.js"),
			`export * from "@yeshwanthyk/ai";\n`,
		)
		writeFileSync(
			join(packageDir, "index.ts"),
			`import { getModels } from "@mariozechner/pi-ai";
			export default function (marvin) {
				marvin.registerCommand("pi-ai-shim", {
					description: String(getModels("codex").length),
					handler: async () => {}
				})
			}`,
		)

		const runtime = await createRuntime({ configDir: config.configDir, configPath: config.configPath }, "headless")
		runtimes.push({
			cleanup: async () => {
				await runtime.close().catch(() => {})
				config.cleanup()
			},
		})

		expect(runtime.validationIssues).toHaveLength(0)
		expect(runtime.hookRunner.getCommand("pi-ai-shim")?.description).toBe("5")
	})

	it("invokes two-argument Pi tool execute handlers with toolCallId and params", async () => {
		let received: { toolCallId?: unknown; params?: unknown } = {}
		const tool: RegisteredTool = {
			name: "pi_two_arg",
			description: "two arg pi tool",
			parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
			execute: async (toolCallId, params) => {
				received = { toolCallId, params }
				return { content: [{ type: "text", text: `Hello ${(params as { name: string }).name}` }], details: {} }
			},
		}

		const adapted = createHookToolAdapter(tool, () => ({}) as HookEventContext)
		const result = await adapted.execute("call-1", { name: "Ada" })

		expect(received).toEqual({ toolCallId: "call-1", params: { name: "Ada" } })
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toBe("Hello Ada")
	})
})

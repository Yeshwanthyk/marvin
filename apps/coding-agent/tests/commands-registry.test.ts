import { describe, it, expect, mock } from "bun:test"
import { CommandRegistry, type CommandContext } from "../src/commands.js"

const createStubContext = (): CommandContext => ({
	agent: {} as any,
	sessionManager: {} as any,
	configDir: ".",
	configPath: "~/.config/marvin/config.json",
	cwd: process.cwd(),
	codexTransport: {} as any,
	getApiKey: () => undefined,
	currentProvider: "anthropic",
	currentModelId: "claude-3-sonnet",
	currentThinking: "off",
	setCurrentProvider: () => {},
	setCurrentModelId: () => {},
	setCurrentThinking: () => {},
	isResponding: () => false,
	setIsResponding: () => {},
	setActivityState: () => {},
	setMessages: () => {},
	setToolBlocks: () => {},
	setContextTokens: () => {},
	setCacheStats: () => {},
	setDisplayModelId: () => {},
	setDisplayThinking: () => {},
	setDisplayContextWindow: () => {},
	setDiffWrapMode: () => {},
	setConcealMarkdown: () => {},
	runImmediatePrompt: async () => {},
	steer: async () => {},
	followUp: async () => {},
	sendUserMessage: async () => {},
})

describe("CommandRegistry", () => {
	it("returns false for non-slash input", async () => {
		const registry = new CommandRegistry()
		const ctx = createStubContext()
		const handled = await registry.execute("hello", ctx)
		expect(handled).toBe(false)
	})

	it("executes registered commands", async () => {
		const registry = new CommandRegistry()
		const ctx = createStubContext()
		const handler = mock(() => true)
		registry.register({ name: "test", execute: (_args, _ctx) => handler() })

		const handled = await registry.execute("/test some args", ctx)
		expect(handled).toBe(true)
		expect(handler).toHaveBeenCalledTimes(1)
	})

	it("supports aliases and case-insensitive lookup", async () => {
		const registry = new CommandRegistry()
		const ctx = createStubContext()
		const handler = mock(() => true)
		registry.register({ name: "sample", aliases: ["S", "alias"], execute: () => handler() })

		expect(await registry.execute("/Alias", ctx)).toBe(true)
		expect(handler).toHaveBeenCalledTimes(1)
	})
})

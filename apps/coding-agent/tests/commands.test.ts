import { describe, expect, it, mock, beforeEach } from "bun:test"
import { handleSlashCommand, resolveProvider, THINKING_LEVELS, type CommandContext } from "../src/commands.js"

describe("resolveProvider", () => {
	it("resolves valid provider", () => {
		expect(resolveProvider("anthropic")).toBe("anthropic")
		expect(resolveProvider("openai")).toBe("openai")
	})

	it("returns undefined for invalid provider", () => {
		expect(resolveProvider("invalid")).toBeUndefined()
		expect(resolveProvider("")).toBeUndefined()
	})

	it("trims whitespace", () => {
		expect(resolveProvider("  anthropic  ")).toBe("anthropic")
	})
})

describe("THINKING_LEVELS", () => {
	it("contains all valid levels", () => {
		expect(THINKING_LEVELS).toContain("off")
		expect(THINKING_LEVELS).toContain("minimal")
		expect(THINKING_LEVELS).toContain("low")
		expect(THINKING_LEVELS).toContain("medium")
		expect(THINKING_LEVELS).toContain("high")
		expect(THINKING_LEVELS).toContain("xhigh")
	})
})

// Mock context factory for testing
function createMockContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const messages: unknown[] = []
	const toolBlocks: unknown[] = []

	return {
		agent: {
			reset: mock(() => {}),
			setThinkingLevel: mock(() => {}),
			setModel: mock(() => {}),
			state: { messages: [] },
			replaceMessages: mock(() => {}),
		} as any,
		sessionManager: {} as any,
		configDir: "/tmp",
		configPath: "/tmp/config.json",
		codexTransport: {} as any,
		getApiKey: () => "test-key",

		currentProvider: "anthropic",
		currentModelId: "claude-3-opus-20240229",
		currentThinking: "off",

		setCurrentProvider: mock(() => {}),
		setCurrentModelId: mock(() => {}),
		setCurrentThinking: mock(() => {}),

		isResponding: () => false,
		setIsResponding: mock(() => {}),
		setActivityState: mock(() => {}),
		setMessages: mock((updater) => {
			const result = updater(messages as any)
			messages.length = 0
			messages.push(...result)
		}),
		setToolBlocks: mock((updater) => {
			const result = updater(toolBlocks as any)
			toolBlocks.length = 0
			toolBlocks.push(...result)
		}),
		setContextTokens: mock(() => {}),
		setCacheStats: mock(() => {}),

		setDisplayModelId: mock(() => {}),
		setDisplayThinking: mock(() => {}),
		setDisplayContextWindow: mock(() => {}),
		setDiffWrapMode: mock(() => {}),

		...overrides,
	}
}

describe("handleSlashCommand", () => {
	it("returns false for non-slash commands", () => {
		const ctx = createMockContext()
		expect(handleSlashCommand("hello", ctx)).toBe(false)
		expect(handleSlashCommand("", ctx)).toBe(false)
	})

	it("returns false for unknown slash commands", () => {
		const ctx = createMockContext()
		expect(handleSlashCommand("/unknown", ctx)).toBe(false)
		expect(handleSlashCommand("/foo bar", ctx)).toBe(false)
	})

	describe("/clear", () => {
		it("clears messages and resets agent", () => {
			const ctx = createMockContext()
			const result = handleSlashCommand("/clear", ctx)
			expect(result).toBe(true)
			expect(ctx.agent.reset).toHaveBeenCalled()
			expect(ctx.setMessages).toHaveBeenCalled()
			expect(ctx.setToolBlocks).toHaveBeenCalled()
			expect(ctx.setContextTokens).toHaveBeenCalledWith(0)
		})
	})

	describe("/thinking", () => {
		it("changes thinking level for valid input", () => {
			const ctx = createMockContext()
			const result = handleSlashCommand("/thinking high", ctx)
			expect(result).toBe(true)
			expect(ctx.agent.setThinkingLevel).toHaveBeenCalledWith("high")
			expect(ctx.setCurrentThinking).toHaveBeenCalledWith("high")
			expect(ctx.setDisplayThinking).toHaveBeenCalledWith("high")
		})

		it("returns false for invalid thinking level", () => {
			const ctx = createMockContext()
			const result = handleSlashCommand("/thinking invalid", ctx)
			expect(result).toBe(false)
		})
	})

	describe("/diffwrap", () => {
		it("toggles diff wrap mode", () => {
			const ctx = createMockContext()
			const result = handleSlashCommand("/diffwrap", ctx)
			expect(result).toBe(true)
			expect(ctx.setDiffWrapMode).toHaveBeenCalled()
		})
	})

	describe("/model", () => {
		it("shows usage when no args", () => {
			const ctx = createMockContext()
			const result = handleSlashCommand("/model", ctx)
			expect(result).toBe(true)
			// Should add a message about usage
			expect(ctx.setMessages).toHaveBeenCalled()
		})

		it("blocks model change while responding", () => {
			const ctx = createMockContext({ isResponding: () => true })
			const result = handleSlashCommand("/model claude-3-5-sonnet-20241022", ctx)
			expect(result).toBe(true)
			// Should not change model
			expect(ctx.agent.setModel).not.toHaveBeenCalled()
		})
	})

	describe("/compact", () => {
		it("blocks compact while responding", async () => {
			const ctx = createMockContext({ isResponding: () => true })
			const result = await handleSlashCommand("/compact", ctx)
			expect(result).toBe(true)
			expect(ctx.setIsResponding).not.toHaveBeenCalled()
		})

		it("blocks compact with insufficient messages", async () => {
			const ctx = createMockContext()
			ctx.agent.state.messages = [{ role: "user", content: "hi" }]
			const result = await handleSlashCommand("/compact", ctx)
			expect(result).toBe(true)
			// Should add a message about needing more messages
			expect(ctx.setMessages).toHaveBeenCalled()
		})
	})

	describe("/theme", () => {
		it("lists themes when no args", () => {
			const ctx = createMockContext()
			const ok = handleSlashCommand("/theme", ctx)
			expect(ok).toBe(true)
			expect(ctx.setMessages).toHaveBeenCalled()
		})

		it("sets theme when valid", () => {
			const setTheme = mock(() => {})
			const ctx = createMockContext({ setTheme })
			const ok = handleSlashCommand("/theme aura", ctx)
			expect(ok).toBe(true)
			expect(setTheme).toHaveBeenCalledWith("aura")
		})

		it("rejects unknown theme", () => {
			const setTheme = mock(() => {})
			const ctx = createMockContext({ setTheme })
			const ok = handleSlashCommand("/theme not-a-theme", ctx)
			expect(ok).toBe(true)
			expect(setTheme).not.toHaveBeenCalled()
		})
	})
})

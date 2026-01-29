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
		cwd: "/tmp",
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
		submitPrompt: mock(async () => {}),
		steer: mock(async () => {}),
		followUp: mock(async () => {}),
		sendUserMessage: mock(async () => {}),

		...overrides,
	}
}

describe("handleSlashCommand", () => {
	it("returns false for non-slash commands", async () => {
		const ctx = createMockContext()
		expect(await handleSlashCommand("hello", ctx)).toBe(false)
		expect(await handleSlashCommand("", ctx)).toBe(false)
	})

	it("returns false for unknown slash commands", async () => {
		const ctx = createMockContext()
		expect(await handleSlashCommand("/unknown", ctx)).toBe(false)
		expect(await handleSlashCommand("/foo bar", ctx)).toBe(false)
	})

	describe("/clear", () => {
		it("clears messages and resets agent", async () => {
			const ctx = createMockContext()
			const result = await handleSlashCommand("/clear", ctx)
			expect(result).toBe(true)
			expect(ctx.agent.reset).toHaveBeenCalled()
			expect(ctx.setMessages).toHaveBeenCalled()
			expect(ctx.setToolBlocks).toHaveBeenCalled()
			expect(ctx.setContextTokens).toHaveBeenCalledWith(0)
		})
	})

	describe("/model", () => {
		it("shows usage when no args", async () => {
			const ctx = createMockContext()
			const result = await handleSlashCommand("/model", ctx)
			expect(result).toBe(true)
			// Should add a message about usage
			expect(ctx.setMessages).toHaveBeenCalled()
		})

		it("blocks model change while responding", async () => {
			const ctx = createMockContext({ isResponding: () => true })
			const result = await handleSlashCommand("/model claude-3-5-sonnet-20241022", ctx)
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
			ctx.agent.state.messages = [{ role: "user", content: "hi", timestamp: Date.now() }]
			const result = await handleSlashCommand("/compact", ctx)
			expect(result).toBe(true)
			// Should add a message about needing more messages
			expect(ctx.setMessages).toHaveBeenCalled()
		})
	})

	describe("/theme", () => {
		it("lists themes when no args", async () => {
			const ctx = createMockContext()
			const ok = await handleSlashCommand("/theme", ctx)
			expect(ok).toBe(true)
			expect(ctx.setMessages).toHaveBeenCalled()
		})

		it("sets theme when valid", async () => {
			const setTheme = mock(() => {})
			const ctx = createMockContext({ setTheme })
			const ok = await handleSlashCommand("/theme aura", ctx)
			expect(ok).toBe(true)
			expect(setTheme).toHaveBeenCalledWith("aura")
		})

		it("rejects unknown theme", async () => {
			const setTheme = mock(() => {})
			const ctx = createMockContext({ setTheme })
			const ok = await handleSlashCommand("/theme not-a-theme", ctx)
			expect(ok).toBe(true)
			expect(setTheme).not.toHaveBeenCalled()
		})
	})

	describe("/steer", () => {
		it("queues steering when responding", async () => {
			const steer = mock(async () => {})
			const ctx = createMockContext({ isResponding: () => true, steer })
			const ok = await handleSlashCommand("/steer focus now", ctx)
			expect(ok).toBe(true)
			expect(steer).toHaveBeenCalledWith("focus now")
			expect(ctx.submitPrompt).not.toHaveBeenCalled()
		})

		it("sends immediately when idle", async () => {
			const submitPrompt = mock(async () => {})
			const ctx = createMockContext({ submitPrompt })
			const ok = await handleSlashCommand("/steer tighten scope", ctx)
			expect(ok).toBe(true)
			expect(submitPrompt).toHaveBeenCalledWith("tighten scope", { mode: "steer" })
		})

		it("shows usage when missing args", async () => {
			const ctx = createMockContext()
			const ok = await handleSlashCommand("/steer", ctx)
			expect(ok).toBe(true)
			expect(ctx.setMessages).toHaveBeenCalled()
		})
	})

	describe("/followup", () => {
		it("queues follow-up while responding", async () => {
			const followUp = mock(async () => {})
			const ctx = createMockContext({ isResponding: () => true, followUp })
			const ok = await handleSlashCommand("/followup remind me later", ctx)
			expect(ok).toBe(true)
			expect(followUp).toHaveBeenCalledWith("remind me later")
		})

		it("sends immediately when idle", async () => {
			const submitPrompt = mock(async () => {})
			const ctx = createMockContext({ submitPrompt })
			const ok = await handleSlashCommand("/followup once more", ctx)
			expect(ok).toBe(true)
			expect(submitPrompt).toHaveBeenCalledWith("once more", { mode: "followUp" })
		})

		it("shows usage when missing text", async () => {
			const ctx = createMockContext()
			const ok = await handleSlashCommand("/followup  ", ctx)
			expect(ok).toBe(true)
			expect(ctx.setMessages).toHaveBeenCalled()
		})
	})

	describe("/editor", () => {
		it("uses openEditor when provided", async () => {
			const openEditor = mock(() => {})
			const ctx = createMockContext({ openEditor })
			const ok = await handleSlashCommand("/editor", ctx)
			expect(openEditor).toHaveBeenCalled()
		})

		it("defaults to nvim when not configured", async () => {
			const launchEditor = mock((..._args: unknown[]) => {})
			const ctx = createMockContext({ launchEditor })
			const ok = await handleSlashCommand("/editor", ctx)
			expect(ok).toBe(true)
			expect(launchEditor).toHaveBeenCalledWith("nvim", [ctx.cwd], ctx.cwd, expect.any(Function))
		})

		it("launches configured editor with cwd", async () => {
			const launchEditor = mock((..._args: unknown[]) => {})
			const ctx = createMockContext({
				editor: { command: "code", args: [] },
				launchEditor,
			})
			const ok = await handleSlashCommand("/editor", ctx)
			expect(ok).toBe(true)
			expect(launchEditor).toHaveBeenCalledWith("code", [ctx.cwd], ctx.cwd, expect.any(Function))
		})

		it("replaces {cwd} without appending", async () => {
			const launchEditor = mock((..._args: unknown[]) => {})
			const ctx = createMockContext({
				editor: { command: "zed", args: ["--cwd", "{cwd}"] },
				launchEditor,
			})
			const ok = await handleSlashCommand("/editor", ctx)
			expect(ok).toBe(true)
			expect(launchEditor).toHaveBeenCalled()
			expect(launchEditor).toHaveBeenCalledTimes(1)
			const calls = launchEditor.mock.calls as unknown[][]
			const args = calls[0]?.[1] as string[] | undefined
			expect(args).toEqual(["--cwd", ctx.cwd])
		})
	})
})

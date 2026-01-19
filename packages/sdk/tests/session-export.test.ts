import { describe, it, expect } from "bun:test"
import type { SessionState } from "../src/types.js"

describe("SessionState type", () => {
  it("has correct shape", () => {
    const state: SessionState = {
      version: 1,
      messages: [],
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      thinking: "off",
      exportedAt: Date.now(),
    }

    expect(state.version).toBe(1)
    expect(state.messages).toEqual([])
    expect(state.provider).toBe("anthropic")
    expect(state.model).toBe("claude-sonnet-4-20250514")
    expect(state.thinking).toBe("off")
    expect(typeof state.exportedAt).toBe("number")
  })

  it("supports optional systemPrompt", () => {
    const stateWithPrompt: SessionState = {
      version: 1,
      messages: [],
      provider: "openai",
      model: "gpt-4",
      thinking: "low",
      systemPrompt: "You are a helpful assistant",
      exportedAt: Date.now(),
    }

    expect(stateWithPrompt.systemPrompt).toBe("You are a helpful assistant")
  })

  it("is JSON serializable", () => {
    const state: SessionState = {
      version: 1,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
          timestamp: Date.now(),
        },
      ],
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      thinking: "off",
      exportedAt: Date.now(),
    }

    const json = JSON.stringify(state)
    const parsed = JSON.parse(json) as SessionState

    expect(parsed.version).toBe(1)
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].role).toBe("user")
  })
})

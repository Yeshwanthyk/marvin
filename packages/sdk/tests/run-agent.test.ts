import { describe, expect, it } from "bun:test"
import { runAgent } from "../src/index.js"
import { createMockTransportFactory, createTempConfig } from "./helpers.js"

describe("runAgent", () => {
  it("returns deterministic response with mock transport", async () => {
    const temp = await createTempConfig()
    try {
      const result = await runAgent({
        prompt: "Hello",
        configDir: temp.dir,
        configPath: temp.configPath,
        transportFactory: createMockTransportFactory(["mock response"]),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.text).toBe("mock response")
      expect(result.value.messages.length).toBe(1)
      expect(result.value.provider).toBe("anthropic")
    } finally {
      await temp.cleanup()
    }
  })
})

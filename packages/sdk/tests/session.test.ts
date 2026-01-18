import { describe, expect, it } from "bun:test"
import { createAgentSession } from "../src/index.js"
import { createMockTransportFactory, createTempConfig } from "./helpers.js"

describe("createAgentSession", () => {
  it("supports multi-turn chat", async () => {
    const temp = await createTempConfig()
    try {
      const session = await createAgentSession({
        configDir: temp.dir,
        configPath: temp.configPath,
        transportFactory: createMockTransportFactory(["first", "second"]),
      })

      const first = await session.chat("Hi")
      const second = await session.chat("Again")

      expect(first.text).toBe("first")
      expect(second.text).toBe("second")

      await session.close()
    } finally {
      await temp.cleanup()
    }
  })
})

import { describe, expect, it } from "bun:test"
import { runAgentStream } from "../src/index.js"
import { createMockTransportFactory, createTempConfig } from "./helpers.js"

describe("runAgentStream", () => {
  it("yields agent events in order", async () => {
    const temp = await createTempConfig()
    try {
      const eventTypes: string[] = []
      for await (const event of runAgentStream({
        prompt: "Stream",
        configDir: temp.dir,
        configPath: temp.configPath,
        transportFactory: createMockTransportFactory(["streamed"]),
      })) {
        if (event.type === "agent") {
          eventTypes.push(event.event.type)
        }
      }

      expect(eventTypes).toEqual([
        "agent_start",
        "turn_start",
        "message_start",
        "message_end",
        "turn_end",
        "agent_end",
      ])
    } finally {
      await temp.cleanup()
    }
  })
})

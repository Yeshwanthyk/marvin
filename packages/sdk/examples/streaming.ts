/**
 * Streaming SDK usage example
 * Run: bun run examples/streaming.ts
 */
import { runAgentStream } from "../src/index.js"

async function main() {
  console.log("Streaming response...\n")

  for await (const event of runAgentStream({ prompt: "Count from 1 to 10, one number per line." })) {
    if (event.type === "agent") {
      const agentEvent = event.event
      if (agentEvent.type === "message_update") {
        // Stream text deltas from assistant messages
        const update = agentEvent.assistantMessageEvent
        if (update.type === "text_delta") {
          process.stdout.write(update.delta)
        }
      } else if (agentEvent.type === "tool_execution_start") {
        console.log("\n[Tool call:", agentEvent.toolName, "]")
      } else if (agentEvent.type === "tool_execution_end") {
        console.log("[Tool result received]")
      }
    }
  }

  console.log("\n\nDone!")
}

main().catch(console.error)

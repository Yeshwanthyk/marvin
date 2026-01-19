/**
 * Multi-turn session example with export/import
 * Run: bun run examples/session.ts
 */
import { createAgentSession } from "../src/index.js"

async function main() {
  console.log("Creating session...\n")

  // Create session and have a conversation
  const session = await createAgentSession({})

  console.log("First message...")
  const result1 = await session.chat("My name is Alice and my favorite number is 42.")
  console.log("Response 1:", result1.text.slice(0, 100), "...\n")

  console.log("Second message (testing memory)...")
  const result2 = await session.chat("What is my name and favorite number?")
  console.log("Response 2:", result2.text, "\n")

  // Export session
  console.log("Exporting session...")
  const state = await session.export()
  console.log("Exported", state.messages.length, "messages")
  console.log("State is JSON-serializable:", typeof JSON.stringify(state) === "string")

  await session.close()
  console.log("Session closed.\n")

  // Restore session in new instance
  console.log("Restoring session...")
  const session2 = await createAgentSession({ restore: state })

  console.log("Third message (after restore)...")
  const result3 = await session2.chat("Do you still remember my name?")
  console.log("Response 3:", result3.text, "\n")

  await session2.close()
  console.log("Done!")
}

main().catch(console.error)

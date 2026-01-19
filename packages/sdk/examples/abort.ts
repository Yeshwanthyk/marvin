/**
 * Abort/cancellation example
 * Run: bun run examples/abort.ts
 */
import { runAgent, createAgentSession } from "../src/index.js"

async function main() {
  // Example 1: Using AbortSignal.timeout
  console.log("Example 1: AbortSignal.timeout(500)...")
  const result1 = await runAgent({
    prompt: "Write a very long essay about the history of computing in great detail.",
    signal: AbortSignal.timeout(500), // 500ms timeout
  })

  if (!result1.ok) {
    console.log("Request aborted as expected!")
    console.log("Error code:", result1.error.code)
    console.log("Retryable:", result1.error.retryable)
  } else {
    console.log("Request completed (was fast enough)")
  }

  console.log()

  // Example 2: Using AbortController
  console.log("Example 2: Manual AbortController...")
  const controller = new AbortController()

  const promise = runAgent({
    prompt: "Count from 1 to 1000, one number per line.",
    signal: controller.signal,
  })

  // Abort after 200ms
  setTimeout(() => {
    console.log("Calling abort()...")
    controller.abort()
  }, 200)

  const result2 = await promise
  if (!result2.ok && result2.error.code === "ABORTED") {
    console.log("Successfully aborted with AbortController!")
  }

  console.log()

  // Example 3: Session abort
  console.log("Example 3: session.abort()...")
  const session = await createAgentSession({})

  const chatPromise = session.chat("Write a haiku about each planet in the solar system.")

  // Abort after 300ms
  setTimeout(() => {
    console.log("Calling session.abort()...")
    session.abort()
  }, 300)

  try {
    await chatPromise
    console.log("Chat completed")
  } catch {
    console.log("Chat was aborted")
  }

  await session.close()
  console.log("\nDone!")
}

main().catch(console.error)

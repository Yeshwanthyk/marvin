/**
 * Basic SDK usage example
 * Run: bun run examples/basic.ts
 */
import { runAgent } from "../src/index.js"

async function main() {
  console.log("Running basic prompt...\n")

  const result = await runAgent({
    prompt: "What is 2 + 2? Reply with just the number.",
  })

  if (result.ok) {
    console.log("Response:", result.value.text)
    console.log("Stop reason:", result.value.stopReason)
    console.log("Duration:", result.value.durationMs, "ms")

    if (result.value.usage) {
      console.log("Tokens:", result.value.usage.input, "in /", result.value.usage.output, "out")
      console.log("Cost: $", result.value.usage.cost.total.toFixed(4))
    }
  } else {
    console.error("Error:", result.error._tag, result.error.code)
    console.error("Message:", result.error.message)
    console.error("Retryable:", result.error.retryable)
  }
}

main().catch(console.error)

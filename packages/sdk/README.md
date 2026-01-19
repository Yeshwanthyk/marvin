# @yeshwanthyk/sdk

Headless SDK for the Marvin coding agent. Run AI-powered coding tasks programmatically.

## Install

```bash
npm install @yeshwanthyk/sdk
# or
bun add @yeshwanthyk/sdk
```

## Quick Start

```typescript
import { runAgent } from "@yeshwanthyk/sdk"

const result = await runAgent({
  prompt: "Explain this code",
})

if (result.ok) {
  console.log(result.value.text)
} else {
  console.error(result.error.message)
}
```

## API

### runAgent(options): Promise<Result<SdkResult, SdkError>>

One-shot prompt execution. Returns a Result type (ok/error).

```typescript
const result = await runAgent({
  // Required
  prompt: "Your prompt",

  // Optional - Provider/Model
  provider: "anthropic",           // default: from config
  model: "claude-sonnet-4-20250514", // default: from config
  thinking: "high",                // off | minimal | low | medium | high | xhigh
  systemPrompt: "Custom system prompt",

  // Optional - Model parameters
  maxTokens: 4096,
  temperature: 0.7,

  // Optional - Execution control
  signal: AbortSignal.timeout(30000),
  timeout: 30000,                  // ms
  retry: {
    maxAttempts: 3,                // primary model attempts
    fallbackAttempts: 2,           // fallback model attempts
    initialDelayMs: 100,           // backoff start
  },

  // Optional - Tool control
  tools: ["read", "write"],        // allowlist (only these tools)
  disableTools: ["bash"],          // blocklist (disable these tools)

  // Optional - Attachments
  attachments: [
    { type: "image", content: base64String, mimeType: "image/png" }
  ],
})
```

### createAgentSession(options): Promise<SdkSession>

Multi-turn conversation session with memory.

```typescript
const session = await createAgentSession({
  // Same options as runAgent (except prompt)
  // Plus:
  restore: previousState,  // Restore from exported state
})

// Chat (maintains conversation history)
const result = await session.chat("Hello")
const result2 = await session.chat("What did I just say?")

// Get current state
const snapshot = await session.snapshot()

// Abort current request
session.abort()

// Export for persistence
const state = await session.export()
// state is JSON-serializable

// Clean up
await session.close()
```

### runAgentStream(options): AsyncIterable<SdkEvent>

Streaming events for real-time UI updates.

```typescript
for await (const event of runAgentStream({ prompt: "..." })) {
  if (event.type === "agent") {
    if (event.event.type === "message_update") {
      const update = event.event.assistantMessageEvent
      if (update.type === "text_delta") {
        process.stdout.write(update.delta)
      }
    } else if (event.event.type === "tool_execution_start") {
      console.log("Tool:", event.event.toolName)
    }
  }
}
```

### Effect API (for Effect users)

All functions have `*Effect` variants returning Effect types:

```typescript
import { runAgentEffect, runAgentStreamEffect } from "@yeshwanthyk/sdk"
import { Effect, Stream } from "effect"

// Full error type visibility in signature
const effect: Effect.Effect<SdkResult, SdkError> = runAgentEffect({ prompt: "..." })

// Stream with backpressure and composition
const stream: Stream.Stream<SdkEvent, SdkError> = runAgentStreamEffect({ prompt: "..." })

// Compose streams
const limited = stream.pipe(Stream.take(10))
const withTimeout = stream.pipe(Stream.timeout(Duration.seconds(30)))
```

## Error Handling

Errors are discriminated unions with `_tag`, `code`, and `retryable`:

```typescript
if (!result.ok) {
  const error = result.error

  // Pattern match on error type
  switch (error._tag) {
    case "ConfigError":
      // code: "CONFIG_MISSING" | "CONFIG_INVALID"
      // retryable: false
      break

    case "ProviderError":
      // code: "AUTH" | "RATE_LIMITED" | "OVERLOADED" | "MODEL_NOT_FOUND"
      // retryable: true for RATE_LIMITED, OVERLOADED
      if (error.retryable) {
        // Implement retry logic
      }
      break

    case "RequestError":
      // code: "TIMEOUT" | "ABORTED" | "CONTEXT_LENGTH" | "NETWORK"
      // retryable: true for TIMEOUT, NETWORK
      break

    case "HookError":
      // code: "HOOK_FAILED"
      // retryable: false
      break
  }
}
```

## Result Shape

```typescript
interface SdkResult {
  text: string               // Final assistant response
  messages: AppMessage[]     // Full conversation history
  toolCalls: ToolCall[]      // Tools that were called
  usage?: Usage              // Token counts and cost
  provider: string           // Provider used
  model: string              // Model used
  sessionId: string | null   // Session ID if persisted
  stopReason: StopReason     // "complete" | "maxTokens" | "aborted" | "error"
  durationMs: number         // Request duration in milliseconds
}
```

## Configuration

The SDK reads configuration from `~/.config/marvin/config.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "thinking": "high"
}
```

Override via options or environment variables (`ANTHROPIC_API_KEY`, etc).

## Examples

See [examples/](./examples) for runnable examples:

- `examples/basic.ts` - Simple one-shot usage
- `examples/streaming.ts` - Real-time streaming
- `examples/session.ts` - Multi-turn with export/import
- `examples/abort.ts` - Cancellation patterns

Run with:
```bash
cd packages/sdk
bun run examples/basic.ts
```

## License

MIT

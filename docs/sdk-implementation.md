# SDK Implementation Guide

Developer documentation for the `@yeshwanthyk/sdk` package — a headless SDK for the Marvin coding agent.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Package Structure](#package-structure)
- [Core APIs](#core-apis)
- [Options Reference](#options-reference)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [Examples](#examples)
- [Internal Implementation](#internal-implementation)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         @yeshwanthyk/sdk                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  runAgent   │  │  session    │  │  runAgentStream         │  │
│  │  (one-shot) │  │  (multi-turn)│  │  (streaming)            │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                      │                │
│         └────────────────┼──────────────────────┘                │
│                          ▼                                       │
│                ┌─────────────────────┐                           │
│                │   createSdkRuntime  │                           │
│                │   (runtime.ts)      │                           │
│                └──────────┬──────────┘                           │
└───────────────────────────┼──────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   @yeshwanthyk/runtime-effect                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ RuntimeLayer│  │ Orchestrator│  │ ExecutionPlanBuilder    │  │
│  │ (Effect)    │  │ (sessions)  │  │ (retry/fallback)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     @yeshwanthyk/agent-core                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │    Agent    │  │  Transport  │  │  Tools                  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Key design principles:**

1. **Dual API**: Every function has both Promise and Effect variants (`runAgent` / `runAgentEffect`)
2. **Result types**: Promise APIs return `Result<T, SdkError>` for explicit error handling
3. **Granular errors**: Discriminated union errors with `_tag`, `code`, and `retryable` fields
4. **Streaming**: Both `AsyncIterable` and Effect `Stream` variants available

---

## Package Structure

```
packages/sdk/
├── src/
│   ├── index.ts          # Public exports
│   ├── types.ts          # Type definitions (SdkResult, SdkError, options)
│   ├── errors.ts         # Error types and classification logic
│   ├── result.ts         # Result<T, E> type helpers (ok/err)
│   ├── run-agent.ts      # runAgent / runAgentEffect
│   ├── session.ts        # createAgentSession / createAgentSessionEffect
│   ├── stream.ts         # runAgentStream / runAgentStreamEffect
│   ├── runtime.ts        # createSdkRuntime (internal Effect runtime)
│   ├── sdk-result.ts     # buildSdkResult helper
│   └── internal.ts       # Internal utilities
├── tests/
│   ├── helpers.ts        # Mock transport factory for testing
│   ├── run-agent.test.ts
│   ├── session.test.ts
│   ├── stream.test.ts
│   ├── errors.test.ts
│   └── session-export.test.ts
├── examples/
│   ├── basic.ts          # Simple one-shot usage
│   ├── streaming.ts      # Real-time streaming
│   ├── session.ts        # Multi-turn with export/import
│   └── abort.ts          # Cancellation patterns
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── README.md
```

---

## Core APIs

### 1. `runAgent(options)` — One-shot Execution

**Use case**: Single prompt → response, no conversation history needed.

```typescript
import { runAgent } from "@yeshwanthyk/sdk"

const result = await runAgent({
  prompt: "Explain this code",
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
})

if (result.ok) {
  console.log(result.value.text)
  console.log(result.value.stopReason)  // "complete" | "maxTokens" | "aborted" | "error"
  console.log(result.value.durationMs)
} else {
  console.error(result.error._tag, result.error.code)
}
```

**Effect variant:**
```typescript
import { runAgentEffect } from "@yeshwanthyk/sdk"
import { Effect } from "effect"

const effect: Effect.Effect<SdkResult, SdkError> = runAgentEffect({ prompt: "..." })
const result = await Effect.runPromise(effect)
```

### 2. `createAgentSession(options)` — Multi-turn Sessions

**Use case**: Conversation with memory, session persistence.

```typescript
import { createAgentSession } from "@yeshwanthyk/sdk"

const session = await createAgentSession({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
})

// Multi-turn conversation
const r1 = await session.chat("My name is Alice")
const r2 = await session.chat("What's my name?")  // Remembers context

// Export for persistence
const state = await session.export()
localStorage.setItem("session", JSON.stringify(state))

// Restore later
const restored = await createAgentSession({
  restore: JSON.parse(localStorage.getItem("session")!),
})

// Abort in-flight request
session.abort()

// Clean up
await session.close()
```

**Session methods:**
| Method | Returns | Description |
|--------|---------|-------------|
| `chat(text, options?)` | `Promise<SdkResult>` | Send message, get response |
| `snapshot()` | `Promise<SdkSessionSnapshot>` | Get current state |
| `abort()` | `void` | Cancel current request |
| `export()` | `Promise<SessionState>` | Export for persistence |
| `close()` | `Promise<void>` | Clean up resources |

### 3. `runAgentStream(options)` — Streaming

**Use case**: Real-time UI updates, progress indicators.

```typescript
import { runAgentStream } from "@yeshwanthyk/sdk"

for await (const event of runAgentStream({ prompt: "Count to 10" })) {
  if (event.type === "agent") {
    const e = event.event
    
    if (e.type === "message_update") {
      // Streaming text
      if (e.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(e.assistantMessageEvent.delta)
      }
    } else if (e.type === "tool_execution_start") {
      console.log(`[Tool: ${e.toolName}]`)
    } else if (e.type === "tool_execution_end") {
      console.log(`[Result: ${e.isError ? "error" : "success"}]`)
    }
  }
}
```

**Effect Stream variant (backpressure, composition):**
```typescript
import { runAgentStreamEffect } from "@yeshwanthyk/sdk"
import { Stream, Effect, Duration } from "effect"

const stream = runAgentStreamEffect({ prompt: "..." })

// Take first 10 events
const limited = stream.pipe(Stream.take(10))

// Add timeout
const withTimeout = stream.pipe(Stream.timeout(Duration.seconds(30)))

// Collect all
const events = await Effect.runPromise(Stream.runCollect(stream))
```

**Event types (`SdkEvent`):**
```typescript
type SdkEvent =
  | { type: "agent"; event: AgentEvent }       // Agent lifecycle events
  | { type: "hookMessage"; message: HookMessage } // Custom hook messages
  | { type: "instrumentation"; event: InstrumentationEvent } // Telemetry
```

**AgentEvent types:**
- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`

---

## Options Reference

### Base Options (all APIs)

```typescript
interface SdkBaseOptions {
  // Provider/Model selection
  provider?: string           // "anthropic" | "openai" | "google" | ...
  model?: string              // Model ID
  thinking?: ThinkingLevel    // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
  systemPrompt?: string       // Override system prompt

  // Model parameters
  maxTokens?: number          // Max output tokens
  temperature?: number        // 0.0 - 1.0

  // Execution control
  retry?: RetryConfig         // Retry configuration
  timeout?: number            // Request timeout in ms

  // Tool control
  tools?: readonly string[]       // Allowlist (only these tools)
  disableTools?: readonly string[] // Blocklist (disable these)

  // Configuration paths
  cwd?: string                // Working directory
  configDir?: string          // Config directory (~/.config/marvin)
  configPath?: string         // Explicit config file path

  // Advanced
  instrumentation?: (event: InstrumentationEvent) => void
  transportFactory?: TransportFactory  // Custom transport (for testing)
}
```

### Retry Configuration

```typescript
interface RetryConfig {
  maxAttempts?: number      // Primary model attempts (default: 3)
  fallbackAttempts?: number // Fallback model attempts (default: 2)
  initialDelayMs?: number   // Exponential backoff start (default: 100)
}
```

**How retry works:**
1. Primary model is tried up to `maxAttempts` times
2. On failure, switches to fallback models (if configured via model cycle)
3. Each fallback tried up to `fallbackAttempts` times
4. Uses exponential backoff: 100ms → 200ms → 400ms → ...
5. Only retries on `retryable` errors (network, timeout, rate limit)

### Tool Filtering

```typescript
// Only allow read tool
await runAgent({ prompt: "...", tools: ["read"] })

// Disable bash execution
await runAgent({ prompt: "...", disableTools: ["bash"] })

// Both: allowlist first, then blocklist removes
// Result: only "read" (blocklist removes "write" from allowlist)
await runAgent({ 
  prompt: "...", 
  tools: ["read", "write"], 
  disableTools: ["write"] 
})
```

### Abort/Cancellation

```typescript
// Via AbortSignal (runAgent, runAgentStream)
await runAgent({
  prompt: "...",
  signal: AbortSignal.timeout(5000),  // 5s timeout
})

// Via AbortController
const controller = new AbortController()
setTimeout(() => controller.abort(), 1000)
await runAgent({ prompt: "...", signal: controller.signal })

// Via session.abort()
const session = await createAgentSession({})
session.abort()  // Synchronous, cancels in-flight request
```

---

## Error Handling

### Error Types

```typescript
type SdkError =
  | { _tag: "ConfigError"; code: ConfigErrorCode; message: string; retryable: false }
  | { _tag: "ProviderError"; code: ProviderErrorCode; message: string; retryable: boolean }
  | { _tag: "RequestError"; code: RequestErrorCode; message: string; retryable: boolean }
  | { _tag: "HookError"; code: HookErrorCode; message: string; retryable: false }

type ConfigErrorCode = "CONFIG_MISSING" | "CONFIG_INVALID"
type ProviderErrorCode = "AUTH" | "RATE_LIMITED" | "OVERLOADED" | "MODEL_NOT_FOUND"
type RequestErrorCode = "TIMEOUT" | "ABORTED" | "CONTEXT_LENGTH" | "NETWORK"
type HookErrorCode = "HOOK_FAILED"
```

### Retryable Errors

| Error | Code | Retryable |
|-------|------|-----------|
| ConfigError | CONFIG_MISSING | ❌ |
| ConfigError | CONFIG_INVALID | ❌ |
| ProviderError | AUTH | ❌ |
| ProviderError | RATE_LIMITED | ✅ |
| ProviderError | OVERLOADED | ✅ |
| ProviderError | MODEL_NOT_FOUND | ❌ |
| RequestError | TIMEOUT | ✅ |
| RequestError | NETWORK | ✅ |
| RequestError | ABORTED | ❌ |
| RequestError | CONTEXT_LENGTH | ❌ |
| HookError | HOOK_FAILED | ❌ |

### Pattern Matching

```typescript
if (!result.ok) {
  const error = result.error
  
  switch (error._tag) {
    case "ConfigError":
      // Missing or invalid config
      break
    case "ProviderError":
      if (error.code === "RATE_LIMITED" && error.retryable) {
        // Wait and retry
      }
      break
    case "RequestError":
      if (error.code === "ABORTED") {
        // User cancelled
      }
      break
    case "HookError":
      // Custom hook failed
      break
  }
}
```

### Error Classification

Errors are automatically classified from raw exceptions using pattern matching:

```typescript
// These patterns trigger specific error codes:
"rate limit", "429" → ProviderError.RATE_LIMITED
"unauthorized", "401" → ProviderError.AUTH
"overloaded", "503" → ProviderError.OVERLOADED
"timeout", "timed out" → RequestError.TIMEOUT
"ECONNREFUSED", "network error" → RequestError.NETWORK
"context length", "too many tokens" → RequestError.CONTEXT_LENGTH
```

---

## Testing

### Mock Transport Factory

The SDK provides a test helper for mocking responses:

```typescript
import { createMockTransportFactory, createTempConfig } from "@yeshwanthyk/sdk/tests/helpers"

// Create temp config (required for SDK initialization)
const config = await createTempConfig()

// Create mock that returns specific responses
const transportFactory = createMockTransportFactory([
  "First response",
  "Second response",
  "Third response (used for all subsequent calls)",
])

// Use in tests
const result = await runAgent({
  prompt: "test",
  configPath: config.configPath,
  transportFactory,
})

// Clean up
await config.cleanup()
```

### Test Examples

**Testing one-shot:**
```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { runAgent } from "@yeshwanthyk/sdk"
import { createMockTransportFactory, createTempConfig, type TempConfig } from "./helpers"

describe("runAgent", () => {
  let config: TempConfig

  beforeAll(async () => {
    config = await createTempConfig()
  })

  afterAll(async () => {
    await config.cleanup()
  })

  it("returns response from mock transport", async () => {
    const result = await runAgent({
      prompt: "Hello",
      configPath: config.configPath,
      transportFactory: createMockTransportFactory(["Hello back!"]),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.text).toBe("Hello back!")
      expect(result.value.stopReason).toBe("complete")
    }
  })
})
```

**Testing sessions:**
```typescript
it("maintains conversation context", async () => {
  const session = await createAgentSession({
    configPath: config.configPath,
    transportFactory: createMockTransportFactory([
      "Nice to meet you!",
      "Your name is Alice.",
    ]),
  })

  await session.chat("My name is Alice")
  const result = await session.chat("What's my name?")

  expect(result.text).toBe("Your name is Alice.")
  await session.close()
})
```

**Testing errors:**
```typescript
import { toSdkError, ProviderError } from "@yeshwanthyk/sdk"

it("classifies rate limit errors", () => {
  const error = toSdkError(new Error("rate limit exceeded"))
  
  expect(error._tag).toBe("ProviderError")
  expect(error.code).toBe("RATE_LIMITED")
  expect(error.retryable).toBe(true)
})
```

### Running Tests

```bash
# All SDK tests
bun test packages/sdk/tests

# Specific test file
bun test packages/sdk/tests/run-agent.test.ts

# Watch mode
bun test packages/sdk/tests --watch
```

---

## Examples

Located in `packages/sdk/examples/`:

### basic.ts — Simple One-shot

```bash
cd packages/sdk && bun run examples/basic.ts
```

Demonstrates:
- Basic `runAgent` call
- Result type handling (`ok`/`error`)
- Accessing `stopReason`, `durationMs`, `usage`

### streaming.ts — Real-time Output

```bash
cd packages/sdk && bun run examples/streaming.ts
```

Demonstrates:
- `runAgentStream` usage
- Handling `message_update` events for streaming text
- Detecting tool execution start/end

### session.ts — Multi-turn Conversations

```bash
cd packages/sdk && bun run examples/session.ts
```

Demonstrates:
- `createAgentSession` usage
- Multi-turn conversation with memory
- `session.export()` for persistence
- Restoring from exported state

### abort.ts — Cancellation Patterns

```bash
cd packages/sdk && bun run examples/abort.ts
```

Demonstrates:
- `AbortSignal.timeout()` for timeouts
- `AbortController` for manual cancellation
- `session.abort()` for session-level cancellation

---

## Internal Implementation

### Runtime Creation (`runtime.ts`)

`createSdkRuntime` is the core internal function that:

1. Loads configuration from disk or options
2. Creates the Effect runtime layer (`RuntimeLayer`)
3. Wires up abort signals
4. Applies model parameters
5. Filters tools
6. Restores session state
7. Returns runtime with `submitPrompt` and `submitPromptAndWait` methods

```typescript
// Simplified flow
const createSdkRuntime = Effect.fn(function* (options) {
  // Build runtime layer with all services
  const layer = RuntimeLayer(runtimeOptions)
  const context = yield* Layer.buildWithScope(layer, scope)
  const services = Context.get(context, RuntimeServicesTag)
  
  // Wire abort signal
  if (options.signal) {
    options.signal.addEventListener("abort", () => services.agent.abort())
  }
  
  // Apply options
  if (options.maxTokens) services.agent.setModelParameters({ maxTokens })
  if (options.tools) services.agent.setTools(filteredTools)
  if (options.restore) services.agent.replaceMessages(state.messages)
  
  return { services, submitPromptAndWait, close }
})
```

### Result Building (`sdk-result.ts`)

Extracts SDK result from runtime services:

```typescript
const buildSdkResult = (services: RuntimeServices, startTime: number): SdkResult => ({
  text: lastAssistantMessage?.content ?? "",
  messages: services.agent.state.messages,
  toolCalls: extractToolCalls(messages),
  usage: lastAssistantMessage?.usage,
  provider: services.config.provider,
  model: services.config.modelId,
  sessionId: services.sessionManager.sessionId,
  stopReason: deriveStopReason(lastAssistantMessage),
  durationMs: Date.now() - startTime,
})
```

### Error Classification (`errors.ts`)

Pattern-based error classification:

```typescript
const toSdkError = (value: unknown, fallbackTag = "RequestError"): SdkError => {
  const message = toErrorMessage(value)
  
  if (isAbortError(value)) return RequestError("ABORTED", message)
  if (matchesPattern(message, RATE_LIMIT_PATTERNS)) return ProviderError("RATE_LIMITED", message)
  if (matchesPattern(message, AUTH_PATTERNS)) return ProviderError("AUTH", message)
  // ... more patterns
  
  return RequestError("NETWORK", message)  // fallback
}
```

---

## Configuration

The SDK reads from `~/.config/marvin/config.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "thinking": "high",
  "lsp": {
    "enabled": true,
    "autoInstall": true
  }
}
```

**Environment variables:**
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- etc.

**Override priority:** options > env vars > config file

---

## Related Packages

| Package | Description |
|---------|-------------|
| `@yeshwanthyk/agent-core` | Agent class, transports, event types |
| `@yeshwanthyk/ai` | LLM provider abstraction, model definitions |
| `@yeshwanthyk/runtime-effect` | Effect-based runtime, orchestrator, hooks |
| `@yeshwanthyk/base-tools` | Built-in tools (read, write, edit, bash) |

---

## Changelog (Recent)

| Commit | Description |
|--------|-------------|
| `8e5b130` | [Phases 1-4] SDK Extended Features — retry/timeout, Effect Stream, tool filtering, examples |
| `7a54e3b` | [Phase 4] Session Export/Import |
| `16b9fd4` | [Phases 1-3] Abort, Error Types, Model Params |
| `50ca9e5` | [Phase 3] Initial SDK package |

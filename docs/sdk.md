# SDK Guide

This SDK exposes the Effect runtime as a small, stable surface for headless use. It uses the same runtime as the CLI/TUI (hooks, tools, session persistence, prompt queue, execution plan).

## Quick Start

```typescript
import { runAgent } from "@yeshwanthyk/sdk";

const result = await runAgent({
  prompt: "Summarize the project structure",
  cwd: process.cwd(),
});

if (result.ok) {
  console.log(result.value.text);
} else {
  console.error(result.error);
}
```

## Sessions

```typescript
import { createAgentSession } from "@yeshwanthyk/sdk";

const session = await createAgentSession({
  cwd: process.cwd(),
});

const first = await session.chat("Plan the refactor");
const second = await session.chat("Now draft the PR description");

console.log(first.text, second.text);
await session.close();
```

## Streaming

```typescript
import { runAgentStream } from "@yeshwanthyk/sdk";

for await (const event of runAgentStream({
  prompt: "Walk through the error log",
  cwd: process.cwd(),
})) {
  if (event.type === "agent") {
    console.log(event.event.type);
  }
}
```

## Options

All SDK calls accept the same base options:

- `cwd`: working directory for AGENTS resolution and tool path binding.
- `configDir` / `configPath`: override config location (default: `~/.config/marvin`).
- `provider` / `model` / `thinking`: override model selection.
- `systemPrompt`: override base system prompt (AGENTS.md is appended).
- `lsp`: `{ enabled, autoInstall }` (SDK defaults to disabled).
- `instrumentation`: callback for runtime instrumentation events.
- `transportFactory`: inject a transport bundle (useful for tests).

## Hooks and Custom Tools

The SDK loads the same hooks, commands, and custom tools as the CLI/TUI from the configured `configDir`. Hook messages and instrumentation events can be observed via `runAgentStream` or the SDK runtime sinks.

## Notes

- The SDK does not bypass runtime-effect; it builds `RuntimeLayer` internally.
- LSP is disabled by default to avoid background processes in headless environments.
- Use `transportFactory` in tests to avoid network calls.

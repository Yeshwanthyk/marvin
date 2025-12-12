# Extension hooks (headless, desktop, alternate UIs)

This repo’s runtime is intentionally **UI-agnostic**: the `Agent` produces a stream of `AgentEvent`s, and *any* UI (TUI, headless CLI, web, Electron/native desktop) can subscribe and render those events however it wants.

This doc describes the main extension points and shows a small “JSON events” adapter you can use to consume agent output without a TUI.

## Key primitives (where to hook in)

- `@mu-agents/runtime`
  - `Agent` — the core state machine (conversation, queue, tool rounds) that emits `AgentEvent`s.
  - `AgentLoop` — a tiny driver that repeatedly calls `agent.runNextTurn()` and forwards events.
  - `AgentSession` — convenience wrapper: `Agent` + `AgentLoop` + default `ProviderTransport`.
  - `ProviderTransport` — implements `AgentTransport`; resolves the configured provider/model via the providers registry and streams provider events back to the runtime.

The current TUI (`apps/coding-agent/src/tui-app.ts`) is “just a subscriber”:
- it rebuilds an `Agent`
- subscribes to `agent.events`
- renders conversation + `provider` text deltas

The headless CLI path (`apps/coding-agent/src/headless.ts`) uses `AgentSession` and waits for a `turn-end` event, then prints a single JSON result.

## Event surface (what you receive)

`AgentEvent` is a discriminated union (see `packages/runtime/src/agent/types.ts`) with events like:

- `state` — `idle | running | stopping | error | closed`
- `message` — conversation messages (`user`, `assistant`, `tool`)
- `provider` — streaming provider events (e.g. `text-delta`, `text-complete`, `usage`, `error`)
- `tool-result` — tool outputs
- `turn-start` / `turn-end` — boundaries around one agent “turn”
- `loop-start` / `loop-stop` — emitted by `AgentLoop`
- `error` — runtime-level errors

You can consume events in two equivalent ways:

1) Subscribe callback-style:
```ts
const unsub = session.subscribe((event) => {
  // render / persist / forward
});
```

2) Or as an async iterator (handy for streaming pipelines):
```ts
for await (const event of session) {
  // render / persist / forward
}
```

## Extension points (what you can swap)

These are the intended “hooks” for alternate front-ends:

- **UI**: subscribe to `AgentEvent`s and decide how to render them.
- **Transport**: provide a different `AgentTransport` (or customize `ProviderTransport`) if you want different provider routing, custom base URLs, tracing, caching, etc.
- **Tools**: pass your own `ToolRegistry` (e.g. a restricted tool set for a desktop app, or a remote tool host).
- **Queue strategy**: choose how messages are queued/merged/interrupted (`queueStrategy`).
- **Thinking level**: adjust `thinking` (`off | low | medium | high`) to match UX needs.
- **Conversation persistence**: seed `initialConversation` and/or store `session.getConversation()` on `turn-end`.
- **Attachments**: send structured attachments via `AgentSession.send(text, attachments)`.

## Adapter example: stream `AgentEvent`s as NDJSON (no TUI)

If you want to integrate Mu into another program (or build your own UI), the simplest contract is newline-delimited JSON (“NDJSON”): one JSON object per line.

The snippet below shows a minimal event forwarder. It writes **every** agent event to stdout as it happens, plus a final `done` record on `turn-end`.

```ts
import { AgentSession } from '@mu-agents/runtime';
import { createDefaultToolRegistry } from '@mu-agents/tools';
import { createApiKeyManager, createEnvApiKeyStore, createMemoryApiKeyStore } from '@mu-agents/providers';

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

const safeError = (e: unknown): { name?: string; message: string; stack?: string } | undefined => {
  if (!e) return undefined;
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
  return { message: String(e) };
};

const write = (record: JsonValue) => process.stdout.write(JSON.stringify(record) + '\n');

export async function runJsonEventsHeadless(prompt: string) {
  const tools = createDefaultToolRegistry({ defaultContext: { cwd: process.cwd() } });
  const apiKeys = createApiKeyManager({
    stores: [
      // Map provider names to env vars that are valid in shells.
      createEnvApiKeyStore({ map: { 'openai-responses': 'OPENAI_API_KEY' } }),
      createMemoryApiKeyStore(),
    ],
  });

  const session = new AgentSession({
    config: {
      provider: 'openai-responses',
      model: 'gpt-4.1-mini',
      tools: tools.listDefinitions(),
    },
    tools,
    providerTransport: {
      // supply getApiKey/setApiKey (or swap ProviderTransport entirely)
      getApiKey: apiKeys.getApiKey,
      setApiKey: apiKeys.setApiKey,
    },
  });

  try {
    session.send(prompt);

    for await (const event of session) {
      write({ type: 'agent-event', event });
      if (event.type === 'turn-end') {
        write({ type: 'done', ok: true, conversation: session.getConversation() });
        break;
      }
      if (event.type === 'error') {
        write({ type: 'done', ok: false, error: safeError(event.error) });
        break;
      }
    }
  } catch (e) {
    write({ type: 'done', ok: false, error: safeError(e) });
  } finally {
    session.close();
  }
}
```

Notes:
- You can choose to forward *all* events (above), or only `provider` deltas + `turn-end` for a smaller stream.
- If you want an even simpler stream for consumers, map `event` into your own stable schema (and treat Mu’s internal event shapes as an implementation detail).

## Headless CLI: current behavior + how to extend it

`apps/coding-agent --headless` currently prints a **single JSON object** at `turn-end` (see `apps/coding-agent/src/headless.ts`).

If you need a streaming contract for other programs, you have two straightforward options:

- **Build a small wrapper CLI** that uses `AgentSession` and prints NDJSON events (like the snippet above).
- **Extend the existing headless runner** to add a flag like `--json-events` (or `--ndjson`) and write events as they arrive via `session.subscribe(...)` or `for await (const event of session)`.

## Desktop path (Electron/native): recommended shape

The core point: `ProviderTransport` + `Agent` don’t care about UI; they only need config, tools, and a transport. This maps cleanly to desktop apps:

- **Electron**
  - Main process: owns `AgentSession`, `ProviderTransport`, and secrets (API keys / OAuth tokens).
  - Renderer: purely a view; it sends “user prompt” requests and receives streamed `AgentEvent`s over IPC.
  - Suggested IPC: `prompt` (renderer → main), `agent-event` (main → renderer as NDJSON-ish objects), `stop` (renderer → main).

- **Native (Swift/Kotlin/.NET)**
  - Host a Node/Bun worker (or a small local service) that runs `AgentSession`.
  - Use a streaming boundary you already know how to consume: NDJSON over stdio, WebSocket, or a local HTTP streaming endpoint.

Practical guidelines:
- Keep credentials in the “backend” (Electron main / native host), not in the UI process.
- Prefer event streaming (`AgentEvent`s) over polling.
- Treat `turn-start`/`turn-end` as your unit for persistence and “undo/redo” checkpoints.

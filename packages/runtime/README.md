# @mu-agents/runtime

Runtime primitives for Mu agents.

This package recreates the core behavior of `pi-mono/packages/agent/src/agent.ts`
(message queue, thinking levels, attachments) and
`pi-mono/packages/ai/src/agent/agent-loop.ts` (event-driven loop), with **hooks**
and **compaction** intentionally omitted for now.

## Key Concepts

### Agent

`Agent` is a state machine that owns:

- Conversation state (`AgentConversation` from `@mu-agents/types`)
- A message queue for new user/tool inputs
- A transport for invoking providers
- Optional `ToolRegistry` for tool execution

It emits `AgentEvent`s through an `AgentEventStream` for UI or headless clients.

### AgentLoop

`AgentLoop` consumes the queue and drives the agent until idle, forwarding all
agent/provider events. It is both:

- An `AsyncIterable<AgentEvent>` (for TUI/headless streams)
- A subscription-based event source (`subscribe(listener)`).

### AgentSession

`AgentSession` is a thin wrapper used by front-ends:

- Constructs `Agent` + default `ProviderTransport`
- Starts a loop automatically on `send()`
- Exposes a single event stream for clients

## Queue Strategies

Queue strategies control what happens when multiple inputs arrive before the
agent is ready:

- `serial` (default): FIFO. Every enqueued message is processed in order.
- `latest`: keeps only the latest pending message. Useful for “typeahead” UIs
  where earlier inputs should be discarded.

Future strategies (e.g., priority lanes, per-role queues) can be added by
extending `Agent.enqueue`.

## Thinking Levels

`ThinkingLevel` (`off | low | medium | high`) is stored on the agent and passed
through `config.metadata.thinkingLevel`. Providers may ignore it today; it is
reserved for future reasoning-control support.

## Attachments

Attachments can be passed to `Agent.enqueueUserText(text, attachments)` or
`AgentSession.send(text, attachments)`. They are summarized into a JSON block on
the user message so providers can opt-in to reading them later.

Binary payloads are not automatically uploaded; provider adapters can implement
their own attachment handling in the future.

## Transports

- `ProviderTransport` implements `AgentTransport` by resolving adapters from
  `@mu-agents/providers.ProviderRegistry`.
- It uses Bun/DOM `fetch` by default, and registers the built-in provider
  factories (`openai`, `anthropic`, `codex-oauth`).

Custom transports can be supplied when embedding Mu in other environments.

## Extension Hooks (Future)

pi-mono supports lifecycle hooks and compaction to control memory growth and
inject side effects. Those are not yet implemented here.

The intended extension points are:

- **Pre-invoke hooks**: mutate/configure conversation before provider calls.
- **Post-invoke hooks**: observe/transform provider responses.
- **Compaction runners**: rewrite conversation when size limits are hit.

When added, these will sit between the queue and `transport.invoke()` in
`Agent.runProviderRounds`.

## Quick Start

```ts
import { AgentSession } from '@mu-agents/runtime';
import { createDefaultToolRegistry } from '@mu-agents/tools';

const tools = createDefaultToolRegistry();
const session = new AgentSession({
  config: { provider: 'openai', model: 'gpt-4.1-mini', tools: tools.listDefinitions() },
  tools,
});

session.subscribe((event) => console.log(event));
session.send('Hello!');
```


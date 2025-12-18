# mu-agent

Modular AI agent framework.

## Structure

```
apps/
  coding-agent/       CLI coding assistant

packages/
  ai/                 @mariozechner/pi-ai - Unified LLM API
  tui/                @mariozechner/pi-tui - Terminal UI
  agent/              @mariozechner/pi-agent-core - Agent state management
  base-tools/         Read, bash, edit, write tools
  runtime/            Agent runtime
  providers/          Provider registry
  tools/              Tool definitions
  tui-lite/           Lightweight TUI components
  types/              Shared types
```

## Usage

```bash
npm install
npm run coding-agent
```

## Development

```bash
npm run typecheck
npm run test
npm run check        # typecheck + test
```

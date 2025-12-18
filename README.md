# mu-agent

Modular AI agent framework built on composable packages.

## Architecture

```
mu-agent/
├── apps/
│   └── coding-agent/           @mu-agents/coding-agent
│
├── packages/
│   ├── ai/                     @mu-agents/ai
│   ├── agent/                  @mu-agents/agent-core
│   ├── tui/                    @mu-agents/tui
│   └── base-tools/             @mu-agents/base-tools
│
├── docs/
│   └── testing.md
│
├── package.json
└── README.md
```

### Dependency Graph

```
             coding-agent
                  │
      ┌───────────┼───────────┐
      │           │           │
      ▼           ▼           ▼
  ┌──────┐   ┌─────────┐   ┌─────┐
  │  ai  │◄──│ agent-  │   │ tui │
  │      │   │  core   │   │     │
  └──────┘   └─────────┘   └─────┘
      │           │
      └─────┬─────┘
            ▼
      ┌───────────┐
      │base-tools │
      └───────────┘
```

### Core Packages

| Package | NPM | Description |
|---------|-----|-------------|
| **ai** | `@mu-agents/ai` | Unified LLM API supporting OpenAI, Anthropic, Google, Mistral, Groq, xAI, OpenRouter, and OpenAI-compatible endpoints. Auto model discovery, token/cost tracking, streaming. |
| **agent-core** | `@mu-agents/agent-core` | Stateful agent with transport abstraction. Manages conversation state, emits granular events (message updates, tool execution), supports pluggable transports. |
| **tui** | `@mu-agents/tui` | Terminal UI framework with differential rendering for flicker-free updates. Components: Text, Editor, Markdown, SelectList, Image, etc. |
| **base-tools** | `@mu-agents/base-tools` | Standard tool implementations: `read` (files/images), `bash` (command execution), `edit` (surgical text replacement), `write` (file creation). |

## Apps

### coding-agent

CLI coding assistant that combines all packages into a functional agent.

```bash
bun run coding-agent
```

Features:
- Interactive TUI mode with markdown rendering
- Headless mode for scripting (`--headless`)
- Configurable provider/model (`--provider`, `--model`)
- Thinking levels for reasoning models (`--thinking`)

## Usage

```bash
# Install dependencies
bun install

# Run the coding agent
bun run coding-agent

# With options
bun run coding-agent -- --provider anthropic --model claude-sonnet-4-20250514
bun run coding-agent -- --headless "explain this codebase"
```

## Development

```bash
bun run typecheck    # Type check all packages
bun run test         # Run all tests
bun run check        # typecheck + test
```

## Package Dependencies

```
coding-agent
├── ai               # LLM API
├── agent-core       # Agent state management (depends on ai, base-tools)
├── tui              # Terminal UI
└── base-tools       # Tool implementations (depends on ai)
```

## Environment Variables

```bash
# Provider API keys
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
MISTRAL_API_KEY=...

# Agent configuration
MU_PROVIDER=anthropic
MU_MODEL=claude-sonnet-4-20250514
MU_THINKING=medium
MU_SYSTEM_PROMPT="You are a helpful assistant"
```

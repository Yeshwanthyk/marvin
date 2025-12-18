# mu-agent

Modular AI agent framework built on composable packages.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                              Apps                                   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  coding-agent          CLI coding assistant with TUI/headless │  │
│  └───────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                         Core Packages                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  pi-ai          │  │  pi-agent-core  │  │  pi-tui             │  │
│  │  Unified LLM    │  │  Agent state &  │  │  Terminal UI with   │  │
│  │  API            │──│  event system   │──│  diff rendering     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
│           │                    │                                    │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  base-tools               Read, bash, edit, write tools        ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Core Packages

| Package | NPM | Description |
|---------|-----|-------------|
| **pi-ai** | `@mariozechner/pi-ai` | Unified LLM API supporting OpenAI, Anthropic, Google, Mistral, Groq, xAI, OpenRouter, and OpenAI-compatible endpoints. Auto model discovery, token/cost tracking, streaming. |
| **pi-agent-core** | `@mariozechner/pi-agent-core` | Stateful agent with transport abstraction. Manages conversation state, emits granular events (message updates, tool execution), supports pluggable transports. |
| **pi-tui** | `@mariozechner/pi-tui` | Terminal UI framework with differential rendering for flicker-free updates. Components: Text, Editor, Markdown, SelectList, Image, etc. |
| **base-tools** | `@mu-agents/base-tools` | Standard tool implementations: `read` (files/images), `bash` (command execution), `edit` (surgical text replacement), `write` (file creation). |

### Internal Packages

| Package | Description |
|---------|-------------|
| **types** | Shared TypeScript types and schemas (messages, tools, usage, providers) |
| **tools** | Tool definition schemas using TypeBox |
| **providers** | Provider registry and configuration |
| **runtime** | Agent runtime orchestration |
| **tui-lite** | Lightweight TUI components |

## Apps

### coding-agent

CLI coding assistant that combines all packages into a functional agent.

```bash
npm run coding-agent
```

Features:
- Interactive TUI mode with markdown rendering
- Headless mode for scripting (`--headless`)
- Configurable provider/model (`--provider`, `--model`)
- Thinking levels for reasoning models (`--thinking`)

## Usage

```bash
# Install dependencies
npm install

# Run the coding agent
npm run coding-agent

# With options
npm run coding-agent -- --provider anthropic --model claude-sonnet-4-20250514
npm run coding-agent -- --headless "explain this codebase"
```

## Development

```bash
npm run typecheck    # Type check all packages
npm run test         # Run all tests
npm run check        # typecheck + test
```

## Package Dependencies

```
coding-agent
├── pi-ai            # LLM API
├── pi-agent-core    # Agent state management
│   ├── pi-ai
│   └── pi-tui
├── pi-tui           # Terminal UI
└── base-tools       # Tool implementations
    └── pi-ai
```

## Environment Variables

```bash
# Provider API keys (pi-ai)
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

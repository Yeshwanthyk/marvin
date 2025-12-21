# marvin-agent

Modular AI coding agent framework built on composable packages.

## Architecture

```
marvin-agent/
├── apps/
│   └── coding-agent/           @marvin-agents/coding-agent
│
├── packages/
│   ├── ai/                     @marvin-agents/ai
│   ├── agent/                  @marvin-agents/agent-core
│   ├── base-tools/             @marvin-agents/base-tools
│   ├── open-tui/               @marvin-agents/open-tui
│   └── tui/                    @marvin-agents/tui
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
      ┌────────────────┼────────────────┐
      │                │                │
      ▼                ▼                ▼
  ┌──────┐       ┌─────────┐       ┌──────────┐
  │  ai  │◄──────│ agent-  │       │ open-tui │
  │      │       │  core   │       │          │
  └──────┘       └─────────┘       └──────────┘
      │                │
      └───────┬────────┘
              ▼
        ┌───────────┐
        │base-tools │
        └───────────┘
```

### Core Packages

| Package | NPM | Description |
|---------|-----|-------------|
| **ai** | `@marvin-agents/ai` | Unified LLM API supporting OpenAI, Anthropic, Google, Mistral, Groq, xAI, OpenRouter, and OpenAI-compatible endpoints. Auto model discovery, token/cost tracking, streaming. |
| **agent-core** | `@marvin-agents/agent-core` | Stateful agent with transport abstraction. Manages conversation state, emits granular events (message updates, tool execution), supports pluggable transports. |
| **open-tui** | `@marvin-agents/open-tui` | SolidJS-based terminal UI built on OpenTUI. Reactive rendering, theme system (dark/light), tree-sitter syntax highlighting. Components: Markdown, Diff, Editor, SelectList, Image, Dialog, Toast, etc. |
| **tui** | `@marvin-agents/tui` | Terminal UI framework with differential rendering for flicker-free updates. Components: Text, Editor, Markdown, SelectList, Image, etc. |
| **base-tools** | `@marvin-agents/base-tools` | Standard tool implementations: `read` (files/images), `bash` (command execution), `edit` (surgical text replacement), `write` (file creation). |

## Apps

### coding-agent

CLI coding assistant that combines all packages into a functional agent.

```bash
bun run coding-agent
```

Features:
- Interactive TUI with markdown rendering, syntax highlighting
- Headless mode for scripting (`--headless`)
- Configurable provider/model (`--provider`, `--model`)
- Thinking levels for reasoning models (`--thinking`)
- Copy-on-select: selected text auto-copies to clipboard (OSC 52 + pbcopy fallback)
- Expand/collapse tool blocks with inline diff previews
- Custom slash commands, tools, and lifecycle hooks (see below)

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
├── open-tui         # Terminal UI (SolidJS + OpenTUI)
└── base-tools       # Tool implementations (depends on ai)
```

## Extensibility

All user extensions live in `~/.config/marvin/`.

### Custom Slash Commands

Drop `.md` files in `~/.config/marvin/commands/`:

```markdown
<!-- ~/.config/marvin/commands/review.md -->
Review this code for bugs, security issues, and style:

{{input}}
```

Use with `/review <code or file>`. Supports `{{input}}` placeholder (or appends input if missing).

### Custom Tools

Drop `.ts` files in `~/.config/marvin/tools/`:

```typescript
// ~/.config/marvin/tools/hello.ts
import type { ToolFactory } from "@marvin-agents/coding-agent/custom-tools";

const factory: ToolFactory = (api) => ({
  name: "hello",
  description: "Say hello",
  parameters: { type: "object", properties: { name: { type: "string" } } },
  async execute({ name }) {
    return { content: [{ type: "text", text: `Hello, ${name}!` }] };
  },
});

export default factory;
```

ToolAPI provides: `cwd` (working directory), `exec(cmd, args, opts)` (spawn subprocess).

### Lifecycle Hooks

Drop `.ts` files in `~/.config/marvin/hooks/`:

```typescript
// ~/.config/marvin/hooks/logger.ts
import type { HookModule } from "@marvin-agents/coding-agent/hooks";

const hook: HookModule = {
  name: "logger",
  events: {
    "app.start": async ({ marvin }) => {
      marvin.send("Session started at " + new Date().toISOString());
    },
    "tool.execute.before": async ({ tool, input }) => {
      console.log(`[hook] ${tool.name} called`);
    },
  },
};

export default hook;
```

Available events: `app.start`, `session.new`, `session.load`, `session.clear`, `tool.execute.before`, `tool.execute.after`, `tool.execute.<name>.before`, `tool.execute.<name>.after`.

Hooks can inject messages via `marvin.send()` and intercept tool execution.

## Environment Variables

```bash
# Provider API keys
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
```

Agent configuration lives in `~/.config/marvin/config.json` by default (or via `--config-dir` / `--config`).

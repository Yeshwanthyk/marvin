# marvin-agent

Modular AI coding agent framework built on composable packages. Ships as a single binary CLI with a reactive terminal UI, extensible via custom tools and lifecycle hooks.

## Quick Start

```bash
# Install dependencies
bun install

# Build the binary
cd apps/coding-agent && bun run build

# Run (development)
bun run marvin

# Run (binary)
./apps/coding-agent/dist/marvin
```

## Features

- **Multi-provider support**: OpenAI, Anthropic, Google, Mistral, Groq, xAI, OpenRouter, and any OpenAI-compatible endpoint
- **Reactive TUI**: SolidJS-powered terminal interface with tree-sitter syntax highlighting, markdown rendering, and 30+ themes
- **Headless mode**: Scriptable via `--headless "prompt"` for automation
- **Session persistence**: Auto-saves conversations, resume with session picker
- **Thinking levels**: Configurable reasoning depth for supported models (`--thinking low|medium|high`)
- **LSP integration**: TypeScript diagnostics after file modifications (auto-installs language servers)
- **Extensibility**: Drop-in custom slash commands, tools, and lifecycle hooks

## Architecture

```
marvin-agent/
├── apps/
│   └── coding-agent/           Main CLI application
│
├── packages/
│   ├── ai/                     LLM provider abstraction
│   ├── agent/                  Agent state machine & transports
│   ├── base-tools/             Core tools (read/write/edit/bash)
│   ├── lsp/                    Language server integration
│   ├── open-tui/               SolidJS terminal UI components
│   └── tui/                    Low-level TUI framework
│
├── examples/
│   ├── hooks/                  Ready-to-use lifecycle hooks
│   └── tools/subagent/         Example subagent tool
│
└── docs/
    ├── architecture.md         System design & data flow
    └── walkthrough.md          Code discovery guide
```

### Package Dependency Graph

```
                    coding-agent
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
   ┌──────┐        ┌─────────┐       ┌──────────┐
   │  ai  │◄───────│ agent-  │       │ open-tui │
   │      │        │  core   │       │          │
   └──────┘        └─────────┘       └──────────┘
       │                 │                 │
       │                 ▼                 │
       │          ┌───────────┐            │
       └─────────►│base-tools │◄───────────┘
                  └───────────┘
                        │
                        ▼
                  ┌───────────┐
                  │    lsp    │
                  └───────────┘
```

## Core Packages

| Package | Description |
|---------|-------------|
| **@marvin-agents/ai** | Unified LLM API with streaming, token tracking, cost estimation. Supports tool use, thinking/reasoning, and auto model discovery. |
| **@marvin-agents/agent-core** | Stateful agent managing conversation history. Emits granular events for UI binding. Transport abstraction for different backends. |
| **@marvin-agents/base-tools** | Standard file operations: `read` (files + images), `write`, `edit` (surgical replacement), `bash` (command execution). |
| **@marvin-agents/lsp** | Language Server Protocol client. Auto-spawns TypeScript server, injects diagnostics into tool results. |
| **@marvin-agents/open-tui** | SolidJS terminal components: Markdown, CodeBlock, Diff, Editor, SelectList, Dialog, Toast. Theme system with 30+ themes. |
| **@marvin-agents/tui** | Terminal framework with differential rendering for flicker-free updates. |

## Usage

```bash
# Interactive TUI
bun run marvin

# Specify provider and model
bun run marvin -- --provider anthropic --model claude-sonnet-4-20250514

# Headless mode for scripting
bun run marvin -- --headless "explain this codebase"

# With thinking enabled
bun run marvin -- --thinking high

# Custom config directory
bun run marvin -- --config-dir ~/my-marvin-config
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | LLM provider (anthropic, openai, google, etc.) |
| `--model <id>` | Model identifier |
| `--thinking <level>` | Reasoning depth: off, minimal, low, medium, high, xhigh |
| `--headless "<prompt>"` | Run single prompt without TUI |
| `--config-dir <path>` | Config directory (default: ~/.config/marvin) |
| `--config <path>` | Config file path |
| `--yolo` | Disable tool confirmation prompts |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/model [provider] <id>` | Switch model |
| `/thinking <level>` | Set reasoning level |
| `/theme [name]` | Switch theme or list available |
| `/compact [instructions]` | Summarize context to reduce tokens |
| `/clear` | Clear conversation |
| `/diffwrap` | Toggle word-wrap in diffs |
| `/exit`, `/quit` | Exit |

## Extensibility

All extensions live in `~/.config/marvin/`:

```
~/.config/marvin/
├── config.json           # Provider, model, theme settings
├── commands/             # Custom slash commands (.md files)
├── tools/                # Custom tools (.ts files)
└── hooks/                # Lifecycle hooks (.ts files)
```

### Custom Slash Commands

Drop `.md` files in `~/.config/marvin/commands/`:

```markdown
<!-- ~/.config/marvin/commands/review.md -->
Review this code for bugs, security issues, and style:

{{input}}
```

Use with `/review <code or file>`. The `{{input}}` placeholder is replaced with user input.

### Custom Tools

Drop `.ts` files in `~/.config/marvin/tools/`:

```typescript
// ~/.config/marvin/tools/hello.ts
import type { ToolFactory } from "@marvin-agents/coding-agent/custom-tools";

const factory: ToolFactory = (api) => ({
  name: "hello",
  description: "Say hello to someone",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "Name to greet" } },
    required: ["name"],
  },
  async execute({ name }) {
    return { content: [{ type: "text", text: `Hello, ${name}!` }] };
  },
});

export default factory;
```

The `ToolAPI` provides:
- `cwd`: Current working directory
- `exec(cmd, args, opts)`: Execute subprocess

### Lifecycle Hooks

Drop `.ts` files in `~/.config/marvin/hooks/`. See [`examples/hooks/`](examples/hooks/) for templates.

```typescript
// ~/.config/marvin/hooks/git-context.ts
import type { HookFactory } from "@marvin-agents/coding-agent/hooks";

const hook: HookFactory = (marvin) => {
  marvin.on("session.start", async (ev, ctx) => {
    const { stdout } = await ctx.exec("git", ["branch", "--show-current"]);
    marvin.send(`Current git branch: ${stdout.trim()}`);
  });
};

export default hook;
```

**Available events:**
- `app.start` — After config load, before agent starts
- `session.start` — New session created
- `session.resume` — Existing session loaded
- `session.clear` — Session cleared (/clear command)
- `agent.start` — Agent loop begins
- `agent.end` — Agent loop completes
- `turn.start` — LLM turn begins
- `turn.end` — LLM turn completes (with tool results)
- `tool.execute.before` — Before tool runs (can block)
- `tool.execute.after` — After tool runs (can modify result)

## Configuration

`~/.config/marvin/config.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "thinking": "medium",
  "theme": "catppuccin",
  "lsp": {
    "enabled": true,
    "autoInstall": true
  }
}
```

### LSP Configuration

The LSP system provides real-time TypeScript diagnostics after file modifications:

- **enabled**: Toggle LSP integration (default: `true`)
- **autoInstall**: Auto-install `typescript-language-server` if missing (default: `true`)

Diagnostics are injected into `write` and `edit` tool results, helping the agent catch errors immediately.

## Environment Variables

```bash
# Provider API keys
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
XAI_API_KEY=...
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

## Development

```bash
bun run typecheck    # Type check all packages
bun run test         # Run all tests
bun run check        # typecheck + test

# Build binary
cd apps/coding-agent && bun run build
```

## Documentation

- **[Architecture](docs/architecture.md)** — System design, data flow, component interactions
- **[Code Walkthrough](docs/walkthrough.md)** — Discovery guide from entry point to internals
- **[Testing](docs/testing.md)** — Test patterns and coverage

## License

MIT

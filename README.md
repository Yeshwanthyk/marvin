# marvin

Terminal-native coding agent. Multi-provider, extensible, LSP-aware.

## Install

```bash
# npm (recommended)
npm install -g @yeshwanthyk/coding-agent@latest && marvin

# bun
bun add -g @yeshwanthyk/coding-agent@latest && marvin

# From source
bun install
cd apps/coding-agent && bun run build

# Add to PATH
export PATH="$PATH:/path/to/marvin/apps/coding-agent/dist"
# Or symlink
ln -s /path/to/marvin/apps/coding-agent/dist/marvin ~/.local/bin/marvin
```

## Packages

| Package | Description |
|---------|-------------|
| [`@yeshwanthyk/coding-agent`](apps/coding-agent) | Main CLI app |
| [`@yeshwanthyk/ai`](packages/ai) | Unified LLM API with automatic model discovery and provider configuration |
| [`@yeshwanthyk/agent-core`](packages/agent) | General-purpose agent with transport abstraction, state management, and attachment support |
| [`@yeshwanthyk/base-tools`](packages/base-tools) | Core tools: read, write, edit, bash |
| [`@yeshwanthyk/lsp`](packages/lsp) | Language server integration |
| [`@yeshwanthyk/open-tui`](packages/open-tui) | OpenTUI-based Terminal UI with SolidJS reactive rendering |
| [`@yeshwanthyk/runtime-effect`](packages/runtime-effect) | Effect-powered runtime with layers, session orchestrator, and instrumentation |
| [`@yeshwanthyk/sdk`](packages/sdk) | SDK for building integrations |

## Usage

```bash
marvin                              # Interactive TUI
marvin "fix the types"              # With prompt
marvin --headless "explain this"    # JSON output
marvin -c                           # Continue last session
marvin -r                           # Pick session to resume
marvin validate --config-dir ~/.config/marvin   # Lint hooks/tools/commands
```

## Features

- **Providers**: Anthropic, OpenAI, Google, Codex, OpenRouter, Groq, xAI, Mistral, Cerebras
- **TUI**: SolidJS terminal UI, 30+ themes, precision diff viewing
- **Tools**: read, write, edit, bash, subagent, interview
- **LSP**: Auto-spawns language servers, injects diagnostics
- **Sessions**: Per-cwd persistence, resume with `-c`/`-r`
- **Thinking**: Configurable depth (off → xhigh)
- **Extensibility**: Custom tools, commands, hooks, subagents

## Architecture

```
apps/coding-agent/     # Main CLI
packages/
├── ai/                # LLM provider abstraction
├── agent/             # Agent-core state management
├── base-tools/        # read, write, edit, bash
├── lsp/               # Language server integration
└── open-tui/          # Terminal UI (SolidJS + OpenTUI)
```

See [docs/architecture.md](docs/architecture.md) for layer diagrams, runtime flow, and extensibility details.

## Effect Runtime

All adapters build on the Effect-powered runtime located in `packages/runtime-effect/`:

- **RuntimeLayer** composes config loading, transports, custom extensions, hooks, tools, prompt queue, LSP, and instrumentation via Effect `Layer`s. Adapters call `createRuntime()` once and receive a scoped bundle of services plus a `close()` hook for clean shutdown.
- **SessionOrchestrator** owns the prompt queue. `submitPrompt()` enqueues fire-and-forget work for long-running UIs, while `submitPromptAndWait()` blocks (headless/ACP) until retries, fallbacks, and hooks finish. Attachments (images/documents) flow through the queue so every surface benefits from the same ExecutionPlan.
- **Execution Plans** describe retry/fallback behavior per provider + model cycle. Plans leverage `Effect.ExecutionPlan` so transient errors (429/500) trigger exponential backoff, while provider outages fall back to the next model.
- **Instrumentation + tmux**: each prompt lifecycle emits `tmux:log` events (start, complete, error) so tmux panes or other observers can tail runtime progress without coupling to adapter state.

When adding new surfaces, depend on `RuntimeServices.sessionOrchestrator` instead of calling `Agent.prompt` directly—this guarantees identical hook semantics, session persistence, and resiliency across TUI, headless CLI, ACP, or future adapters.

## Configuration

`~/.config/marvin/`:

```
├── config.json        # provider, model, theme, thinking, lsp
├── agents.md          # global instructions
├── agents/            # subagent definitions
├── commands/          # custom slash commands (.md)
├── hooks/             # lifecycle hooks (.ts)
├── tools/             # custom tools (.ts)
└── sessions/          # session persistence
```

### config.json

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "thinking": "high",
  "theme": "catppuccin",
  "editor": "code --wait",
  "lsp": { "enabled": true, "autoInstall": true }
}
```

## CLI Options

```
--provider <name>      Provider (anthropic, openai, google, codex, openrouter, groq, xai, mistral, cerebras)
--model <id>           Model id (comma-separated for cycling with Ctrl+P)
--thinking <level>     off | minimal | low | medium | high | xhigh
--continue, -c         Continue most recent session
--resume, -r           Pick session to resume
--headless             JSON output, no TUI
--config <path>        Custom config.json
--config-dir <path>    Custom config directory
validate               Subcommand that runs schema validation on hooks/tools/commands
```

## Commands

```
/model [provider] <id>    Switch model
/thinking <level>         Set thinking level
/theme [name]             Switch theme
/editor                   Open editor
/compact [instructions]   Compress context
/status                   Show session status
/abort                    Abort request
/clear                    Clear chat
/exit                     Exit
```

## Shell Mode

```bash
! ls -la         # Run command, show output
!! git status    # Run and inject into context
```

## Extensibility

### Custom Commands

```markdown
<!-- ~/.config/marvin/commands/review.md -->
Review this code for bugs and improvements.
$ARGUMENTS
```

### Custom Tools

```typescript
// ~/.config/marvin/tools/my-tool.ts
import { Type } from "@sinclair/typebox"

export default function(api) {
  return {
    name: "my_tool",
    description: "Does something",
    parameters: Type.Object({ input: Type.String() }),
    async execute(toolCallId, params) {
      return { content: [{ type: "text", text: params.input }] }
    }
  }
}
```

### Hooks

```typescript
// ~/.config/marvin/hooks/my-hook.ts
export default function(marvin) {
  marvin.on("tool.execute.before", async (event, ctx) => {
    if (event.input.command?.includes("rm -rf /")) {
      return { block: true, reason: "Blocked" }
    }
  })
}
```

Events: `app.start`, `session.*`, `agent.*`, `turn.*`, `tool.execute.before/after`

### Subagents

`~/.config/marvin/agents/*.md` or `.marvin/agents/*.md`:

```markdown
---
name: reviewer
description: Code review specialist
model: claude-sonnet-4-20250514
---
You are a code reviewer. Focus on correctness and security.
```

## Development

```bash
bun run typecheck    # Type check all packages
bun run test         # Run tests
bun run check        # Both
```

## License

MIT

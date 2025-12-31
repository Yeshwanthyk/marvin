# marvin

Terminal-native coding agent. Multi-provider, extensible tooling, LSP integration.

## Philosophy

Deliberate, thoughtful control over the coding process.

Instead of blindly relying on black-box agents (Claude Code, Codex) and hoping they do the right thing at the right time, marvin is built around explicit orchestration: invoking subagents when *you* decide, adding custom tools, triggering hooks at precise moments. Foot on the accelerator, not mashing it.

The goal is building good software — not just generating code fast.

### Inspirations

- [pi](https://shittycodingagent.ai/) — AI agent toolkit by badlogic. Unified LLM API, TUI/web UI, Slack bot, vLLM pods. Much of marvin's architecture remixes ideas from here.
- [opencode](https://opencode.ai/) — Terminal-native coding agent in Go. Clean architecture, good defaults.

## Install

```bash
# Install deps
bun install

# Build binary
cd apps/coding-agent && bun run build

# Add to PATH (~/.zshrc or ~/.bashrc)
export PATH="$PATH:/path/to/marvin-agent/apps/coding-agent/dist"

# Or symlink
ln -s /path/to/marvin-agent/apps/coding-agent/dist/marvin ~/.local/bin/marvin
```

## Usage

```bash
marvin                              # Interactive TUI
marvin "fix the types"              # With prompt
marvin --headless "explain this"    # JSON output for scripting
marvin -c                           # Continue last session
marvin -r                           # Pick session to resume
```

## Features

- **Providers**: Anthropic (Pro/Max OAuth), OpenAI, Codex, Google, opencode Zen
- **TUI**: SolidJS-powered terminal UI with 30+ themes
- **Tools**: read, write, edit, bash, subagent
- **LSP**: Auto-spawns language servers, injects diagnostics into tool results
- **Sessions**: Per-cwd persistence, resume with `-c` or `-r`
- **Thinking**: Configurable reasoning depth (off → xhigh)
- **Precision Diffs**: Terminal-native diff viewing with OpenTUI for precise layout control
- **Extensibility**: Custom tools, commands, and lifecycle hooks

## Architecture

```
apps/coding-agent/     # Main CLI
packages/
├── ai/                # LLM provider abstraction
├── agent/             # Agent state machine & transports
├── base-tools/        # read, write, edit, bash
├── lsp/               # Language server integration
└── open-tui/          # Terminal UI (SolidJS + OpenTUI)
```

## Configuration

All config in `~/.config/marvin/`:

```
├── config.json        # provider, model, theme, thinking, lsp
├── agents.md          # global AGENTS.md instructions
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
  "lsp": { "enabled": true, "autoInstall": true }
}
```

## CLI Options

```
--provider <name>      anthropic, openai, codex, google, opencode
--model <id>           Model id or comma-separated list (Ctrl+P to cycle)
--thinking <level>     off | minimal | low | medium | high | xhigh
--continue, -c         Continue most recent session
--resume, -r           Pick session to resume
--headless             JSON output, no TUI
```

## Slash Commands

```
/model [provider] <id>    Switch model
/thinking <level>         Set thinking level
/theme [name]             Switch theme
/editor                   Open external editor
/compact [instructions]   Compress context
/status                   Show agent/session status
/conceal                  Toggle markdown syntax hiding
/clear                    Clear conversation
/exit                     Exit
```

## Shell Mode

Prefix input with `!` for quick shell commands:
- `! ls -la` — Run command, show output
- `!! git status` — Run and inject output into context

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
    // Block dangerous commands
    if (event.input.command?.includes("rm -rf /")) {
      return { block: true, reason: "Blocked" }
    }
  })
}
```

Events: `app.start`, `session.*`, `agent.*`, `turn.*`, `tool.execute.before/after`

### Subagents

Define in `~/.config/marvin/agents/*.md`:

```markdown
---
name: reviewer
description: Code review specialist
model: claude-sonnet-4-20250514
---

You are a code reviewer. Focus on correctness and security.
```

Modes: single, parallel (up to 8), chain (with `{previous}` placeholder).

## What's NOT Included

Intentionally omitted:

- **MCP** — No Model Context Protocol
- **Permission gating** — No approval prompts
- **Plan mode** — No separate planning phase
- **Built-in todos** — No task tracking
- **Background tasks** — No async task queue

## Development

```bash
bun run typecheck    # Type check all packages
bun run test         # Run tests
bun run check        # typecheck + test
```

## Docs

See [`apps/coding-agent/README.md`](apps/coding-agent/README.md) for full documentation.

## License

MIT

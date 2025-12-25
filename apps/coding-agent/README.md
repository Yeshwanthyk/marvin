# Marvin

Terminal-native coding agent with multi-provider support, extensible tooling, and LSP integration.

## Install

```bash
# Build binary
cd apps/coding-agent && bun run build

# Add to PATH (e.g., in ~/.zshrc)
export PATH="$PATH:/path/to/marvin-agent/apps/coding-agent/dist"

# Or symlink to a bin directory
ln -s /path/to/marvin-agent/apps/coding-agent/dist/marvin ~/.local/bin/marvin
```

## Quick Start

```bash
# Run with TUI
marvin

# Or with prompt
marvin "explain this codebase"

# Headless mode (JSON output)
marvin --headless "fix the types"
```

## Providers

| Provider | Auth | Notes |
|----------|------|-------|
| Anthropic | `ANTHROPIC_API_KEY` or OAuth | Pro/Max plans via OAuth flow |
| OpenAI | `OPENAI_API_KEY` | GPT-4o, o1, o3 |
| Codex | CodexTransport | OAuth-based, `bun run codex-auth` |
| Google | `GOOGLE_API_KEY` | Gemini models |
| opencode | `OPENCODE_API_KEY` | Zen |

## Configuration

Config lives in `~/.config/marvin/`:

```
~/.config/marvin/
├── config.json          # provider, model, theme, thinking, lsp settings
├── agents.md            # global AGENTS.md instructions
├── agents/              # subagent definitions
├── commands/            # custom slash commands
├── hooks/               # lifecycle hooks
├── tools/               # custom tools
├── sessions/            # session persistence (per cwd)
└── codex-tokens.json    # codex OAuth tokens
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

Editor config (used by `/editor`):

```json
"editor": "code --wait"
```

```json
"editor": { "command": "wezterm", "args": ["start", "--cwd", "{cwd}", "--", "nvim"] }
```

Use the object form when command/args include spaces. Defaults to `nvim` when unset. `/editor` writes a temp file, suspends the TUI, then restores the prompt with the edited contents when the editor exits. The editor runs with `cwd` set to the current working directory; include `{cwd}` if your editor needs it. For GUI editors, add `--wait` so `/editor` blocks until the file closes.

### AGENTS.md

Loaded from (first found):
- `~/.config/marvin/agents.md`
- `~/.codex/agents.md`
- `~/.claude/CLAUDE.md`

Project-level (merged with global):
- `./AGENTS.md`
- `./CLAUDE.md`

## CLI Options

```
marvin [prompt]

Options:
  --provider <name>      Provider (anthropic, openai, codex, google, opencode)
  --model <id>           Model id or comma-separated list (Ctrl+P to cycle)
  --thinking <level>     off | minimal | low | medium | high | xhigh
  --continue, -c         Continue most recent session
  --resume, -r           Pick session to resume
  --headless             JSON output, no TUI
  --config <path>        Custom config.json path
  --config-dir <path>    Custom config directory
```

## Keybindings

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Ctrl+C` | Abort current request / Exit |
| `Ctrl+P` | Cycle through model list |
| `Ctrl+L` | Clear screen |
| `Ctrl+N/P` | Autocomplete navigation |
| `Tab` | Accept autocomplete |
| `Esc` | Dismiss autocomplete |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/model [provider] <id>` | Switch model |
| `/thinking <level>` | Set thinking level |
| `/theme [name]` | Switch theme (30+ built-in) |
| `/editor` | Open configured editor |
| `/compact [instructions]` | Compress context |
| `/clear` | Clear conversation |
| `/diffwrap` | Toggle diff word-wrap |
| `/exit`, `/quit` | Exit |

Custom commands: `~/.config/marvin/commands/*.md`

```markdown
# ~/.config/marvin/commands/review.md
Review the following code for bugs, security issues, and improvements.

$ARGUMENTS
```

Usage: `/review src/index.ts`

## Tools

### Built-in (base-tools)

- **read** — Read files (text + images)
- **write** — Write/create files
- **edit** — Surgical text replacement
- **bash** — Execute shell commands

### Subagent

Delegate tasks to specialized agents with isolated context.

```bash
# Define agents in ~/.config/marvin/agents/*.md
# Or project-level: .marvin/agents/*.md
```

Agent definition:
```markdown
---
name: reviewer
description: Code review specialist
model: claude-sonnet-4-20250514
---

You are a code reviewer. Focus on correctness, security, and maintainability.
```

Modes:
- **Single**: `{ agent: "name", task: "..." }`
- **Parallel**: `{ tasks: [{ agent, task }, ...] }`
- **Chain**: `{ chain: [{ agent, task: "... {previous} ..." }, ...] }`

### Custom Tools

```typescript
// ~/.config/marvin/tools/my-tool.ts
import { Type } from "@sinclair/typebox"

export default function(api: { cwd: string; exec: Function }) {
  return {
    name: "my_tool",
    description: "Does something useful",
    parameters: Type.Object({
      input: Type.String({ description: "Input value" })
    }),
    async execute(toolCallId: string, params: { input: string }) {
      return {
        content: [{ type: "text", text: `Result: ${params.input}` }],
        details: { /* structured data for UI */ }
      }
    }
  }
}
```

Custom tools can include:
- `renderCall(args, theme)` — Custom call rendering
- `renderResult(result, opts, theme)` — Custom result rendering
- `onSession(event)` — Session lifecycle hook
- `dispose()` — Cleanup on exit

## Hooks

Lifecycle hooks for automation and integrations.

```typescript
// ~/.config/marvin/hooks/my-hook.ts
import type { HookAPI } from "@marvin-agents/coding-agent"

export default function(marvin: HookAPI) {
  marvin.on("app.start", async (event, ctx) => {
    // App initialized
  })

  marvin.on("tool.execute.before", async (event, ctx) => {
    // Block or modify tool execution
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      return { block: true, reason: "Dangerous command blocked" }
    }
  })

  marvin.on("tool.execute.after", async (event, ctx) => {
    // Modify tool results
    return { content: event.content }
  })

  marvin.on("agent.end", async (event, ctx) => {
    // Agent loop completed
  })
}
```

Available events:
- `app.start` — Config loaded, before agent starts
- `session.start`, `session.resume`, `session.clear`
- `agent.start`, `agent.end`
- `turn.start`, `turn.end`
- `tool.execute.before`, `tool.execute.after`

Hook context provides:
- `ctx.exec(command, args, options)` — Run shell commands
- `ctx.cwd` — Current working directory
- `ctx.configDir` — Config directory path

## LSP Integration

Language servers spawn automatically per file type. Diagnostics are injected into tool results after edit/write/bash operations.

```json
// config.json
{
  "lsp": {
    "enabled": true,
    "autoInstall": true
  }
}
```

Supported: TypeScript/JavaScript (auto-installed), with registry for more.

Custom LSP config: `~/.config/marvin/lsp/`

## Themes

30+ built-in themes:

```
marvin (default), aura, ayu, catppuccin, catppuccin-macchiato, cobalt2,
dracula, everforest, flexoki, github, gruvbox, kanagawa, lucent-orng,
material, matrix, mercury, monokai, nightowl, nord, one-dark, opencode,
orng, palenight, rosepine, solarized, synthwave84, tokyonight, vercel,
vesper, zenburn
```

Switch: `/theme <name>` or set in config.json.

## Sessions

Sessions persist per working directory in `~/.config/marvin/sessions/`.

- `-c, --continue` — Resume most recent session
- `-r, --resume` — Pick from session list

Sessions store: metadata, messages, tool results (JSONL format).

## Headless Mode

For scripting and subagent invocations:

```bash
marvin --headless "fix the types" | jq .
```

Output:
```json
{
  "ok": true,
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "prompt": "fix the types",
  "assistant": "I've fixed the type errors..."
}
```

## What's NOT Included

Intentionally omitted for simplicity:

- **MCP** — No Model Context Protocol
- **Permission gating** — No approval prompts for tool use
- **Plan mode** — No separate planning phase
- **Built-in todos** — No task tracking
- **Background tasks** — No async task queue

## Development

```bash
# Install deps
bun install

# Run dev
bun run marvin

# Typecheck
bun run typecheck

# Test
bun run test

# Build binary
cd apps/coding-agent && bun run build
```

## Architecture

```
apps/coding-agent/     # Main CLI app
packages/
├── ai/                # LLM provider abstraction
├── agent/             # Agent-core state management
├── base-tools/        # read, write, edit, bash
├── lsp/               # Language server integration
└── open-tui/          # Terminal UI framework (SolidJS + OpenTUI)
```

# AGENTS.md

Project-specific instructions for AI agents working on this codebase.

## Quick Reference

```bash
# Verify changes
bun run check              # typecheck + test

# Individual commands
bun run typecheck          # tsc --noEmit on all packages
bun run test               # bun test (all packages)
bun test apps/coding-agent/tests  # specific package

# Run dev
bun run marvin             # alias for coding-agent

# Compile binary (run after changes to coding-agent)
cd apps/coding-agent && bun build --compile src/index.ts --outfile ~/commands/marvin
```

## Structure

- `apps/coding-agent/` — main CLI app
- `packages/ai/` — LLM provider abstraction
- `packages/agent/` — agent-core state management
- `packages/tui/` — terminal UI framework
- `packages/base-tools/` — read/write/edit/bash tools

## Conventions

- Bun runtime, TypeScript strict mode
- Each package has own `tsconfig.json`, root runs all via `bun run typecheck`
- Tests: `*.test.ts` files, use `bun:test`
- No default exports; prefer named exports
- Tool results use `{ content: [{type: 'text', text: ...}], details?: {...} }` shape

## TUI Rendering

- `message-rendering.ts` — tool output formatting
- `agent-events.ts` — event handlers, stores tool state in `ToolBlockEntry`
- `tui-app.ts` — main app loop, keybindings
- Diff rendering uses `diff` package for word-level highlighting

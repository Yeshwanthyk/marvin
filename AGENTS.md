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
# NOTE: Must use build script - direct `bun build --compile` fails due to Solid JSX plugin requirement
cd apps/coding-agent && bun run build
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

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->

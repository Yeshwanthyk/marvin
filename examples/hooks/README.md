# Hook Examples

Lifecycle hooks let you run code at key agent events.

## Installation

Copy any hook to your config directory:

```bash
mkdir -p ~/.config/marvin/hooks
cp examples/hooks/git-context.ts ~/.config/marvin/hooks/
```

## Available Hooks

| File | Description |
|------|-------------|
| `git-context.ts` | Injects recent git commits on session start |
| `tool-logger.ts` | Logs tool executions to stderr |

## Available Events

| Event | Payload |
|-------|---------|
| `app.start` | `{ marvin, ctx }` |
| `session.new` | `{ marvin, ctx }` |
| `session.load` | `{ marvin, ctx, sessionId }` |
| `session.clear` | `{ marvin, ctx }` |
| `tool.execute.before` | `{ tool, input, ctx }` |
| `tool.execute.after` | `{ tool, input, output, ctx }` |
| `tool.execute.<name>.before` | `{ input, ctx }` |
| `tool.execute.<name>.after` | `{ input, output, ctx }` |

## API

- `marvin.send(text)` — inject a user message
- `ctx.cwd` — current working directory
- `ctx.exec(cmd, args, opts)` — run subprocess, returns `{ stdout, stderr, code }`

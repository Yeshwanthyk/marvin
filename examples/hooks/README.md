# Hook Examples

Lifecycle hooks let you run code at key agent events.

Hooks are TypeScript modules loaded from `~/.config/marvin/hooks/*.ts`.

## Installation

Copy any hook to your config directory:

```bash
mkdir -p ~/.config/marvin/hooks
cp examples/hooks/git-context.ts ~/.config/marvin/hooks/
```

## API

Hooks export a default function:

```ts
import type { HookFactory } from "@marvin-agents/coding-agent/hooks";

const hook: HookFactory = (marvin) => {
  marvin.on("session.start", async (_ev, ctx) => {
    const res = await ctx.exec("git", ["branch", "--show-current"]);
    if (res.code === 0) marvin.send(`Current git branch: ${res.stdout.trim()}`);
  });
};

export default hook;
```

- `marvin.on(event, handler)` — subscribe to events
- `marvin.send(text)` — inject a user message into the session
- `ctx.exec(cmd, args, opts)` — run subprocess, returns `{ stdout, stderr, code }`

## Available Events

- `app.start`
- `session.start`
- `session.resume`
- `session.clear`
- `agent.start`
- `agent.end`
- `turn.start`
- `turn.end`
- `tool.execute.before`
- `tool.execute.after`

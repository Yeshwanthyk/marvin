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

## OpenCode-Style Snapshots

Hook: `examples/hooks/opencode-snapshot-rewind.ts`

Stores snapshots in a **private git object DB** under XDG data, avoiding pollution of your project's git refs. Captures all files including untracked (unlike `git stash create`).

- Location: `$XDG_DATA_HOME/marvin/snapshot/<projectId>/` (or `~/.local/share/marvin/snapshot/<projectId>/`)
- Creates `refs/marvin-checkpoints/*` refs in that private git dir

### Install

```bash
cp examples/hooks/opencode-snapshot-rewind.ts ~/.config/marvin/hooks/
```

### Restore

Replace `<gitDir>` with the path from `[snapshot]` stderr output (e.g., `~/.local/share/marvin/snapshot/<hash>`), and `<root>` with your repo root:

```bash
# Restore to session start state
git --git-dir <gitDir> --work-tree <root> read-tree refs/marvin-checkpoints/resume
git --git-dir <gitDir> --work-tree <root> checkout-index -a -f

# Restore to latest checkpoint
git --git-dir <gitDir> --work-tree <root> read-tree refs/marvin-checkpoints/latest
git --git-dir <gitDir> --work-tree <root> checkout-index -a -f
```

### Notes

- Does NOT delete extra files added since checkpoint (same as OpenCode)
- Run `git clean -fd` manually if you need to remove untracked files added after checkpoint

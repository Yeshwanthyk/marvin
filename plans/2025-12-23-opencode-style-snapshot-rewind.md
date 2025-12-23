# Opencode-Style Snapshot/Rewind Hook for Marvin — Implementation Plan

## Overview
Add an **OpenCode-style** checkpoint mechanism to Marvin via a **drop-in lifecycle hook**. Each checkpoint is a **git tree hash** stored in a **private git object DB per project** under **XDG data**, enabling restoring file state (including recovering deleted files) without polluting the user’s repo refs.

Primary deliverable: a hook users can copy into `~/.config/marvin/hooks/`.

## Current State

### Marvin hook system
- Hooks are loaded from `~/.config/marvin/hooks/*.ts` (non-recursive) via Bun `import()` and must `export default` a `HookFactory` function. `apps/coding-agent/src/hooks/loader.ts:69`
- Hook handlers are registered via `marvin.on(event, handler)` and can inject a message with `marvin.send(text)`. `apps/coding-agent/src/hooks/types.ts:167`
- Hook handler context includes:
  - `ctx.exec(cmd, args, opts)` (subprocess, `cwd` locked to Marvin process cwd)
  - `ctx.cwd`, `ctx.configDir` `apps/coding-agent/src/hooks/types.ts:29`
- Events of interest:
  - `session.start`, `session.resume`, `turn.start` (turn = one model call cycle)
  - emitted by TUI at `apps/coding-agent/src/tui-app.tsx:214` and by agent loop at `apps/coding-agent/src/agent-events.ts:225`

### Existing rewind example (not OpenCode-style)
- `examples/hooks/rewind-checkpoints.ts` uses **user repo refs** + `git stash create` (tracked-only snapshots). This does **not** match OpenCode’s private object DB approach and won’t capture untracked files.

### OpenCode snapshot approach (reference)
- Stores snapshots in a **private git dir** under XDG data: `Global.Path.data/snapshot/<project.id>` (`/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/snapshot/index.ts:195`).
- Snapshot = tree hash from:
  - `git add .`
  - `git write-tree`
  (`/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/snapshot/index.ts:31`).
- Restore = `read-tree <tree> && checkout-index -a -f` (`/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/snapshot/index.ts:74`).

## Desired End State

### Behavior
- When Marvin runs inside a git worktree:
  - On `session.start` and `session.resume`: create a **baseline** snapshot (`resume`).
  - On each `turn.start`: create a **turn checkpoint** (pre-turn state).
- Checkpoints are stored in a **private git object DB** under:
  - `$XDG_DATA_HOME/marvin/snapshot/<projectId>/` (or `~/.local/share/marvin/snapshot/<projectId>/` if `XDG_DATA_HOME` unset)
- A small set of **refs** in the private git dir point at snapshots:
  - `refs/marvin-checkpoints/resume` — baseline
  - `refs/marvin-checkpoints/latest` — most recent checkpoint
  - `refs/marvin-checkpoints/checkpoint-...` — historical, pruned to last N

### Restore workflow
- User can restore files with OpenCode-equivalent commands (no reliance on user repo state):
  - `git --git-dir <snapshotGitDir> --work-tree <repoRoot> read-tree <tree>`
  - `git --git-dir <snapshotGitDir> --work-tree <repoRoot> checkout-index -a -f`

### Verification
- Manual:
  - Start Marvin in a git repo, send a prompt that edits files.
  - Confirm snapshot dir exists and refs update per turn.
  - Delete files (`rm -rf path`) and restore from `resume` / `latest`, confirming files reappear.
- Repo checks:
  - `bun run typecheck`
  - `bun run test`

## Out of Scope
- Conversation rewind / session truncation UI (OpenCode does message-level revert; Marvin hooks cannot mutate conversation state).
- Auto-deleting extra files on restore (OpenCode’s `restore()` doesn’t delete extras; deletion behavior comes from patch-based revert).
- Cross-machine snapshot portability.
- GC / retention management of the private git object store beyond ref pruning.

## Error Handling Strategy
- If not in a git worktree, hook is a no-op.
- All hook handlers must **never throw** (log to stderr and return) to avoid impacting agent operation.
- Use timeouts for git commands; if a command times out or returns non-zero, skip checkpoint creation.

## Implementation Approach
Implement an **example hook** mirroring OpenCode’s `Snapshot.track()` shape:
- Resolve repo root (`git rev-parse --show-toplevel`).
- Resolve project ID:
  - Preferred: root commit hash (`git rev-list --max-parents=0 --all` → stable-ish)
  - Fallback: hash of repo root path (fast + always available)
- Resolve snapshot dir:
  - `dataHome = process.env.XDG_DATA_HOME ?? ~/.local/share`
  - `snapshotGitDir = ${dataHome}/marvin/snapshot/${projectId}`
- Ensure snapshot repo exists (`git --git-dir <snapshotGitDir> init` once).
- Track snapshot:
  - Use `git -C <repoRoot> --git-dir <snapshotGitDir> --work-tree <repoRoot> add -A .` to capture deletions reliably.
  - Use `git ... write-tree` to get tree hash.
  - Store tree hash in refs under `refs/marvin-checkpoints/...` within the private repo.
- Prune historical refs to `MAX_CHECKPOINTS`.

Alternative considered (rejected): using user repo refs (`refs/...`) + `git stash create` (does not include untracked, pollutes repo).

---

## Phase 1: Add OpenCode-Style Snapshot Hook

### Overview
Add a new hook example that users can copy directly to enable OpenCode-style snapshotting.

### Prerequisites
- [ ] Running inside a git repo for manual verification

### Changes

#### 1. Add new hook
**File**: `examples/hooks/opencode-snapshot-rewind.ts`
**Lines**: new file

**Add**:
```ts
/**
 * OpenCode-style snapshot hook for Marvin.
 *
 * Stores checkpoints in a private git object DB under XDG data:
 *   $XDG_DATA_HOME/marvin/snapshot/<projectId>/
 *
 * Creates refs (inside the private snapshot repo):
 *   refs/marvin-checkpoints/resume
 *   refs/marvin-checkpoints/latest
 *   refs/marvin-checkpoints/checkpoint-*
 */

import type { HookFactory } from "@marvin-agents/coding-agent/hooks";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import crypto from "node:crypto";

const REF_PREFIX = "refs/marvin-checkpoints/";
const MAX_CHECKPOINTS = 100;

function dataHome(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.trim()) return xdg;
  return path.join(os.homedir(), ".local", "share");
}

function marvinDataDir(): string {
  return path.join(dataHome(), "marvin");
}

async function inGit(ctx: any): Promise<boolean> {
  const r = await ctx.exec("git", ["rev-parse", "--is-inside-work-tree"], { timeout: 2000 });
  return r.code === 0 && r.stdout.trim() === "true";
}

async function repoRoot(ctx: any): Promise<string | null> {
  const r = await ctx.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 5000 });
  if (r.code !== 0) return null;
  return r.stdout.trim();
}

async function projectId(ctx: any, root: string): Promise<string> {
  const roots = await ctx.exec("git", ["-C", root, "rev-list", "--max-parents=0", "--all"], { timeout: 5000 });
  const candidates = roots.stdout
    .split("\n")
    .map((s: string) => s.trim())
    .filter(Boolean)
    .sort();

  if (candidates[0]) return candidates[0];

  // Fallback: stable per-machine/per-path
  return crypto.createHash("sha1").update(root).digest("hex");
}

async function ensureSnapshotRepo(ctx: any, gitDir: string): Promise<void> {
  await fs.mkdir(gitDir, { recursive: true });
  const headPath = path.join(gitDir, "HEAD");
  const hasHead = await fs.stat(headPath).then(() => true).catch(() => false);
  if (hasHead) return;

  const r = await ctx.exec("git", ["--git-dir", gitDir, "init"], { timeout: 5000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || "git init failed").trim());

  await ctx.exec("git", ["--git-dir", gitDir, "config", "core.autocrlf", "false"], { timeout: 2000 });
}

async function trackTree(ctx: any, gitDir: string, root: string): Promise<string> {
  // NOTE: use -A to capture deletions (rm -rf) reliably.
  await ctx.exec("git", ["-C", root, "--git-dir", gitDir, "--work-tree", root, "add", "-A", "."], { timeout: 30_000 });
  const w = await ctx.exec("git", ["-C", root, "--git-dir", gitDir, "--work-tree", root, "write-tree"], { timeout: 30_000 });
  if (w.code !== 0) throw new Error((w.stderr || w.stdout || "git write-tree failed").trim());
  return w.stdout.trim();
}

async function updateRef(ctx: any, gitDir: string, ref: string, oid: string, msg: string): Promise<void> {
  const r = await ctx.exec("git", ["--git-dir", gitDir, "update-ref", "-m", msg, ref, oid], { timeout: 5000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `update-ref failed: ${ref}`).trim());
}

async function prune(ctx: any, gitDir: string): Promise<void> {
  const r = await ctx.exec("git", ["--git-dir", gitDir, "for-each-ref", "--format=%(refname)", REF_PREFIX], { timeout: 5000 });
  if (r.code !== 0) return;
  const refs = r.stdout
    .split("\n")
    .map((s: string) => s.trim())
    .filter((s: string) => s.startsWith(`${REF_PREFIX}checkpoint-`))
    .sort();

  const excess = refs.length - MAX_CHECKPOINTS;
  if (excess <= 0) return;

  for (const ref of refs.slice(0, excess)) {
    await ctx.exec("git", ["--git-dir", gitDir, "update-ref", "-d", ref], { timeout: 5000 });
  }
}

const hook: HookFactory = (marvin) => {
  const state = { gitDir: "", root: "" };

  const checkpoint = async (ctx: any, kind: string) => {
    const tree = await trackTree(ctx, state.gitDir, state.root);
    const ts = Date.now();
    const id = `${REF_PREFIX}checkpoint-${kind}-${ts}`;
    await updateRef(ctx, state.gitDir, id, tree, `marvin checkpoint (${kind})`);
    await updateRef(ctx, state.gitDir, `${REF_PREFIX}latest`, tree, `marvin checkpoint (latest)`);
    if (kind === "resume") await updateRef(ctx, state.gitDir, `${REF_PREFIX}resume`, tree, `marvin checkpoint (resume)`);
    await prune(ctx, state.gitDir);
    console.error(`[snapshot] ${kind} tree=${tree} gitDir=${state.gitDir}`);
  };

  const init = async (ctx: any) => {
    if (!(await inGit(ctx))) return false;
    const root = await repoRoot(ctx);
    if (!root) return false;

    const id = await projectId(ctx, root);
    const dir = path.join(marvinDataDir(), "snapshot", id);
    await ensureSnapshotRepo(ctx, dir);

    state.root = root;
    state.gitDir = dir;
    return true;
  };

  marvin.on("session.start", async (_ev, ctx) => {
    try {
      if (!(await init(ctx))) return;
      await checkpoint(ctx, "resume");
    } catch (err) {
      console.error(`[snapshot] session.start failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  marvin.on("session.resume", async (_ev, ctx) => {
    try {
      if (!(await init(ctx))) return;
      await checkpoint(ctx, "resume");
    } catch (err) {
      console.error(`[snapshot] session.resume failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  marvin.on("turn.start", async (ev, ctx) => {
    try {
      if (!state.gitDir || !state.root) {
        if (!(await init(ctx))) return;
      }
      await checkpoint(ctx, `turn-${ev.turnIndex}`);
    } catch (err) {
      console.error(`[snapshot] turn.start failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
};

export default hook;
```

**Why**: This mirrors OpenCode’s `write-tree` snapshot model (private object DB, tree hashes), while keeping implementation hook-only.

### Edge Cases to Handle
- [x] Non-git directory: no-op
- [x] Git present but `rev-parse --show-toplevel` fails: no-op
- [x] Snapshot repo initialization fails: log + skip
- [x] Huge repos: keep timeouts and ref pruning

### Success Criteria

**Automated**:
```bash
bun run typecheck   # ✓ passed
bun run test        # ✓ passed
```

**Manual**:
- [ ] `cp examples/hooks/opencode-snapshot-rewind.ts ~/.config/marvin/hooks/`
- [ ] Run `marvin` in a git repo
- [ ] Observe stderr lines like `[snapshot] resume tree=... gitDir=...`
- [ ] List refs:
  - `git --git-dir <gitDir> for-each-ref refs/marvin-checkpoints/`
- [ ] Delete files and restore:
  - `git --git-dir <gitDir> --work-tree <root> read-tree refs/marvin-checkpoints/resume`
  - `git --git-dir <gitDir> --work-tree <root> checkout-index -a -f`

### Rollback
- Remove hook from `~/.config/marvin/hooks/`.
- Delete snapshot data:
```bash
rm -rf "$XDG_DATA_HOME/marvin/snapshot"   # or ~/.local/share/marvin/snapshot
```

---

## Phase 2: Document Hook + Restore Commands

### Prerequisites
- [ ] Phase 1 manual verification works

### Changes

#### 1. Update hook examples README
**File**: `examples/hooks/README.md`
**Lines**: (update existing)

**Add section**:
```md
## OpenCode-style snapshots

Hook: `examples/hooks/opencode-snapshot-rewind.ts`

- Stores snapshots in `$XDG_DATA_HOME/marvin/snapshot/<projectId>/`
- Creates `refs/marvin-checkpoints/*` in that private git dir

Restore latest/resume:
```bash
# replace <gitDir> and <root>
git --git-dir <gitDir> --work-tree <root> read-tree refs/marvin-checkpoints/latest
git --git-dir <gitDir> --work-tree <root> checkout-index -a -f
```
```

### Success Criteria
- [x] Docs clearly explain where snapshots live and how to restore

---

## Testing Strategy
- No new unit tests required if we keep this as an example hook only.
- Manual checklist above is the primary validation.

## Anti-Patterns to Avoid
- Using user repo refs (`refs/...` in the project repo) → pollutes repos.
- Using `git stash create` → doesn’t capture untracked files.
- Running destructive cleans (e.g., `git clean -fd`) automatically.

## Open Questions
None.

## References
- OpenCode Snapshot implementation: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/snapshot/index.ts:13`
- Marvin hook system types: `apps/coding-agent/src/hooks/types.ts:29`
- Marvin hook loader: `apps/coding-agent/src/hooks/loader.ts:69`

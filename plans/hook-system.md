# Hook system plan (marvin)

## Goal
- First-class TS hooks for workflows across agent lifecycles.
- Discover hooks from:
  - Global: `~/.config/marvin/hooks/*.ts`
  - Project: `<projectRoot>/.marvin/hooks/*.ts`
- Same hook code works in TUI + headless; UI calls degrade safely.

## References (patterns to steal)
- `pi-mono` hook runtime (factory + runner + tool wrapper):
  - Loader + discovery + TS runtime loading via `jiti`: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/hooks/loader.ts`
  - Event model + `HookAPI` + `HookUIContext`: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/hooks/types.ts`
  - Tool interception via wrapped `AgentTool.execute`: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/hooks/tool-wrapper.ts`
- `opencode` plugin runtime (hook-table + trigger pipeline):
  - Central `Plugin.trigger(name, input, output)` pattern: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/plugin/index.ts`
  - Hook surface as a map of hook fns (before/after, params mutation): `/Users/yesh/Documents/personal/reference/opencode/packages/plugin/src/index.ts`

## Options
### A) `pi-mono`-style hooks (recommended baseline)
- Hook file exports `default (pi: HookAPI) => void` and registers handlers via `pi.on()`.
- Pros: ergonomic for per-event workflows; simple mental model; decoupled from app internals.
- Cons: harder to do “output-mutating pipelines” without explicit return conventions.

### B) `opencode`-style hook table
- Hook file exports `async () => ({ "tool.execute.before": fn, ... })`.
- Pros: explicit “before/after” + mutation via shared output object.
- Cons: less idiomatic for lifecycle subscriptions; harder to attach shared state per plugin unless closure-based.

### C) Hybrid
- Keep `pi.on()` subscription model, but borrow `opencode`’s split between:
  - blocking hooks (tool gates) vs
  - best-effort hooks (notify/log/side-effect)

## Proposed design (Hybrid)
### Hook module format
- TS file:
  - `export default function (marvin: HookAPI) { ... }`
- HookAPI:
  - `on(eventName, handler)`
  - optional `send(text, attachments?)` (defer unless needed)

### Discovery
- Global dir: `~/.config/marvin/hooks/` (non-recursive, `*.ts`)
- Project dir: `<projectRoot>/.marvin/hooks/` (non-recursive, `*.ts`)
- Dedupe by resolved absolute path.
- (Optional later) explicit hook paths via config + `--hook` for ad-hoc testing.

### Loading strategy
- Use `jiti` to execute `.ts` without compilation.
- Provide alias map so hooks can import:
  - `@marvin-agents/coding-agent/hooks` (types + optional runtime helpers)
  - `@marvin-agents/ai`, `@marvin-agents/agent-core`, `@marvin-agents/tui` (if needed)
- Keep runtime imports optional; type-only imports should work even without aliasing.

### Event model (v1)
Expose a small, stable union (don’t mirror every low-level stream event):
- `session`: `{ reason: "start" | "switch" | "clear", sessionPath?: string | null, previousSessionPath?: string | null, ... }`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end` (track `turnIndex`)
- `tool_call`: can block `{ block?: boolean; reason?: string }` (NO timeout)
- `tool_result`: can modify `{ content?: ..., details?: ..., isError?: ... }` (timeout)

Mapping sources in marvin:
- Agent loop events come from `@marvin-agents/ai` `AgentEvent` (`packages/ai/src/agent/types.ts`).
- Tool execution happens inside `agentLoop` (`packages/ai/src/agent/agent-loop.ts`) — tool errors are converted to toolResult messages via try/catch.

### Policies
- Non-blocking events: bounded by timeout (default 30s), errors swallowed + reported.
- `tool_call`:
  - no timeout (may require user prompt)
  - failures are fail-safe: treat as block.
- Headless mode:
  - `ctx.hasUI=false`, UI methods are no-op (`select -> null`, `confirm -> false`, `input -> null`).
  - Hooks that require confirmation should default-deny.

### Hook context (`ctx`)
- `ctx.exec(cmd, args, { signal?, timeout? })` (spawn + optional timeout + abort)
- `ctx.ui.select/confirm/input/notify`
- `ctx.cwd`, `ctx.sessionPath`, `ctx.hasUI`

## Integration plan (marvin codebase)
### New modules (app-local)
- `apps/coding-agent/src/hooks/types.ts` — HookAPI + event unions + ctx types
- `apps/coding-agent/src/hooks/loader.ts` — discover + jiti load + aliasing
- `apps/coding-agent/src/hooks/runner.ts` — handler registry, timeouts, ctx.exec, UI context
- `apps/coding-agent/src/hooks/tool-wrapper.ts` — wrap `AgentTool.execute`
- `apps/coding-agent/src/hooks/transport-wrapper.ts` — wrap `AgentTransport` to emit lifecycle hooks in-order

### Wiring points
- `apps/coding-agent/src/tui-app.ts`
  - load hooks early
  - create HookRunner
  - wrap `codingTools`
  - wrap transport
  - set UI context (TUI implementation)
  - emit `session` events on session start/restore/clear
- `apps/coding-agent/src/headless.ts`
  - same load/wrap flow but UI context is no-op
  - `session` events likely absent (no SessionManager today) → `sessionPath=null`

### TUI UI primitives
Implement minimal modal UX using existing TUI components:
- `packages/tui/src/components/select-list.ts`
- `packages/tui/src/components/input.ts`
- `packages/tui/src/components/box.ts`

## Open questions (need decision before coding)
- `tool_result` on errors: current `agentLoop` only marks errors when tool throws; if hook wrapper catches errors to emit `tool_result`, we lose `isError` unless we extend core types/behavior.
  - v1 suggestion: `tool_result` only for successful tool executions (pi-mono behavior).
- `projectRoot` definition for `.marvin/hooks` discovery:
  - v1: `process.cwd()`
  - better: walk up to `.git` or `.marvin` sentinel (avoid monorepo subdir pain)
- Do we need `pi.send()` v1? (external triggers/file watchers) — adds queueing + session semantics.

## Risks
- Loader robustness: ESM/TS interop, caching, alias correctness.
- UI integration: modal input must not break existing keybindings / focus.
- Ordering: lifecycle hooks must be emitted synchronously/in-order (transport wrapper beats `agent.subscribe`).
- Security: hooks are arbitrary code; treat as trusted-local only.

## Verification
- Unit tests:
  - loader discovery + dedupe
  - tool wrapper block behavior
  - transport wrapper emits `turnIndex` sequence correctly
- Manual:
  - permission gate hook blocks `bash rm -rf ...`
  - headless run blocks without UI
  - TUI `ctx.ui.confirm/select/input` works without deadlocking rendering

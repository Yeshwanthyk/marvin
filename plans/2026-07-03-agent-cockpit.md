# External-agent cockpit: claude / codex / pi hooks into marvin

Self-contained plan for an AI agent. Runs AFTER the niri-lanes phases
(plans/2026-07-03-niri-lanes.md) because it builds on the lane store v2, ActivityIndex,
NotificationService, and overview mode. Same ground rules as that plan.

Goal: marvin is the cockpit for external agent CLIs — install/remove hooks into
Claude Code, Codex CLI, and pi; get notifications; track/rename their sessions; jump to
agents that need action.

## Transport: durable event spool (not OSC, not sockets-first)

Reference: supacode uses OSC 3008 escape codes because it owns the terminal emulator.
Marvin does not, so:

- Hooks append ONE JSON line per event to `~/.config/marvin/cockpit/events.jsonl`
  (O_APPEND single-line writes are atomic). Durable: events emitted while marvin is
  closed are ingested as unread on next start.
- Marvin tails the spool (fs.watch + persisted read offset). Optional fire-and-forget
  ping to `~/.config/marvin/cockpit.sock` when it exists (latency assist only).
- Marvin rotates the spool (truncate consumed prefix when >1MB and idle).

Normalized event (all producers emit this shape):

```ts
type ExternalAgentEvent = {
  v: 1
  cli: "claude" | "codex" | "pi"
  kind: "session_started" | "busy" | "needs_input" | "turn_completed"
      | "session_ended" | "title_changed"
  sessionId: string
  cwd: string
  transcriptPath?: string
  title?: string
  prompt?: string
  lastMessage?: string
  ok?: boolean            // turn_completed
  reason?: string         // needs_input
  tmuxPane?: string       // captured $TMUX_PANE at event time — the jump vector
  pid?: number
  at: string              // ISO timestamp
  raw?: unknown           // unrecognized payload fields, preserved
}
```

## One hook binary

`~/.config/marvin/integrations/marvin-cockpit-hook` — self-contained bun script installed
by marvin (source lives in repo: `apps/coding-agent/src/adapters/cli/cockpit/hook-template.ts`
compiled/copied on install). Behavior: read stdin JSON (defensive), merge argv hints
(`--cli claude --kind needs_input` style flags set per installed hook entry), capture env
(`TMUX_PANE`, `PWD`, pid), normalize, append to spool. Never blocks the calling CLI:
total budget <50ms, no network. Every installed command line ends with the ownership
marker `# marvin-cockpit-hook`.

## Per-CLI installers

Shared core `packages/runtime-effect/src/cockpit/installers/` (steal supacode's proven
patterns — see scratchpad research if available, otherwise these rules):
- Read-modify-write in one atomic operation (tmp+rename). Missing file → `{}`.
- Ownership by marker string, never array position. Install = prune all marked entries,
  append canonical set. Uninstall = prune marked entries only; leave user entries intact.
- Refuse to clobber/remove unowned single-file artifacts (pi extension).
- Status per CLI: `installed | outdated | not-installed` (outdated = marked entries
  present but differ from canonical).
- Partial-failure rollback: uninstall already-installed components in reverse.

### Claude Code → `~/.claude/settings.json` `hooks`

The user's file already has hooks from other tools (Muxy/Moshi/Orca/Herdr) — NEVER
replace the hooks object wholesale. Entries (all `type:"command"`, async where supported):
- `SessionStart` → session_started
- `UserPromptSubmit` → busy
- `PreToolUse` matcher `AskUserQuestion|ExitPlanMode` → needs_input
- `PermissionRequest` → needs_input (reason "permission")
- `Notification` → needs_input + forward stdin title/body
- `Stop` → turn_completed + forward stdin
- `SessionEnd` → session_ended
Payload fields to expect on stdin: `session_id`, `transcript_path`, `cwd`,
`hook_event_name`, tool fields. Parse defensively; keep unknown under `raw`.

### Codex CLI → `~/.codex/hooks.json`

`features.hooks` is already enabled on this machine; installer checks and runs
`codex features enable hooks` if missing. Entries:
- `SessionStart` → session_started; `UserPromptSubmit` → busy
- `PermissionRequest` → needs_input; `Stop` → turn_completed (+ stdin lastMessage)
Do NOT touch the `notify =` chain in `~/.codex/config.toml` (user has a notifier chain
there). Session titles readable from `~/.codex/session_index.jsonl` (`thread_name` by id);
do not write it — titles use the overlay (below).

### pi → `~/.pi/agent/extensions/marvin-cockpit/index.ts`

Native typed extension (best surface; write spool directly, no shell hop):
- `session_start`/`before_agent_start` → busy
- `agent_end` → turn_completed with last assistant text
- `session_shutdown` → session_ended
- `session_info_changed` → title_changed (pi is the only CLI with native title events)
Rename round-trip: marvin can rename pi sessions via RPC `{"type":"set_session_name"}`.
Refuse to clobber an existing unowned extension file; remove only marker-owned content.

## Ingestion into marvin

New host service `apps/coding-agent/src/runtime/cockpit-ingest.ts`:
1. Tail spool from persisted offset (`~/.config/marvin/cockpit/state.json` also holds
   per-CLI install status + hook version + title overlay map).
2. Map events → lane store + activity index:
   - `ensureProject(cwd)` (upsertProject patch).
   - `ensureExternalLane`: laneId `external:<cli>:<sessionId>`, provider
     `"claude-code" | "codex" | "pi"`, sessionPath = transcriptPath, title = event title
     → overlay → first-prompt fallback. AUDIT the UI first: anything assuming marvin
     providers/models on lanes must tolerate external providers (guard or projection).
   - busy → streaming; needs_input → queued + unread + warning notification;
     turn_completed → completed (+unread if unfocused, error level when ok=false);
     session_ended → cold; title_changed → renameSession patch (or overlay).
3. Debounce busy/idle flapping 400ms (Claude PostToolUse/PreToolUse alternation).
4. Liveness: events carry pid; a 2s-interval sweep marks lanes whose pid died as
   completed/stale (only for local pids).

## Cockpit UI

- External lanes appear in overview + lane strip with provider badge; needs_input cards
  sort first and flash.
- Focusing an external lane shows a read-only transcript preview (tail of the JSONL,
  parsed defensively per CLI) + action bar:
  - "Jump": if `tmuxPane` recorded → `tmux select-window -t <pane> && tmux switch-client`
    (verify pane exists first; toast on failure). Else copy resume command
    (`claude --resume <id>` / `codex resume` / `pi --session`).
  - Mark read; Rename (overlay for claude/codex, RPC for pi); Archive lane;
    "Uninstall hooks" shortcut.
- Header badge: count of external agents needing input.

## CLI + config

- `marvin cockpit install|uninstall|status [--agent claude|codex|pi]` in
  `apps/coding-agent/src/adapters/cli/cockpit.ts` (+ arg parsing in args.ts, help text).
- Config: `cockpit.enabled` (default false until installed), `cockpit.agents.{...}`,
  `cockpit.autoRepair` (default false — never silently edit other CLIs' configs).
- Disable = stop tailer + hide external lanes; hooks stay inert (spool unread) until
  uninstalled. Zero risk to the CLIs either way.

## Phases

- C1 (M): spool schema + hook template + ingest tailer wired to ActivityIndex/
  NotificationService + external lanes in lane store. Manual hook install for testing
  (document the JSON snippet). Tests: spool parse/offset/rotation; event→patch mapping;
  needs_input notification; provider-tolerance guards.
- C2 (M): installers (claude/codex/pi) + `marvin cockpit` CLI + status detection.
  Tests: idempotent install/uninstall against fixture config files (never touch real
  configs in tests); marker pruning preserves foreign entries; refuse-unowned; rollback.
- C3 (S): overview/header integration, tmux jump, rename overlay + pi RPC rename,
  transcript preview per CLI.
- C4 (S): flap debounce, pid liveness sweep, spool rotation, `cockpit.autoRepair` opt-in.

Each phase: implement → full check → interactive verification where applicable → commit.
For C2 verification, install against a COPY of the real configs first (diff the result),
then the real ones with user-visible summary of exactly what changed.

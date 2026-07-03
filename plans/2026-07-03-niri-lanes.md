# Niri-style lanes: remaining implementation phases

Self-contained plan for an AI agent. Each phase is one focused work unit: implement,
verify, commit, then move to the next. Do not batch phases.

## Ground rules (apply to every phase)

- Bun + TypeScript strict. No `any`, no non-null assertions (`!`), no `as Type` casts.
- Verify after every phase: `bun run typecheck && bun run test && bun run check`
  (run `bun run check` from the REPO ROOT — `apps/coding-agent` has no `check` script).
- Interactive verification for UI phases: launch on a FRESH tmux server socket
  (`tmux -L marvin-test new-session -d -s smoke -c <repo> -x 200 -y 50 'bun apps/coding-agent/src/index.ts'`)
  — the user's long-running tmux server cannot execute Bun (pre-existing environment
  quirk; do NOT kill their server). Exercise: Esc lane nav, project/session switching,
  composer typing, `/` autocomplete popup. Kill only the `-L marvin-test` server after.
- Commit per phase with a scoped message. The pre-commit hook runs the full check.
- After phases that change runtime behavior, rebuild the dist the user's PATH points at:
  `npm run build:packages && cd apps/coding-agent && bun run build`
  (PATH `marvin` is an nvm symlink to `apps/coding-agent/dist/cli.js`).
- Performance budget: hidden-actor work must stay O(1) per event (~0.0004ms measured;
  budget < 2ms/event at 8 concurrent streams). Benches: `bun scripts/bench/bench-content-items.ts`,
  `bun scripts/bench/bench-agent-events.ts`. Do not regress them.

## Architecture recap (already shipped)

- `packages/runtime-effect/src/workspace-lanes-v2.ts`: v2 lane store — `laneId` (UUID)
  primary key, `projectOrder` + `sessionOrderByProject` canonical layout, `focusByProject`
  remembered columns, patch reducer (`upsertProject/upsertSession/select/focus/
  reorderSession/moveSessionToProject/archiveSession/restoreSession/renameSession/
  touchSession`), v1 auto-migration, coalesced atomic writes. Host owns the single store
  instance (created in `apps/coding-agent/src/adapters/tui/app.tsx`).
- `apps/coding-agent/src/ui/app-shell/activity-index.ts`: laneId-keyed ActivityIndex +
  NotificationService; hidden responding→idle transitions enqueue attributed notifications.
- `packages/runtime-effect/src/project-bundle.ts`: ProjectRuntimeBundle — per-cwd shared
  services (config, transports, tool registry, custom commands, hook definitions) +
  `createActorServices(descriptor)` building per-actor SessionManager/PromptQueue/
  HookRunner/HookedTransport/tools/Agent/SessionOrchestrator. `RuntimeLayer` is now
  bundle+one-actor internally; `createRuntime` unchanged for CLI/headless/SDK.
- `packages/runtime-effect/src/session/jsonl-ownership.ts`: one warm actor per sessionPath.
- `apps/coding-agent/src/runtime/session-actor.ts` + `session-actor-registry.ts`:
  SessionActor keyed by laneId, status machine (cold/hydrating/warm/streaming/suspended/
  closing/closed/errored), lifecycle policy (maxWarm 8, maxStreaming 4, idleTtl 10min,
  never evict streaming), LRU suspension.
- `apps/coding-agent/src/runtime/actor-projection.ts`: actor-local projection store
  (createAppStore + createAgentEventHandler), injectable stream throttle (coarse when
  hidden), unread tracking, attach/detach on hydrate/suspend/close.
- LSP is fully removed. TuiApp was previously split into hooks:
  `useSessionLaneController`, `usePromptSubmission`, `useHookBridge`,
  `useScratchpadActions`, `useWorkspaceProjectDiscovery`, `hook-message-projection.ts`.

## Phase 5b — shell/view split (IN FLIGHT at time of writing; spec below if re-run needed)

Objective: split `apps/coding-agent/src/ui/app-shell/TuiApp.tsx` (~950 lines) into:
- `SessionView.tsx`: per-session UI — MainView (transcript + composer), agent-event
  context creation, session controller, editor bridge. Explicit props contract (store,
  runtime services, submission/steer callbacks, display accessors).
- `TuiApp.tsx` (shell): keymap install, modals, command palette, toasts/notifications,
  lane store consumption, theme; composes `<SessionView>`.

Rules: structural only — zero behavior change; still runs inside the existing cwd-keyed
`TuiRuntimeHost` slots; do NOT touch `adapters/tui/app.tsx`. Shape SessionView props so
Phase 5c can re-bind them to a SessionActor projection (leave a seam comment).
Tests: existing app tests stay green. Verify + commit.

## Phase 5c — FocusController + replace the slot host (L)

Objective: one mounted shell bound to the focused actor; cwd-keyed slots deleted.

Context files: `apps/coding-agent/src/adapters/tui/app.tsx` (TuiRuntimeHost, RuntimeSlot,
MAX_IDLE_RUNTIMES, activation records), `session-actor-registry.ts`, `actor-projection.ts`,
`SessionView.tsx` from 5b.

Tasks:
1. `apps/coding-agent/src/ui/app-shell/focus-controller.ts`:
   `focusedLaneId()/focusedActor()/focusLane(laneId, options)/focusCursor(cursor, options)`.
   `focusLane`: dispatch lane-store `select`, get-or-create actor from registry
   (`createActor` option), hydrate (acquires JSONL ownership, `continueSession`), bind
   projection to the shell, reassign `sendRef.current` exactly once per focus change.
   `FocusLaneOptions = { createActor?, startNewSession?, initialPrompt?, initialSessionTitle? }`.
2. Map old `TuiAppActivation` (seq/initialNavMode/startNewSession/initialVisibleSession/
   initialPrompt/initialScratchpadId) to FocusLaneOptions. CLI flags identical behavior:
   `--session` → find/create lane for path then focus; `--continue` → latest session lane;
   fresh prompt → cold lane in current project, focus, submit.
3. Rewrite `adapters/tui/app.tsx`: delete RuntimeSlot/eviction; host = lane store +
   registry + activity index + notifications + focus controller + ONE `<TuiApp>` shell.
   SessionView receives the focused actor's projection accessors.
4. Hidden-actor hook-UI policy: interactive hook prompts (showSelect/showInput/
   showConfirm/showEditor) from unfocused actors do NOT render; they enqueue a
   foreground-request notification (level warning) and resolve when the lane is focused
   (or reject on timeout if the hook has one). `notify()` from hidden actors routes to
   host notifications with lane attribution.
5. Activity index becomes laneId-native from actor status transitions (drop the
   sessionId/path resolution shim added in Phase 3 where possible).
6. Keep session-picker, headless, ACP adapters working (they use createRuntime).

Tests: hidden actor streams into its projection while another is focused (synthetic
events); sendRef routes only to the focused actor after focus changes; hidden interactive
hook prompt → foreground-request notification, not a modal; focusing a suspended actor
rehydrates from JSONL; existing tests green. Interactive tmux pass required. Commit.

## Phase 6 — lifecycle hardening (M)

Objective: make suspension/rehydration airtight now that the shell binds actors.

Tasks:
1. Idle-TTL sweep: a host timer suspends warm non-streaming actors past idleTtl (policy
   exists in the registry; ensure it actually runs and detaches projections to free
   transcript memory — keep metadata: title/unread/lastActivity).
2. Rehydrate flow: focusing a suspended/cold actor loads JSONL → `renderLoadedSessionView`
   projection → agent messages restored before accepting submit/steer.
3. Enforce JSONL ownership on the whole-file rewrite paths: `updateCompactionState` and
   `loadSession({migrate:true})` must require ownership + quiescence (finish TODOs left in
   Phase 4). Second lane focusing the same sessionPath reuses the owning actor.
4. maxStreaming backpressure UX: starting a prompt when 4 streams are live → typed
   rejection surfaced as a toast with "queue it" option (orchestrator queue).

Tests: over-maxWarm suspends LRU idle only; streaming never suspended; rehydrate restores
messages + ids deterministically; same-path second actor → conflict/reuse; compaction
blocked while streaming. Commit.

## Phase 7 — keymap: Shift+arrows + tmux-style prefix (M)

USER DECISION: Shift+arrows are the primary no-prefix navigation. tmux-like prefix table
for everything else. All configurable with sane defaults.

Defaults:
- `Shift+Left/Right` focus session prev/next (within project, wrapping).
- `Shift+Up/Down` focus project prev/next, landing on that project's remembered column
  (`focusByProject`), falling back nearest column → first session.
- Prefix key default `ctrl+b` (configurable `lanes.prefixKey`). Prefix table:
  arrows/`h j k l` = focus; `Shift+arrows`/`H J K L` = MOVE session (reorder within
  project / relocate across projects via lane-store patches, focus follows, laneId
  preserved); `o` = overview (Phase 8; no-op toast until then); `n` = new session next to
  focus; `$` = rename session; `1..9` = jump to project by index.
- Existing `Ctrl+[` sticky mode stays as fallback.
- Conflict rule: composer/editor gets Shift+arrows ONLY while a text selection is in
  progress; otherwise lane navigation wins. Verify against packages/open-tui editor key
  handling; make the winner configurable.
- Config: `lanes.prefixKey`, `lanes.keybindings.{sessionPrev,sessionNext,projectPrev,
  projectNext,moveSessionPrev,moveSessionNext,moveProjectPrev,moveProjectNext,overview,
  newSession,rename,jumpProject1..9}` — parsed in packages/runtime-effect config with
  defaults; unknown keys ignored; missing keys → defaults.
- Moving a STREAMING session across projects is refused with a warning toast (cwd
  rebinding requires idle actor).

Files: `TuiLaneKeymap.ts` (LaneAction union: focus/move/overview/newSession/rename/jump),
config.ts (parser+defaults), focus-controller wiring, prefix state machine (which-key
style hint line in footer while prefix pending).

Tests: config parsing defaults + overrides; prefix chord dispatch; move preserves laneId;
project jump 1..9; streaming-move refusal. Interactive tmux pass: Shift+arrows and prefix
table drive real switches. Commit.

## Header redesign (M) — USER REQUIREMENT

One coherent hierarchy on 1-2 lines:
`[state face] [model·thinking] [context meter] [spatial lane context] [queue] [activity badges]`
- Spatial lane context: `project  2/5` + adjacent session-title hints + `↑proj ↓proj`.
- Activity badges from ActivityIndex: running-elsewhere counts (`↑1● ↓2●`), unread dots
  on completed-while-hidden lanes.
- Prefix pending → which-key hint replaces the right side of the footer.
- Narrow widths: drop hints first, then adjacent names; never drop position/badges.
- All theme-driven; memoized by primitive deps (perf: header updates ride the same frame
  budget as the transcript).

Files: `components/Header.tsx`, `lane-header-state.ts` (extend derivation from v2 lanes +
activity index), Footer for which-key hints. Tests: lane-header-state derivations
(position, hints, badge counts, truncation ladder). Interactive tmux pass. Commit.

## Phase 8 — overview mode (M)

Metadata-only grid; NO transcripts mounted; data = lane store + activity index only.

- Files: `apps/coding-agent/src/ui/overview/OverviewMode.tsx`, `overview-model.ts`,
  `overview-keymap.ts`.
- Rows = projects in projectOrder; cards = sessions in sessionOrderByProject.
  Card: title, provider/model short label, status badge, unread, age. Bounded rows/cards
  for terminal size; cursor operates on full model.
- Keys: enter via `prefix o`; `h j k l`/arrows cursor; `m`+direction move (same lane-store
  patches as normal mode); `/` filter (does not mutate store); `Enter` focus (focusLane
  with createActor); `n` new cold lane at cursor; `Esc` exit.
- Empty-project insertion card at cursor column for `n`.

Tests: model rows/cards ordering; filter purity; Enter → focusLane; `n` creates cold lane
at cursor; `m` dispatches identical patches as normal-mode moves. Interactive tmux pass.
Commit.

## Phase 9 — cleanup + release (S)

- Remove dead compatibility: old activation types, per-app lane snapshot remnants,
  cwd-slot types, unused exports (`rg` sweep).
- Re-run benches; compare to `scripts/bench` baselines; no regressions.
- Full check + fresh-socket tmux smoke of everything above.
- Rebuild dist (`npm run build:packages && cd apps/coding-agent && bun run build`).
- Bump versions (`npm run version:minor` — breaking UI internals + config additions),
  `node scripts/sync-versions.js`, `bun install`, commit. User publishes to npm
  (order: ai → agent → base-tools → open-tui → runtime-effect → sdk → coding-agent).

## Known hazards

- Provider rate limits bound useful concurrent streams (default maxStreaming 4).
- Never let two actors write one session JSONL (ownership index is the guard).
- The user's real `~/.config/marvin/workspace-lanes.json` is already v2 (migrated;
  v1 backup exists). The dist on PATH must stay in sync with format changes.
- opentui scrollbox sticky-bottom depends on mounted heights — transcript stays
  chunk-windowed (75 rows + upward expansion), not spacer-virtualized.

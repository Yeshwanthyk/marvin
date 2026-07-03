# Niri-style lanes: remaining implementation phases

Self-contained plan for an AI agent. Each phase is one focused work unit: implement,
verify, commit, then move to the next. Do not batch phases.

## Status ledger (update as phases land)

- DONE (committed): Phase 1 (lane store v2), Phase 2 (host single-writer store),
  Phase 3 (activity index + notifications), Phase 4 (bundle/actor split + JSONL
  ownership), Phase 5a (per-actor projections), LSP removal.
- NOT STARTED: Phase 5b (two agent attempts stalled in analysis with zero edits —
  follow the execution protocol in its section), 5c, 6, 7, header redesign, 8, 9.
- After this plan: plans/2026-07-03-agent-cockpit.md (external-agent cockpit).

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

## Phase 5b — shell/view split (NOT STARTED; two codex attempts stalled — read the protocol)

EXECUTION PROTOCOL (both prior attempts died in analysis, zero edits): read TuiApp.tsx
ONCE top to bottom, then start editing immediately. Work the steps below in order; run
`bun run typecheck` after EVERY step. If 15 minutes pass without a file edit, you are
stuck — stop and do the smallest possible next move instead of re-planning.

Objective: split `apps/coding-agent/src/ui/app-shell/TuiApp.tsx` (983 lines) into a shell
(chrome/commands/lanes) and `SessionView.tsx` (agent-session UI). Structural ONLY — zero
behavior change; still runs inside the cwd-keyed TuiRuntimeHost; do NOT touch
`adapters/tui/app.tsx`.

Current internal map of TuiApp.tsx (line numbers as of commit with plans added):
- 141-190: runtime destructure (`agent, sessionManager, hookRunner, toolByName,
  customCommands, config, codexTransport, getApiKey, sendRef, cycleModels,
  validationIssues`), `toolMetaByName` build, `createAppStore`, `useModals`,
  `useWorkspaceSwitch`, `createScratchpadStore`, `useWorkspaceProjectDiscovery`,
  `isAppActive`, `showToastRef`, `lastError` signal, `submitPromptImpl` indirection.
- 193-234: `useSessionLaneController` (lane controller; exposes sessionController,
  navMode, laneHeaderState, visibleSession helpers, setActive* setters,
  syncCurrentSessionLane, applyVisibleSession, ensureSession, fresh-session fns).
- 236-256: `usePromptSubmission` (promptQueue, submitPrompt, steerHelper, followUpHelper,
  sendUserMessageHelper, enqueueWhileResponding); `submitPromptImpl = submitPrompt`.
- 258-291: scratchpad trigger, initial-prompt onMount, composerDraft + fresh-session
  wrappers, cycleIndex init.
- 293-328: `streamingMessageIdRef`, retryConfig/retryablePattern/retryState,
  `eventCtx: EventHandlerContext` (setters bound to setActiveMessages/setActiveToolBlocks/
  store.*), `useAgentEvents({ agent, context: eventCtx })`.
- 330-340: handleThemeChange; ref objects: exitHandlerRef, editorOpenRef, editFileRef,
  setEditorTextRef, getEditorTextRef, clearEditorRef.
- 341-359: `useScratchpadActions` (uses editor refs + toasts + submitPrompt).
- 360-373: composer-draft restore effect; `handleBeforeExit` (session.shutdown hook).
- 375-424: `activateVisibleSessionForSubmit`, `revealLiveSession` (lane/session glue used
  by prompt submission).
- 425-455: activation effect (consumes `activation()` records: seq/initialNavMode/
  startNewSession/initialVisibleSession/initialPrompt/initialScratchpadId).
- 455-472: activity reporting effect (`onActivityChange` with lane lookup).
- 473-657: `cmdCtx: CommandContext` (slash-command surface: modals, palette, scratchpads,
  session tree, model/thinking, workspace switch...), `handleSubmit` (slash routing via
  handleSlashInput + shell-command injection + submitPrompt), `handleAbort` (agent.abort,
  retryState reset, queue drain-to-script, store resets).
- 631-656 (inside that range): `useHookBridge` + `sendRef.current = (text) => void
  handleSubmit(text)`.
- 658-701: `cycleModel`, `cycleThinking` (agent.setModel/setThinkingLevel + store display).
- 702-920: lane navigation + palette + project pickers + rename/archive/restore
  (switchToLane, navigateLane, laneSearchOption, projectSearchOption,
  pickConfiguredProject, switchToProject, startSessionInProject, renameCurrentSession,
  openCommandPalette, archiveCurrentSession, restoreArchivedSession).
- 921-983: JSX: `<Show when={isAppActive()}>` → TuiLaneKeymapRoot → TuiLaneKeyBindings
  (navigate/jump/archive/restore/detach) → ThemeProvider → `<MainView …35 props…/>` →
  ModalContainer.

Prescribed boundary (entanglements resolved):
- SessionView.tsx OWNS: eventCtx + useAgentEvents + streamingMessageIdRef + retry
  config/state (293-328); handleAbort, cycleModel, cycleThinking (658-701); the
  `<MainView>` JSX block (939-976). Props in: `store`, `agent`, `sessionManager`,
  `customCommands`, `config`, `cycleModels`, `validationIssues`, `toolMetaByName`,
  lane display accessors (`laneHeaderState`, `visibleCwd`), active-session setters from
  the lane controller (`setActiveMessages/setActiveToolBlocks/setActiveContextTokens`,
  `activeDisplayContextWindow`), `promptQueue`, `onSubmit` (shell's handleSubmit),
  host notification accessors, and the SHELL-OWNED ref objects (editor refs,
  showToastRef, exitHandlerRef) passed through to MainView unchanged.
- Shell (TuiApp.tsx) KEEPS everything else: lane controller, prompt submission, cmdCtx +
  handleSubmit (slash routing is command/chrome logic; MainView receives it via
  SessionView's `onSubmit` prop), hook bridge + sendRef wiring, scratchpads, activation
  and activity effects, palette/lane functions, keymap JSX, ThemeProvider, ModalContainer.
- KEY RULE: ref objects (editor/toast/exit) are CREATED in the shell and passed through
  SessionView → MainView so shell consumers (scratchpads, hook bridge, cmdCtx) keep
  working unchanged.
- Add one comment on SessionViewProps: "Phase 5c seam — these accessors will be rebound
  to a SessionActor projection (apps/coding-agent/src/runtime/actor-projection.ts)".

Steps (typecheck after each):
1. Create `SessionView.tsx` with the props interface; move blocks 293-328, 658-701, and
   the MainView JSX into it verbatim (adjust imports); leave a `<SessionView {...}/>`
   call in TuiApp where MainView was.
2. Re-thread the moved symbols' inputs as props (they are all already in scope in the
   shell); delete the moved code from TuiApp.
3. Run full gate: `bun run typecheck && bun test apps/coding-agent/tests && bun run check`.
4. Interactive tmux smoke (fresh socket): lane nav, composer typing, `/model`
   autocomplete, Esc/arrows, abort key. Commit: `refactor: split TuiApp into shell and
   SessionView`.

Done when: TuiApp ≈ 700 lines of chrome; SessionView ≈ 250-300 lines; zero test changes
needed (or mechanical import updates only).

## Phase 5c — FocusController + replace the slot host (L)

Objective: one mounted shell bound to the focused actor; cwd-keyed slots deleted.
Same execution protocol as 5b: read once, edit immediately, typecheck per step.

Current host map (`apps/coding-agent/src/adapters/tui/app.tsx`, ~280 lines):
- line 33 `activeCwd: string` in `RuntimeHostState`; line 37 `interface RuntimeSlot`
  { cwd, runtime, activation, isResponding, lastViewedAt, lastActivityAt }.
- line 46 `MAX_IDLE_RUNTIMES = 4` + 10-min TTL; eviction at ~170-196 (skips hidden
  responding slots).
- line 129 `getOrCreateSlot(cwd)` with `pendingSlots` dedupe; `createRuntime(...)` per cwd.
- ~225-245 workspace-switch request handler: getOrCreateSlot → build `TuiAppActivation`
  { seq: nextActivationSeq++, initialSession/initialVisibleSession/initialPrompt/
  startNewSession/initialNavMode/initialSessionTitle/initialScratchpadId } → set
  activeCwd + slot activation.
- line 263 `<Index each={state().slots}>` renders one `<TuiApp>` per slot with
  active={() => state().activeCwd === slot().cwd}; host also owns the Phase 3 activity
  wiring (`applyTuiActivityTransition` from onActivityChange) and the lane store instance.

Steps:
1. `apps/coding-agent/src/ui/app-shell/focus-controller.ts`:
   `FocusLaneOptions = { createActor?: boolean; startNewSession?: boolean;
   initialPrompt?: string; initialSessionTitle?: string; initialScratchpadId?: string;
   initialNavMode?: LaneNavMode }`.
   `focusLane(laneId, opts)`: lane-store `select` patch → registry get-or-create
   (ProjectRuntimeBundle for the lane's cwd) → `actor.hydrate("focus")` (JSONL ownership +
   continueSession + projection ready) → set focusedLaneId signal → the shell reacts.
   `focusCursor(cursor)`: laneId from cursor, then focusLane.
2. Rewrite the host component: delete RuntimeSlot/pendingSlots/MAX_IDLE_RUNTIMES/eviction
   and the `<Index>`; keep lane store + activity index + notifications; add
   SessionActorRegistry + FocusController; render ONE `<TuiApp>` (shell) unconditionally
   (drop the `active` prop path and the `<Show when={isAppActive()}>` in TuiApp).
   Workspace-switch requests → focusLane with mapped options (replaces activation seq
   records entirely; delete TuiAppActivation).
3. Shell/SessionView rebind: SessionView props switch from the app-local store accessors
   to `focusedActor().projection` accessors (the 5b seam). The lane controller's
   setActive* setters move behind the projection (the actor's event handler already
   writes them — Phase 5a). The shell's `useAgentEvents` direct subscription is DELETED
   (actors subscribe themselves).
4. `sendRef.current` reassigned inside a `createEffect` on focusedLaneId — routes to the
   focused actor's submit; hook bridge stays in the shell.
5. Hidden-actor hook-UI policy: actor uiPolicy (from Phase 4 createActorServices) for
   unfocused actors: `notify()` → host NotificationService with lane attribution;
   showSelect/showInput/showConfirm/showEditor → enqueue foreground-request notification
   (level warning) and block until focused or hook timeout.
6. Activity index: patch from actor status transitions keyed by laneId directly; delete
   the `{projectId, sessionId, sessionPath}` resolution shim in activity-index.ts.
7. CLI startup mapping (index.ts/adapters/tui entry): `--session <id|path>` → ensure lane
   for that sessionPath (upsertSession if missing) → focusLane; `--continue` → most
   recent lane in cwd project; bare prompt → new cold lane + focusLane + submit;
   scratchpad start → initialPrompt/initialScratchpadId options.
8. Keep session-picker, headless, and ACP adapters compiling (they use createRuntime,
   untouched).

Gate: full check + these tests: hidden actor streams into its projection while another
is focused (synthetic events on two actors); sendRef targets focused actor after two
focus switches; hidden interactive hook prompt → notification not modal; suspended actor
rehydrates on focus with deterministic ids; palette/lane switching still passes existing
tests. Interactive tmux pass: switch projects/sessions rapidly while one session streams
(use a cheap model or mock), confirm background stream completes + notification appears,
composer draft survives switches. Commit.

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

# Plan: Complete Niri Lanes And Cockpit

Goal: `.codex/complete-niri-lanes-cockpit/goal.md`

## Phase 5b: TuiApp Shell/SessionView Split
Status: complete

Implementation
- [x] Create `SessionView.tsx`.
- [x] Move event handling, abort, model/thinking cycling, and `MainView` JSX.
- [x] Preserve shell-owned refs and command/chrome/lane logic.
- [x] Fix review blocker by keeping `SessionView` mounted while active-gating only `MainView`.

Verification
- [x] `bun run typecheck` passed.
- [x] `bun test apps/coding-agent/tests` passed.
- [x] `bun run check` passed.
- [x] `git diff --check` passed.
- [x] isolated tmux smoke passed.
- [x] Review gate completed; blockers fixed.

Exit criteria
- [x] Committed as `a26a791 refactor: split TuiApp into shell and SessionView`.

## Phase 5c: FocusController And Single Shell Host
Status: complete

Implementation
- [x] Add `apps/coding-agent/src/ui/app-shell/focus-controller.ts`.
- [x] Delete cwd-slot host in `apps/coding-agent/src/adapters/tui/app.tsx`.
- [x] Render one `TuiApp` shell bound to focused actor.
- [x] Replace activation records with focus-driven workspace switching.
- [x] Rebind `SessionView` to focused actor projection.
- [x] Route `sendRef.current`, shell `!`, and slash command cwd through focused actor/runtime.
- [x] Convert hidden hook UI prompts to notifications and downgrade warm hidden actors.
- [x] Patch activity index from actor projection transitions keyed by laneId.
- [x] Map CLI startup flags to lanes/focus.
- [x] Keep session-picker, headless, and ACP adapters compiling.

Verification
- [x] `bun run typecheck` passed.
- [x] Tests: focused projection/facade, same-project fresh scratchpad path, shell cwd, hidden hook UI downgrade, hidden hook prompt policy, suspended rehydrate.
- [x] Existing palette/lane switching tests pass.
- [x] `bun run check` passed.
- [x] `git diff --check` passed.
- [x] isolated tmux smoke passed for render, lane key handling, composer typing, and `/model` autocomplete.
- [x] Two review gates completed; blockers fixed.

Exit criteria
- [x] Committed as `9fb0eb4 refactor: bind TUI shell to focused actor`.

## Phase 6: Lifecycle Hardening
Status: complete

Implementation
- [x] Idle-TTL sweep suspends warm non-streaming actors and detaches projections.
- [x] Rehydrate suspended/cold actor from JSONL into projection/agent state before submit/steer.
- [x] Enforce JSONL ownership conflicts on migration rewrite paths.
- [x] Reuse/conflict behavior for same sessionPath remains guarded by ownership.
- [x] Add maxStreaming backpressure UX with typed registry admission and toast.

Verification
- [x] Tests: over-maxWarm suspends LRU idle only.
- [x] Tests: idle TTL sweep suspends expired warm actors.
- [x] Tests: streaming is never suspended and maxStreaming admission rejects new streams.
- [x] Tests: rehydrate restores JSONL messages into agent/projection.
- [x] Tests: same-path second actor conflicts via ownership.
- [x] Existing compaction responding guard remains covered in slash command tests.
- [x] `bun run check` passed.
- [x] `git diff --check` passed.
- [x] Review gate attempted; reviewer timed out and was closed, local blocker pass found no blockers.

Exit criteria
- [x] Committed as `c652ccb fix: harden session actor lifecycle`.

## Phase 7: Keymap Shift-Arrows And Prefix Table
Status: complete

Implementation
- [x] Add configurable Shift+arrow focus defaults.
- [x] Add Ctrl+B prefix table.
- [x] Add move/focus/overview/new/rename/jump actions.
- [x] Add config parser/defaults.
- [x] Add header which-key style hint while prefix pending.
- [x] Refuse moving streaming sessions across projects with warning toast.
- [x] Preserve composer Shift+arrow selection ownership while selection is active.
- [x] Retire non-streaming moved actors before rehydrating them under a destination project descriptor.

Verification
- [x] Tests: config defaults and overrides.
- [x] Tests: prefix chord dispatch.
- [x] Tests: move preserves laneId.
- [x] Tests: project jump 1..9.
- [x] Tests: streaming-move refusal.
- [x] Tests: composer Shift+arrow ownership and legacy plain-arrow non-global compatibility.
- [x] `bun run check` passes.
- [x] `git diff --check` passes.
- [x] isolated tmux smoke: Shift+arrows and prefix table drive real switches; prefix hint renders.
- [x] Review gate completed; two blockers fixed.

Exit criteria
- [x] Committed as `379aa20 feat: add lane prefix keymap`.

## Phase H: Header Redesign
Status: complete

Implementation
- [x] Redesign header for spatial lane context.
- [x] Add activity badges.
- [x] Add which-key hints.
- [x] Add width degradation behavior.

Verification
- [x] Targeted lane-header derivation tests cover position, adjacent hints, and activity badges.
- [x] `bun run check` passes.
- [x] `git diff --check` passes.
- [x] isolated tmux smoke across narrow and wide widths passed.
- [x] Review gate completed locally; narrow-width blocker fixed.

Exit criteria
- [x] Committed as `2d2ed9d feat: redesign lane header context`.

## Phase 8: Overview Mode
Status: complete

Implementation
- [x] Add overview metadata grid.
- [x] Bind prefix `o` to overview.

Verification
- [x] Tests for overview model/actions.
- [x] `bun run check` passes.
- [x] `git diff --check` passes.
- [x] isolated tmux smoke for overview open/close passed.
- [x] Review gate completed locally; no blockers found.

Exit criteria
- [x] Committed as `183e2eb feat: add lane overview mode`.

## Phase 9: Cleanup, Bench, Dist, Version
Status: complete

Implementation
- [x] Remove dead compatibility code.
- [x] Run and compare benches.
- [x] Rebuild packages and coding-agent dist.
- [x] Version bump for npm publish readiness.

Verification
- [x] `bun scripts/bench/bench-content-items.ts` passed: 5k avg 0.6077ms, streaming avg 0.0147ms.
- [x] `bun scripts/bench/bench-agent-events.ts` passed: 300 updates avg 0.0004ms.
- [x] `npm run build:packages && cd apps/coding-agent && bun run build` passed.
- [x] `cd apps/coding-agent && bun run build` passed after version bump.
- [x] `bun run check` passes.
- [x] `git diff --check` passes.
- [x] Final isolated tmux smoke passes.
- [x] Review gate completed locally; no blockers found.

Exit criteria
- [x] Committed as `2206193 chore: prepare lanes release`.

## Phase C1: Cockpit Spool, Hook Template, Ingest
Status: complete

Implementation
- [x] Add normalized external-agent event schema.
- [x] Add hook template source.
- [x] Add durable spool tailer with offset.
- [x] Map events to lane store, ActivityIndex, notifications.
- [x] Add provider tolerance guards for external lanes.
- [x] Document manual hook JSON snippet for testing.

Verification
- [x] Tests: spool parse/offset/rotation basics.
- [x] Tests: event-to-patch mapping.
- [x] Tests: needs_input notification.
- [x] Tests: provider-tolerance guards.
- [x] `bun run check` passes.
- [x] isolated tmux smoke: manual `needs_input` JSONL event appears as queued external lane + warning notification.
- [x] Review gate completed locally; no blockers found.

Exit criteria
- [x] Committed as `1281bef feat: ingest external agent cockpit events`.

## Phase C2: Cockpit Installers And CLI
Status: complete

Implementation
- [x] Add Claude/Codex/pi installers with marker ownership.
- [x] Add `marvin cockpit install|uninstall|status`.
- [x] Add status/outdated detection and rollback.
- [x] Add config parsing for cockpit settings.

Verification
- [x] Fixture tests: idempotent install/uninstall.
- [x] Fixture tests: preserve foreign entries.
- [x] Fixture tests: refuse unowned pi extension.
- [x] Fixture tests: rollback on partial failure.
- [x] Verify against copies of real configs and diff the result.
- [x] Real config install not run; temp-copy smoke only.
- [x] `bun run check` passes.
- [x] `git diff --check` passes.
- [x] `npm run build:packages` passes.
- [x] Review gate completed locally; idempotency, shell quoting, and exact rollback blockers fixed.

Exit criteria
- [x] Committed as `198cf3e feat: add cockpit installers`.

## Phase C3: Cockpit Overview/Header, Jump, Rename, Preview
Status: complete

Implementation
- [x] Integrate external lanes into overview/header.
- [x] Add tmux jump-to-agent.
- [x] Add rename overlay and pi RPC rename.
- [x] Add read-only transcript preview per CLI.

Verification
- [x] Tests for jump command construction/failure.
- [x] Tests for rename overlay and pi RPC payload.
- [x] Tests for transcript preview parsing.
- [x] Tests for overview/header external labels.
- [x] `bun run check` passes.
- [x] `git diff --check` passes.
- [x] isolated tmux feasibility checked with `tmux -V`.
- [x] Review gate completed locally; overlay persistence test gap fixed.

Exit criteria
- [x] Committed as `a26ab4d feat: add cockpit lane actions`.

## Phase C4: Cockpit Polish
Status: complete

Implementation
- [x] Add flap debounce.
- [x] Add pid liveness sweep.
- [x] Add spool rotation.
- [x] Add `cockpit.autoRepair` opt-in behavior.

Verification
- [x] Tests: debounce.
- [x] Tests: pid liveness.
- [x] Tests: spool rotation.
- [x] Tests: autoRepair disabled by default.
- [x] `bun run check` passes.
- [x] `git diff --check` passes.
- [x] Review gate completed locally; no blockers found.

Exit criteria
- [x] Committed as `1497100 fix: harden cockpit lifecycle`.

## Final Completion
Status: complete

Verification
- [x] Final `bun run check` passed.
- [x] Final `npm run build:packages && cd apps/coding-agent && bun run build` passed.
- [x] Final `git diff --check` passed.
- [x] Final isolated cockpit smoke passed: spool ingest, external overview/header labeling, tmux jump command construction, transcript preview.
- [x] Final `git status --short` reviewed: only unrelated untracked `.pi/`.
- [x] Goal marked complete only after all phase exit criteria pass.

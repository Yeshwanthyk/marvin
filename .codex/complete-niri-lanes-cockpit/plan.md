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
Status: in progress

Implementation
- [ ] Add `apps/coding-agent/src/ui/app-shell/focus-controller.ts`.
- [ ] Delete cwd-slot host in `apps/coding-agent/src/adapters/tui/app.tsx`.
- [ ] Render one `TuiApp` shell bound to focused actor.
- [ ] Replace activation records with focus options.
- [ ] Rebind `SessionView` to focused actor projection.
- [ ] Route `sendRef.current` to focused actor.
- [ ] Convert hidden hook UI prompts to notifications/foreground requests.
- [ ] Patch activity index from actor status transitions keyed by laneId.
- [ ] Map CLI startup flags to lanes/focus.
- [ ] Keep session-picker, headless, and ACP adapters compiling.

Verification
- [ ] `bun run typecheck` after major edits.
- [ ] Tests: hidden actor streams into projection while another is focused.
- [ ] Tests: `sendRef` targets focused actor after focus switches.
- [ ] Tests: hidden interactive hook prompt creates notification, not modal.
- [ ] Tests: suspended actor rehydrates on focus with deterministic ids.
- [ ] Existing palette/lane switching tests pass.
- [ ] `bun run check` passes.
- [ ] isolated tmux smoke: rapid project/session switching while one session streams; background completion notification; composer draft survives switches.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Phase 6: Lifecycle Hardening
Status: pending

Implementation
- [ ] Idle-TTL sweep suspends warm non-streaming actors and detaches projections.
- [ ] Rehydrate suspended/cold actor from JSONL into projection before submit/steer.
- [ ] Enforce JSONL ownership/quiescence for compaction and migration rewrite paths.
- [ ] Reuse owning actor for same sessionPath.
- [ ] Add maxStreaming backpressure UX with typed rejection/toast and queue option.

Verification
- [ ] Tests: over-maxWarm suspends LRU idle only.
- [ ] Tests: streaming is never suspended.
- [ ] Tests: rehydrate restores messages and ids deterministically.
- [ ] Tests: same-path second actor conflicts/reuses.
- [ ] Tests: compaction blocked while streaming.
- [ ] `bun run check` passes.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Phase 7: Keymap Shift-Arrows And Prefix Table
Status: pending

Implementation
- [ ] Add configurable Shift+arrow focus defaults.
- [ ] Add Ctrl+B prefix table.
- [ ] Add move/focus/overview/new/rename/jump actions.
- [ ] Add config parser/defaults.
- [ ] Add footer/which-key style hint while prefix pending.
- [ ] Refuse moving streaming sessions across projects with warning toast.

Verification
- [ ] Tests: config defaults and overrides.
- [ ] Tests: prefix chord dispatch.
- [ ] Tests: move preserves laneId.
- [ ] Tests: project jump 1..9.
- [ ] Tests: streaming-move refusal.
- [ ] `bun run check` passes.
- [ ] isolated tmux smoke: Shift+arrows and prefix table drive real switches.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Phase H: Header Redesign
Status: pending

Implementation
- [ ] Redesign header for spatial lane context.
- [ ] Add activity badges.
- [ ] Add which-key hints.
- [ ] Add width degradation behavior.

Verification
- [ ] Targeted rendering tests or snapshots where available.
- [ ] `bun run check` passes.
- [ ] isolated tmux smoke across narrow and wide widths.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Phase 8: Overview Mode
Status: pending

Implementation
- [ ] Add overview metadata grid.
- [ ] Bind prefix `o` to overview.

Verification
- [ ] Tests for overview model/actions.
- [ ] `bun run check` passes.
- [ ] isolated tmux smoke for overview open/navigate/close.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Phase 9: Cleanup, Bench, Dist, Version
Status: pending

Implementation
- [ ] Remove dead compatibility code.
- [ ] Run and compare benches.
- [ ] Rebuild packages and coding-agent dist.
- [ ] Version bump for npm publish readiness.

Verification
- [ ] `bun scripts/bench/bench-content-items.ts`.
- [ ] `bun scripts/bench/bench-agent-events.ts`.
- [ ] `npm run build:packages && cd apps/coding-agent && bun run build`.
- [ ] `bun run check` passes.
- [ ] Final isolated tmux smoke passes.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Phase C1: Cockpit Spool, Hook Template, Ingest
Status: pending

Implementation
- [ ] Add normalized external-agent event schema.
- [ ] Add hook template source.
- [ ] Add durable spool tailer with offset.
- [ ] Map events to lane store, ActivityIndex, notifications.
- [ ] Add provider tolerance guards for external lanes.
- [ ] Document manual hook JSON snippet for testing.

Verification
- [ ] Tests: spool parse/offset/rotation basics.
- [ ] Tests: event-to-patch mapping.
- [ ] Tests: needs_input notification.
- [ ] Tests: provider-tolerance guards.
- [ ] `bun run check` passes.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Phase C2: Cockpit Installers And CLI
Status: pending

Implementation
- [ ] Add Claude/Codex/pi installers with marker ownership.
- [ ] Add `marvin cockpit install|uninstall|status`.
- [ ] Add status/outdated detection and rollback.
- [ ] Add config parsing for cockpit settings.

Verification
- [ ] Fixture tests: idempotent install/uninstall.
- [ ] Fixture tests: preserve foreign entries.
- [ ] Fixture tests: refuse unowned pi extension.
- [ ] Fixture tests: rollback on partial failure.
- [ ] Verify against copies of real configs and diff the result.
- [ ] Ask for approval before real config install.
- [ ] `bun run check` passes.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Phase C3: Cockpit Overview/Header, Jump, Rename, Preview
Status: pending

Implementation
- [ ] Integrate external lanes into overview/header.
- [ ] Add tmux jump-to-agent.
- [ ] Add rename overlay and pi RPC rename.
- [ ] Add read-only transcript preview per CLI.

Verification
- [ ] Tests for jump command construction/failure.
- [ ] Tests for rename overlay and pi RPC payload.
- [ ] Tests for transcript preview parsing.
- [ ] `bun run check` passes.
- [ ] isolated tmux smoke where feasible.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Phase C4: Cockpit Polish
Status: pending

Implementation
- [ ] Add flap debounce.
- [ ] Add pid liveness sweep.
- [ ] Add spool rotation.
- [ ] Add `cockpit.autoRepair` opt-in behavior.

Verification
- [ ] Tests: debounce.
- [ ] Tests: pid liveness.
- [ ] Tests: spool rotation.
- [ ] Tests: autoRepair disabled by default.
- [ ] `bun run check` passes.
- [ ] Review gate completed and blockers fixed.

Exit criteria
- [ ] Phase commit created.

## Final Completion
Status: pending

Verification
- [ ] Final `bun run check`.
- [ ] Final `git diff --check`.
- [ ] Final isolated tmux smoke.
- [ ] Final `git status --short` reviewed.
- [ ] Goal marked complete only after all phase exit criteria pass.

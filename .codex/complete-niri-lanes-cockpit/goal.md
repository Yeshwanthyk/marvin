# Goal: Complete Niri Lanes And Cockpit

## Outcome
Finish the remaining work in `plans/2026-07-03-niri-lanes.md`, then finish `plans/2026-07-03-agent-cockpit.md`, with each phase implemented, verified, reviewed, and committed in logical phase commits.

## Baseline
- Branch: `kyendamuri/core-cleanup`.
- Phase 5b is complete and committed as `a26a791 refactor: split TuiApp into shell and SessionView`.
- Remaining niri-lanes phases: 5c, 6, 7, header redesign, 8, 9.
- Remaining cockpit phases after niri-lanes: C1, C2, C3, C4.
- Current dirty state: untracked `.pi/` task artifacts only; treat them as out of scope unless the user explicitly says otherwise.

## Constraints
- Follow `AGENTS.md` and both plan files.
- Preserve unrelated dirty work.
- Do not stage or commit `.pi/` artifacts unless explicitly approved.
- Commit per phase unless a phase must be split for correctness.
- Use Conventional Commit messages.
- Confirm before destructive operations, public pushes, npm publish, real external config installation, or other irreversible/shared actions.
- For Effect code, consult `effect-solutions` before writing new Effect patterns.

## Non-Goals
- Do not push or open a PR unless asked.
- Do not publish npm packages unless separately approved.
- Do not install real cockpit hooks into Claude/Codex/pi without explicit user approval at the C2 gate.

## Primary Verifier
For each completed phase, run the phase-specified tests plus:
- `bun run typecheck`
- relevant targeted `bun test ...`
- `bun run check`
- `git diff --check`
- isolated TUI smoke when UI/runtime behavior changes:
  `tmux -L marvin-test new-session -d -s smoke -c /Users/yesh/Documents/personal/marvin -x 200 -y 50 'bun apps/coding-agent/src/index.ts'`

## Supporting Verifiers
- Phase-specific synthetic tests from the plan.
- App-level tmux smoke for lane navigation, composer typing, slash autocomplete, abort, and switching flows.
- Benchmarks in Phase 9:
  `bun scripts/bench/bench-content-items.ts`
  `bun scripts/bench/bench-agent-events.ts`
- Build gate after runtime behavior changes and Phase 9:
  `npm run build:packages && cd apps/coding-agent && bun run build`

## Iteration Loop
1. Re-read this file and `plan.md` before each resumed work session.
2. Keep exactly one phase in progress.
3. Inspect the current code and tests for the phase.
4. Patch narrowly using existing repo patterns.
5. Run targeted verification, then full gate.
6. Run a blocker-first review gate; fix in-scope blockers.
7. Rerun affected verification.
8. Commit the phase with only relevant files staged.
9. Update `plan.md` with evidence and the next phase.

## Anti-Cheating Rules
- Do not weaken, delete, or narrow tests to make a phase pass.
- Do not replace real UI/runtime verification with static inspection when the plan calls for interactive smoke.
- Do not fake cockpit ingestion or installer safety with production config writes in tests; use fixtures/copies.
- Do not hide failing checks in commit hooks or skip hooks.

## Blocker Standard
Only mark blocked when an external condition prevents meaningful progress after repeated attempts, such as missing credentials/capabilities required by the declared verifier or a user approval gate for destructive/shared actions. Difficulty, large scope, or failing tests are not blockers.

## Completion Proof
Goal is complete only when:
- Every phase in `plan.md` is marked complete.
- All required commits exist.
- Final `bun run check` passes.
- Final `git diff --check` passes.
- Final tmux smoke passes.
- Phase 9 build/dist rebuild and version bump are complete.
- Cockpit C2 real-install gate is either approved and completed, or explicitly left as documented/manual approval if the user declines.
- `git status --short` contains only intentional out-of-scope/user artifacts.

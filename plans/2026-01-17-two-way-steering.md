# Two-Way Steering & Follow-Up Parity Plan

## Plan Metadata
- Created: 2026-01-17
- Owner: yesh
- Status: draft
- Related work: parity with `reference/pi-mono` steering queues
- Objective: bring Marvin’s runtime/UI/hook stack to feature parity with pi’s steer/follow-up delivery so `/steer <text>` interrupts after the current tool turn and `/followup` waits until idle, all while remaining extensible to custom hooks and adapters.

## Context Snapshot
- **Pi model**: `packages/agent` maintains separate steering/follow-up queues plus delivery modes, and `agent-loop` polls `getSteeringMessages` after each tool execution (skipping remaining calls) before checking follow-ups. Higher-level APIs (`AgentSession`, hook commands) expose `steer()`/`followUp()`/`sendUserMessage(..., { deliverAs })`.
- **Marvin today**: single `messageQueue` + `queueMode` (packages/agent + packages/ai) that only injects queued user text before the *next* assistant response; no mid-tool interrupts, no follow-up semantics, and no API surface for hooks/commands beyond `marvin.send()` -> `agent.queueMessage()`.
- **User request**: provide a `/steer <text>` command (ideally implementable as a custom hook) that injects instructions immediately after the current tool turn without extra keymaps. Requires core support before hooks can deliver.

## Success Criteria
1. Core agent loop supports distinct steering & follow-up queues with delivery modes identical to pi’s behavior (interrupt after tool, skip remaining calls, follow-ups processed only when idle).
2. Session/runtime APIs expose `steer(text)` / `followUp(text)` / `sendUserMessage(content, { deliverAs })` so adapters, hooks, and custom slash commands can target either queue without touching UI internals.
3. TUI gains built-in `/steer` (and `/followup`) commands that work while streaming, display pending queue state, and remain compatible with `promptQueue` restore behavior.
4. Hooks + custom config directory (e.g., `~/.config/marvin/hooks/steer.ts`) can register their own `/steer` while leveraging the same APIs; docs + examples updated.
5. Regression suite (agent loop, transports, session manager, TUI command flow) proves parity with pi; existing queue behaviors remain backward compatible (e.g., `queueMessage()` → follow-up until callers migrate).

## Out of Scope
- Persisted settings/UI for follow-up mode (default to `one-at-a-time` like pi; UI toggle can land later).
- Non-TUI adapters beyond ensuring CLI/headless wiring compiles (no new keybindings for ACP/CLI now).
- Major restructuring of queue restore UX (only adapt to new data).

## Workstreams & Tasks

### 1. Agent Core & Loop Parity (packages/agent + packages/ai)
- [ ] Introduce `_steeringQueue`, `_followUpQueue`, delivery mode fields, and `steer()/followUp()` methods on `packages/agent/src/agent.ts`; keep `queueMessage()` as deprecated alias (internally calls `followUp()`), gated by a runtime warning to prompt migration.
- [ ] Extend `AgentRunConfig` and transports (`ProviderTransport`, `AppTransport`, `CodexTransport`) to accept `getSteeringMessages`/`getFollowUpMessages` and forward them to the loop.
- [ ] Port pi’s `agent-loop` logic to `packages/ai/src/agent/agent-loop.ts`:
  - [ ] Poll steering before each turn and after each tool execution, skipping remaining tools when steering arrives.
  - [ ] Only fetch follow-ups once agent would otherwise stop.
  - [ ] Maintain backwards compatibility for consumers lacking the new callbacks (default to empty arrays).
- [ ] Add unit tests mirroring pi’s coverage (`agent.test.ts`, `agent-loop.test.ts`) asserting: steering interrupts mid-tool, follow-ups wait, queue modes respected, legacy `queueMessage()` still works.

### 2. Session/Runtime Surface Area
- [ ] Augment the runtime session controller (successor to pi’s `AgentSession`) with `steer(text)` / `followUp(text)` / `sendUserMessage(content, { deliverAs })` APIs. Ensure these expand skills/templates, enforce “no hook commands while queued,” and call into the new agent queues.
- [ ] Update persistence + queue restore logic (`prompt-queue`, session manager) to track which queue each pending text belongs to so aborted runs can restore accurate `/steer` vs `/followup` scripts.
- [ ] Surface queue lengths separately (e.g., `steeringQueueSize`, `followUpQueueSize`) so UI + header indicators remain correct.

### 3. TUI & Slash Commands
- [ ] Replace the current “if responding → `agent.queueMessage()`” block in `apps/coding-agent/src/ui/app-shell/TuiApp.tsx` with delivery-aware routing:
  - [ ] `/steer` command (new built-in under `domain/commands`) decides between immediate prompt vs `session.steer()` based on `isResponding`.
  - [ ] `/followup` command parallels behavior but calls `session.followUp()` when streaming.
  - [ ] Plain Enter during streaming defaults to follow-up (preserves existing UX) but attaches metadata so queue restore + UI badges know mode.
- [ ] Update queue indicator + tooltips to explain steering vs follow-up counts (keep UI minimal now, but ensure computed state is available to future panes).
- [ ] Add composer tests covering `/steer`, `/followup`, aborted queue restore, and Enter-while-streaming flows.

### 4. Hooks & Custom Extension Support
- [ ] Extend `HookAPI` with `sendUserMessage(content, options?: { deliverAs?: "steer" | "followUp" })`, `isIdle(): boolean`, and `steer(text)`/`followUp(text)` sugar so hook authors can implement `/steer` without touching UI internals.
- [ ] Ensure hook command registry passes adapter context to handlers (so `/steer` implemented inside `~/.config/marvin/hooks/steer.ts` can check idle state and call the right API).
- [ ] Refresh `examples/hooks` with a `steer-followup.ts` sample mirroring pi’s `send-user-message.ts` and document the new APIs under `apps/coding-agent/README.md` + `docs/pi.md` parity table.

### 5. Verification & Migration
- [ ] Author migration notes (CHANGELOG + docs) describing new APIs, default behavior, and how legacy `queueMessage()` now maps to follow-up.
- [ ] Test matrix:
  - [ ] `bun run typecheck && bun run test` across packages.
  - [ ] New agent-loop unit tests verifying steering skip semantics.
  - [ ] TUI integration test (if available) or manual script: start run, trigger tool, issue `/steer` and observe interruption, then `/followup` to confirm delayed delivery.
  - [ ] Manual hook test: copy example to `~/.config/marvin/hooks/steer.ts`, launch Marvin, run `/steer focus` while agent streams.

## Risks & Mitigations
- **Transport contract drift**: ensure Codex/App transports forward both callbacks; add type tests so adapters fail fast if they omit new fields.
- **User confusion about queue defaults**: keep Enter-while-streaming behaving as follow-up, and highlight `/steer` command in docs. Provide clear toasts when a steer is queued vs delivered.
- **Hook compatibility**: default `marvin.send()` to follow-up to avoid breaking existing hooks; encourage migration via warnings/documentation.

## Next Steps
1. Prototype agent-core changes in a branch, lifting pi’s implementation verbatim where possible to minimize divergence.
2. Once unit tests pass, wire the session/runtime APIs and expose temporary developer-facing toggles for validation.
3. Finish by updating TUI commands + docs, then regression test with a real run to confirm `/steer` interrupts after tool completion.

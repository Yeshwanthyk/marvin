# Option 3 · Effect Runtime Migration Plan

_Date:_ January 18, 2026  
_Owner:_ yesh  
_Scope:_ Move the entire Marvin runtime (core AI loop, transports, hooks, CLI entrypoints) onto Effect, using Bun everywhere ("option 3").

---

## 1. Current Context Snapshot
- **Runtime shape:** `apps/coding-agent/src/runtime/factory.ts` still instantiates the agent imperatively (LazyToolLoader, HookRunner, queue logic). A new `packages/runtime-effect/` package exists but is not wired into the CLI, lacks hook orchestration, and mixes imperative services with Context tags only at the edges.
- **Tooling:** `package.json` already depends on `effect`, `@effect/platform-node`, `@effect/cli`, and wires `prepare: effect-language-service patch`. `tsconfig.base.json` is missing recommended settings (`incremental`, `composite`, `exactOptionalPropertyTypes`, `declarationMap`, `sourceMap`). `.vscode/settings.json` does not force the workspace TypeScript SDK. `.reference/effect/` exists, but AGENT docs do not tell contributors to consult `effect-solutions` before coding.
- **Configs:** User config lives in `~/.config/marvin` (backed up). Key assets detected today:
  - `config.json` selecting `anthropic` / `claude-opus-4-5`, `thinking: "medium"`, theme overrides.
  - Hooks: `auto-compact.ts`, `blow-sound.ts`, `handoff.ts` (expect event-driven orchestration, queue interactions, and custom hook APIs to keep working).
  - Commands + tools directories exist (contents validated via `apps/coding-agent/src/custom-commands.ts`, etc.).
- **Verification contracts:** `bun run check` fan-out (typecheck + bun test) must pass after every plan item. DMUX can be used for manual sessions; reference TUI path `apps/coding-agent/src/adapters/tui/app.tsx`.

---

## 2. Objectives & Non-Goals
- **Objectives**
  1. Replace the imperative runtime factory with Effect layers + `ExecutionPlan` scaffolding covering transports, hooks, sessions, queueing, and `.config/marvin` adapters.
  2. Preserve (and document) hooks/tools/commands semantics powered by assets inside `~/.config/marvin` with no backward-compat shims required.
  3. Provide typed services for UI & CLI adapters (TUI, headless, ACP) so they depend only on Effect contracts.
  4. Lock in Effect tooling (language service, tsconfig, VS Code config, agent instructions, `.reference/effect`) to keep future contributions rigorous.
  5. Expand automated tests + lint coverage to prove the new runtime works, including concurrency/backoff logic.
- **Non-Goals**
  - Supporting legacy npm/pnpm workflows (Bun is authoritative; `package-lock.json` remains only for historical reasons).
  - Maintaining the previous runtime factory once the Effect runtime lands (we will remove, not keep both).
  - Providing shims for legacy hook APIs beyond what `.config/marvin/hooks/*.ts` already consume.

---

## 3. Workstreams & Deliverables
Each checklist item becomes its own commit + `bun run check` gate.

### Phase 1 · Effect Foundations & Tooling
- [x] **P1.1** Harden dependency + lint tooling: verify `effect`, `@effect/platform-node`, `@effect/cli`, `@effect/language-service` versions, align `bun.lock`, and remove unused legacy entries if discovered.
- [x] **P1.2** Update TypeScript configs: add recommended options to `tsconfig.base.json`, propagate per-package overrides (CLI uses bundler mode, libraries use NodeNext) per `effect-solutions show tsconfig`.
- [x] **P1.3** Ensure VS Code / Cursor picks workspace TypeScript & plugin via `.vscode/settings.json`.
- [x] **P1.4** Refresh AGENT instructions with Effect guidance (`<!-- effect-solutions:start -->` block) and create `CLAUDE.md` alias if missing.
- [x] **P1.5** Re-run `effect-solutions setup` (CLI currently lacks `setup`, so refreshed `.reference/effect/` via `git -C .reference/effect pull --ff-only`) so `.reference/effect/` is fresh; document expectations inside plan + AGENT docs.

### Phase 2 · Runtime Core Layers & Services
- [x] **P2.1** Flesh out `packages/runtime-effect`: Config, Transport, Tool, Agent layers already exist—extend them with hooks, custom commands, `.config/marvin` loader, LazyToolLoader parity, and DMUX instrumentation hooks. _(Completed via hook/custom-command relocation, new `CustomCommandLayer`/`ExtensibilityLayer`, instrumentation service, and lazy loader export on Jan 18, 2026.)_
- [x] **P2.2** Model queues + orchestration using Effect primitives (`Queue`, `Stream`, `ExecutionPlan` for retries/fallback). Include compaction + session persistence wiring via `SessionManagerLayer` and `HookRunner` events.
  - [x] **P2.2a — PromptQueueLayer:** Implement an Effect-powered prompt queue service that wraps `Effect.Queue`, tracks steer/follow-up counts, and exposes streams for adapters + instrumentation hooks. Provide serialization helpers so `.config/marvin/sessions` can persist queued prompts on crash. _(Delivered Jan 18, 2026 via `PromptQueueLayer`, serialization helpers, and Bun tests in `packages/runtime-effect/tests/prompt-queue.test.ts`.)_
  - [x] **P2.2b — ExecutionPlanBuilder:** Define configurable retry/fallback plans per provider/model (Anthropic primary, OpenAI fallback, etc.), hooking into `SessionManager` for compaction metadata and to DMUX instrumentation for visibility. _(Delivered Jan 18, 2026 via `packages/runtime-effect/src/session/execution-plan.ts`, `ExecutionPlanBuilderLayer`, `ExecutionPlanStepTag`, and new Vitest coverage in `packages/runtime-effect/tests/execution-plan.test.ts`.)_
  - [x] **P2.2c — SessionOrchestratorLayer:** Added `packages/runtime-effect/src/session/orchestrator.ts` plus service exports so the Effect runtime now drains `PromptQueue`, emits hook lifecycle signals (session start, DMUX logging), and wraps agent prompts with `ExecutionPlan` retries/fallbacks guarded by `SessionManager`.
  - [x] **P2.2d — Coverage:** Extended `packages/runtime-effect/tests/session-orchestrator.test.ts` to assert queue draining + fallback retries and updated `bun run check` logs in this plan as the verification artifact for DMUX-friendly orchestration.
- [x] **P2.3** Added `packages/runtime-effect/src/runtime.ts` + `RuntimeLayer` so adapters can pull a full `RuntimeServices` bundle (agent, hook runner, session manager, prompt queue, orchestrator, transports, LSP, custom commands) built entirely via Effect layers. Covered by a new Bun test that instantiates the layer against a temporary config and asserts the resulting services.

### Phase 3 · Hook + Session Orchestration Rewrite
- [x] **P3.1** Rebuild hook runner on Effect: convert `apps/coding-agent/src/hooks` to use `Layer` + `Channel`, preserving ability to dynamically load TS hooks from `~/.config/marvin/hooks`. _(HookEffects Layer + Channel-backed dispatcher landed Jan 18, 2026; HookContextControllerLayer now provides Effect-scoped initialization + instrumentation for `HookRunner.initialize` so adapters can register UI/session contexts without imperative wiring.)_
- [x] **P3.2** Integrate `.config/marvin/commands` + `.config/marvin/tools` lifecycle with new Effect services (typed `Layer` for user extensions, error reporting, DMUX-friendly logging). _(CustomCommandLayer now emits Effect-scoped instrumentation + validation events, ExtensibilityLayer reports tool inventories (names/paths) alongside hook counts, and new Bun tests cover both layers loading via injected loaders.)_
- [ ] **P3.3** Ensure LSP manager + tool diagnostics become Effect-managed resources, enabling safe startup/shutdown and bridging to UI via event bus.

### Phase 4 · CLI & Adapter Integration
- [ ] **P4.1** Swap `apps/coding-agent/src/runtime/factory.ts` usage with new Effect runtime (likely thin adapter that composes layers and hands out resources to TUI/headless/ACP).
- [ ] **P4.2** Remove legacy modules replaced by Effect equivalents (`lazy-tool-loader`, `runtime/transport`, manual queue helpers) and migrate tests.
- [ ] **P4.3** Update CLI adapters (headless, TUI, ACP) to consume the new services; validate DMUX + `.config/marvin` flows.

### Phase 5 · Verification & Documentation
- [ ] **P5.1** Expand Vitest suites to cover new services (session manager, hook orchestration, queue scheduling with ExecutionPlan fallbacks).
- [ ] **P5.2** Run `bun run check` + targeted suites (`bun test apps/coding-agent/tests`) post-migration; capture logs for regressions.
- [ ] **P5.3** Document runtime migration in `README.md` / `docs/` (what changed, how to work with Effect). Ensure `plan.md` statuses reflect completion.

---

## 4. Verification Strategy
- **Automated:** `bun run check` (typecheck + tests) after every checklist item. Additional focused runs when touching runtime packages (e.g., `bun test apps/coding-agent/tests/runtime.test.ts`).
- **Manual:** DMUX window to run `bun run marvin` against sample prompts, verifying `.config/marvin/hooks` like `auto-compact.ts` still fire.
- **Artifact capture:** Save relevant logs (stdout/stderr) when diagnosing concurrency issues; link to them in commit messages if necessary.

---

## 5. Risks & Mitigations
- **Hook regressions:** Mitigate by building integration tests that load hooks from a fixture matching `~/.config/marvin/hooks` contents.
- **Transport auth drift:** Ensure `TransportLayer` shares API key resolver with CLI options and refresh tokens stored in `~/.config/marvin` (anthropic OAuth).
- **UI coupling:** Keep Solid UI unaware of Effect internals by providing typed adapters; use `Context` tags to bound dependencies.

---

## 6. Immediate Next Steps
1. Stand up **P3.3** diagnostics/LSP lifecycle service (scoped Effect resources, graceful shutdown) ahead of CLI integration.
2. Map the CLI adapter swap (Phase 4) by outlining how TUI/headless/ACP pick up `RuntimeLayer` + hook context controller.
3. Draft the Phase 5 DMUX/manual validation checklist so we can exercise the new runtime via `bun run marvin` once adapters switch over.

_This document is the authoritative tracker. Update checkboxes + notes as phases complete._

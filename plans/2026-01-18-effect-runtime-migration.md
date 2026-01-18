# Effect Runtime Migration Plan

## Plan Metadata
- Created: 2026-01-18
- Status: in-progress
- Owner: yesh
- Scope: Option 3 (full runtime + hook orchestration on Effect)
- Assumptions:
  - Bun is authoritative package manager (`bun.lock` drives installs).
  - `~/.config/marvin` is backed up but must continue to work post-migration (hooks, commands, tokens, sessions, etc.).
  - Breaking runtime APIs is acceptable provided CLI + hooks keep functioning locally.

## Progress Tracking
- [ ] Phase 1: Effect Foundations & Tooling
- [ ] Phase 2: Runtime Core Layers & Services
- [ ] Phase 3: Hook + Session Orchestration Rewrite
- [ ] Phase 4: CLI Runtime Integration & Removal of Legacy Path
- [ ] Phase 5: Tests, Lint, and Regression Coverage
- [ ] Phase 6: Instructions & Reference Assets

## Phase Outline

### Phase 1 · Effect Foundations & Tooling
Goal: add Effect dependencies, configure language service + tsconfig, and stand up `.reference/effect` so subsequent work can rely on documented patterns.
- Add `effect`, `@effect/platform-node`, `@effect/cli`, and `@effect/schema` replacements as needed to root `package.json` via Bun workspaces.
- Wire Effect Language Service (per `effect-solutions show project-setup`) including tsconfig plugin, VS Code settings, and `prepare` script.
- Align `tsconfig.base.json` + package tsconfigs with recommended compiler options from `effect-solutions show tsconfig`.
- Run `effect-solutions setup` to create `.reference/effect/` and ensure `.gitignore` entries exist.
- Verification: `bun run check`, ensure ESLint + typecheck succeed.

### Phase 2 · Runtime Core Layers & Services
Goal: introduce an Effect-first runtime package that abstracts environment/config, transports, tools, and messaging as `Layer`s.
- Create `packages/runtime-effect/` (or rename existing runtime folder) exporting `RuntimeContext` built via Effect.
- Define services: `ConfigService` (loads `~/.config/marvin` files, respects overrides), `ToolService` (wraps builtin/custom tools), `TransportService` (manages provider/codex layers), `AgentService` (Effect-facing interface to agent loop/stream).
- Model queueing and event streams with `Effect.Stream`/`Channel` rather than manual arrays; ensure configurability for future ExecutionPlan usage.
- Provide compatibility exports so UI can consume typed events without depending on previous imperative classes.
- Verification: targeted unit tests for service layers + new Vitest coverage for config loading and queue semantics.

### Phase 3 · Hook + Session Orchestration Rewrite
Goal: rebuild hook + session management (`apps/coding-agent/src/hooks/*`, `SessionManager`, prompt queue) on top of Effect constructs.
- Replace `HookRunner` implementation with `Effect` pipelines (managed fibers per hook, typed events, structured error handling) while honoring `~/.config/marvin/hooks/*` semantics.
- Reimplement prompt queue + retry/backoff via `Effect.Schedule` + `Queue`, ensuring features like auto-compact hook (from `~/.config/marvin/hooks/auto-compact.ts`) keep receiving the same events.
- Provide bridging adapters for Solid UI (reactive stores) but keep heavy lifting inside Effect-managed processes.
- Verification: concurrency-focused tests using virtual scheduler; manual tmux session to confirm hooks respond (auto-compact, blow-sound, etc.).

### Phase 4 · CLI Runtime Integration & Legacy Removal
Goal: plug the new Effect runtime into `apps/coding-agent`, remove obsolete imperative runtime factory, and ensure CLI flows from config → runtime → UI exclusively via new services.
- Rewrite `apps/coding-agent/src/runtime/factory.ts` (and submodules) to bootstrap the Effect runtime, exposing only minimal adapter needed by UI.
- Remove or archive legacy modules: `LazyToolLoader`, direct `Agent` instantiation, manual transports, etc., once the Effect layers cover them.
- Ensure configuration files (`apps/coding-agent/src/config.ts`, `.config/marvin/config.json`) integrate with new services.
- Verification: `bun run marvin` interactive smoke test plus tmux run showing new runtime handles hooks + prompts end-to-end.

### Phase 5 · Tests, Lint, and Regression Coverage
Goal: expand automated coverage for the new Effect architecture.
- Update Vitest suites (`packages/ai`, `packages/agent`, `apps/coding-agent/tests`) to target new modules, especially hook orchestration and queue rules.
- Add scenario tests for `~/.config/marvin` assets (load example hooks/commands) to ensure serialization + event flow.
- Run `bun run check` (typecheck + tests) and capture artifacts/logs for regressions.

### Phase 6 · Instructions & Reference Assets
Goal: align AGENT docs + local references with the Effect-first workflow.
- Update `AGENTS.md` and `CLAUDE.md` between `<!-- effect-solutions:start -->` markers with Effect best practices.
- Document runtime changes + migration notes inside `README.md` / `apps/coding-agent/README.md`.
- Ensure `.reference/effect/` is populated and documented for future contributors.
- Verification: docs lint (if any) + manual review.

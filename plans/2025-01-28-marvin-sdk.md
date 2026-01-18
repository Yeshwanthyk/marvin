# Marvin SDK Implementation Plan (Effect Runtime)

## Plan Metadata
- Created: 2025-01-28
- Updated: 2026-01-18
- Owner: yesh
- Status: draft (rewritten for Effect runtime)
- Package manager: bun

## Constraints
- No backward compatibility requirements.
- TypeScript rules: no `any`, no non-null assertions, no `as Type` casts.
- Keep files <= 300 lines; max 1 React component per file.
- Bun only (no npm/pnpm).
- Confirm before: tsconfig changes, package installs, agent-file edits.

## Current State (as of 2026-01-18)
- Effect runtime is authoritative (`packages/runtime-effect`) and already powers CLI/TUI.
- Runtime composition: `RuntimeLayer` -> `SessionOrchestrator` + `ExecutionPlan` + `PromptQueue` + hooks + LSP + tool runtime.
- Tool registry in `@marvin-agents/base-tools` still uses singleton tools with implicit `process.cwd()` resolution.
- Config loader in `runtime-effect/src/config.ts` resolves project `AGENTS.md` via `process.cwd()`, which breaks multi-cwd SDK usage.
- Local Effect reference path per docs: `~/.local/share/effect-solutions/effect`. If missing, we currently use the repo-local `.reference/effect`.

## Goals
1. Provide `@marvin-agents/sdk` with a minimal, stable API built on the Effect runtime.
2. Ensure cwd isolation for tools and AGENTS discovery.
3. Offer both Promise-based helpers and Effect-native APIs.
4. Provide streaming and instrumentation hooks without bypassing the runtime.
5. Keep configuration, hooks, and custom tools consistent with CLI/TUI behavior.

## Non-Goals
- NPM publishing.
- Skills system.
- Backward compatibility for `codingTools` exports or legacy SDK docs.
- Tool auto-installation.

## Target Public API (SDK)

### Core
- `runAgent(options): Promise<Result<SdkResult, SdkError>>`
- `runAgentEffect(options): Effect.Effect<SdkResult, SdkError>`

### Session
- `createAgentSession(options): Promise<SdkSession>`
- `createAgentSessionEffect(options): Effect.Effect<SdkSession, SdkError>`

### Streaming
- `runAgentStream(options): AsyncIterable<SdkEvent>` (wrapper around Effect Stream)

### Key types (shape only)
- `SdkResult`: response text, messages, usage, sessionId, toolCalls, model/provider metadata.
- `SdkError`: tagged union for config errors, runtime errors, transport errors.
- `SdkEvent`: agent events + hook messages + instrumentation events.

## Implementation Phases

### Phase 0 - Preflight and References
- [x] Verify Effect Solutions CLI: `effect-solutions list`.
- [x] Ensure reference repo exists at `~/.local/share/effect-solutions/effect`.
- [x] If missing, clone manually (or use `effect-solutions setup` if it becomes available).
- [x] Document fallback to `.reference/effect` when global cache is absent.
- [x] Update any SDK docs that still point to `.reference/effect` only.

### Phase 1 - Config and cwd Injection
Goal: make runtime config and AGENTS discovery cwd-aware and SDK-friendly.

Changes:
- [ ] Add `cwd?: string` to `LoadConfigOptions` in `packages/runtime-effect/src/config.ts`.
- [ ] Update `loadAgentsConfig` to accept `cwd` and resolve project `AGENTS.md` and `CLAUDE.md` under that cwd, not `process.cwd()`.
- [ ] Allow `LoadConfigOptions` to override `systemPrompt` and `lsp` settings:
  - `systemPrompt?: string`
  - `lsp?: { enabled: boolean; autoInstall: boolean }`
- [ ] Update `RuntimeLayerOptions` to accept and forward these new config options.
- [ ] Add tests for:
  - project AGENTS discovery using explicit cwd
  - systemPrompt override
  - lsp override behavior

Notes:
- CLI/TUI should still pass `cwd: process.cwd()` so behavior remains consistent.
- SDK will set `lsp.enabled = false` by default unless explicitly enabled.

### Phase 2 - CWD Tool Registry (No Backward Compat)
Goal: tools are cwd-scoped by default and registry can be built per cwd.

Changes:
- [ ] Convert base tools to factory-first exports:
  - `createReadTool(cwd)`
  - `createWriteTool(cwd)`
  - `createEditTool(cwd)`
  - `createBashTool(cwd)`
- [ ] Replace `toolRegistry` with `createToolRegistry(cwd)` that returns a registry whose `load` closures capture cwd.
- [ ] Remove singleton exports and `codingTools` array; update all imports to use factories or registry.
- [ ] Update `packages/runtime-effect/src/runtime.ts`:
  - Build the registry from `createToolRegistry(options.cwd)`
  - Ensure `LazyToolLoader` uses the new registry
  - Update builtin tool list to derive from registry keys
- [ ] Update docs/guides that mention `codingTools`.
- [ ] Add tests in `packages/base-tools/tests` for cwd-bound read/write/edit/bash.

### Phase 3 - SDK Package Foundation
Goal: implement SDK on top of runtime-effect, with strict options and minimal surface area.

Package structure:
- [ ] `packages/sdk/package.json` with dependencies:
  - `@marvin-agents/runtime-effect`
  - `effect`
  - `@marvin-agents/agent-core` (types only if needed)
- [ ] `packages/sdk/tsconfig.json` extending root base config.
- [ ] Root `package.json` typecheck includes `packages/sdk`.

Core implementation:
- [ ] `SdkError` tagged union (config, runtime, transport, hook).
- [ ] `Result` helpers (no `any`, no casts).
- [ ] Internal `createSdkRuntime(options)`:
  - uses `RuntimeLayer` with `adapter: "headless"`, `hasUI: false`
  - passes `cwd`, `configDir`, `provider`, `model`, `thinking`
  - default `lsp.enabled = false`
  - optional instrumentation sink
  - returns scoped runtime + `close()` finalizer
- [ ] `runAgentEffect`:
  - opens runtime scope
  - applies `systemPrompt` override via `runtime.agent.setSystemPrompt`
  - submits via `SessionOrchestrator.submitPromptAndWait`
  - returns `SdkResult` constructed from runtime agent state
  - closes scope on completion
- [ ] `runAgent` wrapper returns `Result`.

Session API:
- [ ] `createAgentSessionEffect`:
  - opens runtime scope
  - sets system prompt once
  - returns `SdkSession` with `chat`, `snapshot`, `drainQueue`, `close`
- [ ] `createAgentSession` Promise wrapper.

Streaming:
- [ ] `runAgentStream`:
  - uses `Effect.Stream` internally
  - bridges agent events (`agent.subscribe`)
  - surfaces hook messages and instrumentation events
  - returns `AsyncIterable<SdkEvent>` for easy consumption

### Phase 4 - Testability and Mock Transport
Goal: test SDK without real API calls.

Changes:
- [ ] Add optional transport override to `RuntimeLayerOptions`:
  - `transportLayer?: Layer<TransportService>` or `transportFactory?: (config) => TransportBundle`
- [ ] Provide a mock transport for tests (deterministic responses, no network).
- [ ] SDK tests:
  - `runAgent` returns deterministic response with mock transport
  - `createAgentSession` supports multi-turn
  - `runAgentStream` yields agent events in order
- [ ] Update runtime-effect tests to cover injected transport.

### Phase 5 - Documentation Updates
Goal: align docs with new SDK and remove legacy guidance.

Changes:
- [ ] Update `docs/architecture.md` and `docs/walkthrough.md` to reference SDK built on Effect runtime.
- [ ] Update `guides/sdk-migration-guide.html` and other SDK docs to remove `codingTools` backward-compat notes.
- [ ] Add `docs/sdk.md` with:
  - minimal examples for `runAgent`, `createAgentSession`, streaming
  - notes on config dir overrides and hook loading
  - LSP default behavior in SDK

## Verification
- `bun run check`
- `bun test packages/sdk`
- Manual: run SDK against two different cwd values in parallel; verify tools and AGENTS resolve correctly.

## Risks and Mitigations
- **Config drift**: keep SDK config wired to `runtime-effect` and test explicit cwd overrides.
- **Tool registry churn**: change is non-backward compatible; update all docs and internal usage together.
- **Streaming correctness**: ensure the SDK stream includes both agent and hook/instrumentation events.
- **LSP side effects**: default LSP off in SDK to avoid background processes unless opted in.

## Definition of Done
- SDK works end-to-end using Effect runtime services only.
- Tool execution is cwd-scoped across concurrent sessions.
- SDK tests pass without network.
- Docs updated and no references to legacy `codingTools` remain.

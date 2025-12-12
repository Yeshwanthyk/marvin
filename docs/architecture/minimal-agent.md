# Minimal Bun-Based Agent Stack

This note frames a minimal Bun-based agent stack that borrows proven concepts from `reference/pi-mono/packages/ai`, `reference/pi-mono/packages/agent`, `reference/pi-mono/packages/coding-agent`, `reference/pi-mono/packages/tui`, and `reference/opencode-openai-codex-auth`.

## Layered Split: Providers · Runtime · Tools · UI
- **Providers (`packages/ai`)** stay isolated so new models (OpenAI, Anthropic, local LLMs) ship without touching orchestration. The thin provider contractor also enables deterministic fixture tests against mock transports.
- **Runtime (`packages/agent`)** houses orchestration primitives (sessions, tasks, branch/context lifecycles). Keeping runtime logic free of provider SDKs means we can exercise it with Bun tests plus TypeBox fixtures and keep linting deterministic.
- **Tools (`packages/coding-agent`)** wrap host-side capabilities (fs, git, npm, tmux, browser). They must be versioned separately to honor system-specific constraints (permissions, interactive flows) and to let runtime compose toolkits per provider guarantees.
- **UI (`packages/tui`)** manages conversation state, streaming deltas, and input focus. The split keeps ANSI/layout churn away from orchestration, so backend/runtime upgrades do not break UI rendering.

The split mirrors `pi-mono`, shortening the path to Git history reuse, while `opencode-openai-codex-auth` informs OAuth token brokerage so the provider adapter can trade Codex tokens independently of runtime code.

## Architecture Overview
| Layer | Responsibility | Minimal Implementation |
| --- | --- | --- |
| Interface | CLI entrypoint + config loader | Bun CLI + TypeScript (`bunx`) command defined in `src/cli.ts` that reads workspace config, selects provider/runtime/tool bundles |
| Provider adapter | Request signing, retries, model metadata | Adapted from `reference/pi-mono/packages/ai/src/providers/*`; inject Codex OAuth (from `reference/opencode-openai-codex-auth/src/server.ts`) for OpenAI-provided models |
| Runtime kernel | Session graph, branch/context state, tool routing | Inspired by `reference/pi-mono/packages/agent/src/runtime/*`; stores agent plan state in Bun KV / filesystem |
| Tool host | Shell, fs, editor, browser, git, tmux hooks | Copy conceptual APIs from `reference/pi-mono/packages/coding-agent/src/tools/*`, but hard-limit to minimal set below. See `docs/architecture/tools.md` for the truncation/temp-file rules. |
| UI shell | TUI panes, streaming log, status board | Follow `reference/pi-mono/packages/tui/src/*` layout but collapse to single-pane conversation + status ticker |

## Platform & Constraint Summary
- **Bun runtime**: All binaries must run under Bun (see `bunfig.toml`). Use `bun test` for runtime tests; keep Node-only APIs (e.g., `fs/promises` polyfills) out of shared code.
- **oxlint + eslint**: Adopt `oxlint` as the fast path for PR lint (`bunx oxlint "src/**/*.ts"`). Fall back to ESLint for rule parity. Enforce consistent config sharing via `packages/*/.eslintrc.cjs`.
- **TypeBox schemas**: Runtime contracts (tool metadata, provider payloads) must export `TypeBox` schemas so Bun-based validation stays 0-dependency and serializable. Use inference (`Static<typeof Schema>`) to keep types in sync.
- **Codex OAuth**: Provider adapters must request Codex tokens via the `opencode-openai-codex-auth` flow (PKCE + token cache). Never store raw OpenAI keys in env; the CLI holds only the OAuth refresh token and exchanges it per request.

See `docs/architecture/providers.md` for the concrete adapter/registry layout plus storage details.

## Control/Data Flow
1. CLI loads workspace config (`~/.config/mu/agent.json`) and resolves provider/tool bundle references.
2. Provider adapter checks Codex OAuth validity; if absent/expired, it launches the `opencode` auth helper and stores tokens encrypted locally.
3. Runtime constructs a branch context (git branch, plan id, bead id) using `packages/agent` patterns. Context metadata is validated against TypeBox schema.
4. Tool invocations are queued by runtime and executed with Bun subprocess APIs. Each tool returns TypeBox-validated results before provider streaming resumes.
5. UI layer reads runtime events via an async iterator, renders conversation transcripts, branch/context status, and tool progress inside the TUI.

## Assumptions
- `reference/pi-mono` stays available for design cues but we only re-implement the minimal subset required here.
- Bun is the only supported JS runtime; Node compatibility workarounds are out of scope for V1.
- OAuth-protected providers (Codex/OpenAI) are mandatory; key-based providers (local ggml) are optional follow-ups.
- Local filesystem is writable; remote execution or jailed environments will be future beads.
- Tests rely on Bun's built-in runner; Jest/Vitest is not included.

## Open Questions
- Should provider adapters share transport (HTTP agent, tracing) or remain fully isolated per provider?
- Where do branch/context manifests live (git worktree vs. `$TMPDIR` vs. sqlite)? `pi-mono` uses workspace metadata files—confirm expectation.
- Do we need multi-agent orchestration (parallel beads) in V1 or just single agent looptask?
- What user identity should Codex OAuth attribute to multiple workspaces? Need guidance on token scopes + expiry.

## V1 Goals
### Branch + Context Status
- Provide a runtime status pane mirroring `reference/pi-mono/packages/tui` to show: current git branch, dirty status (via tool call), selected bead, plan progress with step states.
- Persist branch/context metadata (`branch`, `bead`, `taskId`, `planSteps`) in a JSON file (TypeBox schema) under `.mu/context.json`.

### Tool Set
- Ship the following minimal tools (wrapping `packages/coding-agent` concepts): `fs.read`, `fs.write`, `shell.exec`, `git.status`, `npm.script`, `browser.eval` (Chrome DevTools bridge), `tmux.windowStatus`.
- Enforce TypeBox-described signatures and register them in a single `toolRegistry.ts` so runtime can expose tool availability to providers.

### Provider Scope
- Start with Codex (OpenAI gpt-4.1/gpt-4o-mini) via OAuth.
- Leave hooks for Anthropic/Sonnet but stub them out with `NotImplemented` errors until OAuth story is ready.
- Implement streaming completions + tool-calls using the `packages/ai` adaptor patterns.

## Follow-up Beads / Tests / Commit Guidelines
- **Beads**
  - `bd create "tool host hardening"` once the minimal registry is stable to add sandboxing + rate limits.
  - `bd create "anthropic adapter"` after Codex OAuth stabilizes to reuse provider interface.
  - `bd create "tui multi-pane"` for richer UI after single-pane MVP ships.
- **Tests**
  - Add Bun integration tests mirroring `reference/pi-mono/packages/agent/tests/runtime.test.ts` covering: plan state machine, tool dispatch, branch/context persistence.
  - Provider contract tests using `TypeBox` fixtures similar to `reference/pi-mono/packages/ai/tests/providers/codex.test.ts`.
  - UI snapshot tests (`bun test --filter tui`) referencing `reference/pi-mono/packages/tui`.
- **Commit Guidelines**
  - Keep provider/runtime/tool/UI changes in separate commits to mirror the layer split.
  - Reference the borrowed path in commit body (e.g., "Inspired by reference/pi-mono/packages/agent runtime graph").
  - Run `bunx oxlint`, `bunx eslint`, and `bun test` before pushing.

## Checklist
1. Review `reference/pi-mono/packages/ai`, `packages/agent`, `packages/coding-agent`, `packages/tui` for API parity.
2. Wire Codex OAuth using `reference/opencode-openai-codex-auth` PKCE helpers.
3. Scaffold Bun CLI entrypoint and config schema (TypeBox).
4. Implement runtime context tracker with branch/bead status file.
5. Register minimal tool set and ensure TypeBox contracts exist per tool.
6. Build single-pane TUI hooking into runtime events, matching `packages/tui` style.
7. Add oxlint/eslint configs + Bun tests to CI.
8. Document provider/runtime/tools/UI split and deployment expectations.

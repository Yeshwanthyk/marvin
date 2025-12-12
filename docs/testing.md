# Testing & QA

This repo is a Bun + TypeScript monorepo (workspaces under `packages/*` and `apps/*`).
The goal is consistent QA across every workspace, with **no external network** required for tests.

## How to run

- Run all workspace tests: `bun run test`
- Run typecheck + tests (CI-style): `bun run check`
- Run a single workspace: `cd packages/runtime && bun run test`

Each workspace runs `bun test tests` (tests live under a local `tests/` directory).

## Shared harness

`bunfig.toml` configures a shared Bun test preload script:

- `test/setup.ts` is preloaded for every workspace test run.
- Keep setup minimal and deterministic (no network, no global state unless necessary).

## Provider mocking (streaming)

Provider adapters are tested without hitting real APIs:

- `packages/providers/tests/mock/sse-server.ts` starts a local HTTP server that emits SSE frames.
- Provider tests override `fetchImplementation` to redirect fixed provider URLs to the local server.

This keeps streaming behavior testable while remaining hermetic.

## Integration tests (runtime ↔ tools ↔ provider)

The runtime package includes integration tests that simulate provider streaming and tool execution:

- Use a scripted `AgentTransport` that returns a `ProviderStream` emitting `tool-call-delta` events.
- Validate tool execution and any truncation logic (e.g. `shell.bash` output truncation).

## Conventions

- Put tests in `tests/` (per workspace).
- Prefer small, deterministic tests over snapshot-heavy suites.
- Avoid external processes unless needed; when used (e.g. `shell.bash`), keep commands simple.


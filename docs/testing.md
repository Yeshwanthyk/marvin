# Testing & QA

This repo is a Bun + TypeScript monorepo (workspaces under `packages/*` and `apps/*`).
The goal is consistent QA across every workspace, with **no external network** required for tests.

## How to run

- Run all workspace tests: `bun run test`
- Run typecheck + tests (CI-style): `bun run check`
- Run a single workspace: `cd packages/ai && bun run test`

Each workspace runs `bun test tests` (tests live under a local `tests/` directory).

## Shared harness

`bunfig.toml` configures a shared Bun test preload script:

- `test/setup.ts` is preloaded for every workspace test run.
- Keep setup minimal and deterministic (no network, no global state unless necessary).

## Conventions

- Put tests in `tests/` (per workspace).
- Prefer small, deterministic tests over snapshot-heavy suites.
- Avoid external processes unless needed; when used (e.g. bash tool), keep commands simple.

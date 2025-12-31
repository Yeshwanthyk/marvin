# SDK-ready merlin repo migration implementation guide

> Purpose: Tutorial for rebuilding the project in a new repo, package by package, while making the codebase SDK-ready.
> Time estimate: 16-24 hours of focused coding (spread over several sessions)
> Difficulty: Advanced

## Background and context

### Why we are doing this
- You want to learn the system deeply by rebuilding it section by section.
- The current repo has tight coupling to process.cwd() and config paths, which blocks clean embedding.
- The embedded SDK plan requires cwd-correct tools and reusable wiring outside the CLI app.
- A clean-room repo migration is the best place to fix assumptions without destabilizing the existing repo.

### Naming baseline (assumed in this guide)
This guide assumes the new repo is merlin from day one. Use this mapping everywhere as you migrate:
- Package scope: `@marvin-agents/*` -> `@merlin-agents/*`
- CLI binary: `marvin` -> `merlin`
- Config dir: `~/.config/marvin` -> `~/.config/merlin`
- Codex cache: `~/.marvin/cache` -> `~/.merlin/cache`
- Env vars: `MARVIN_*` -> `MERLIN_*`
- Default theme: `marvin` -> `merlin`
- Hook API parameter name in examples: `marvin` -> `merlin`
- Repo name and URLs: `marvin` -> `merlin`

### What "SDK-ready" means here
- All default tools can be bound to a specific cwd (not implicitly process.cwd()).
- Config loading can target a specific cwd (for project AGENTS.md and CLAUDE.md).
- Transport wiring is reusable outside the CLI (no TUI or hook assumptions).
- The SDK does not auto-load hooks or custom tools; it accepts explicit tool lists.
- The CLI app becomes a consumer of the SDK, not the owner of wiring.

### How the current system works (short mental model)

Package layering:

```
packages/ai        -> LLM types, models, providers, tool schemas
packages/agent     -> Agent state, transports, Codex OAuth, message lifecycle
packages/base-tools-> read/write/edit/bash tools
packages/lsp       -> LSP diagnostics wrapper for write/edit tools
packages/open-tui  -> TUI components and autocomplete
apps/coding-agent  -> CLI app: config, tools, hooks, TUI, sessions
```

Tool pipeline (TUI and headless):

```
config -> built-in tools + custom tools -> hook wrapper -> LSP wrapper -> Agent
```

Mode entrypoints:
- TUI: `apps/coding-agent/src/tui-app.tsx` (full experience)
- Headless: `apps/coding-agent/src/headless.ts` (single prompt)
- ACP: `apps/coding-agent/src/acp/index.ts` (Zed integration)

Key coupling issues to remove for SDK readiness:
- `process.cwd()` used directly in config and app wiring.
- Hardcoded config paths from the old repo (`~/.config/marvin`) must become `~/.config/merlin`.
- Base tools resolve paths using `path.resolve(...)` without a cwd parameter.
- Codex instructions cache uses `~/.marvin/cache` in the old repo; switch to `~/.merlin/cache`.

### Key files to understand (read these in the old repo)

| File | Purpose | Why it matters |
| --- | --- | --- |
| `apps/coding-agent/src/index.ts` | CLI entrypoint, mode dispatch, TUI worker path | Understand how modes are wired |
| `apps/coding-agent/src/tui-app.tsx` | TUI wiring and tool pipeline | Source of most coupling |
| `apps/coding-agent/src/headless.ts` | Headless wiring | SDK wiring reference |
| `apps/coding-agent/src/acp/index.ts` | ACP server | Optional migration path |
| `apps/coding-agent/src/config.ts` | Config + AGENTS.md merge | Needs cwd awareness |
| `apps/coding-agent/src/session-manager.ts` | Session storage | Has cwd and config path assumptions |
| `apps/coding-agent/src/hooks/*` | Hooks system | Hook lifecycle and tool wrapping |
| `apps/coding-agent/src/hooks/types.ts` | Hook API types | Rename hook parameter + docs |
| `apps/coding-agent/src/custom-tools/*` | Custom tools loader | API exposed to user tools |
| `apps/coding-agent/src/profiler.ts` | Profiler env var | Rename `MARVIN_*` -> `MERLIN_*` |
| `apps/coding-agent/src/theme-names.ts` | Theme list | Default theme rename |
| `packages/open-tui/src/context/theme.tsx` | Built-in theme | Default theme rename |
| `packages/base-tools/src/tools/*` | read/write/edit/bash | Must become cwd aware |
| `packages/base-tools/src/tools/path-utils.ts` | path resolution | Core for cwd binding |
| `packages/lsp/src/tool-wrapper.ts` | LSP wrapper | Must respect cwd and tool interfaces |
| `packages/agent/src/transports/CodexTransport.ts` | Codex transport | Uses instructions cache |
| `packages/agent/src/transports/codex/instructions.ts` | Codex cache | Uses HOME path |
| `packages/agent/src/codex-auth-cli.ts` | Codex token store | Default config dir + legacy migration |
| `packages/open-tui/src/autocomplete/autocomplete.ts` | Autocomplete basePath | Defaults to process.cwd() |
| `apps/coding-agent/scripts/build.ts` | CLI binary build | Requires Solid plugin |
| `package.json` | Root scripts/workspaces | Must match new repo structure |
| `bunfig.toml` | Test preload | Required for tests |
| `scripts/test-all.ts` | Test runner | Standard test orchestration |

### Patterns to follow

AgentTool pattern (schema + execute + abort handling):

```ts
import type { AgentTool } from "@merlin-agents/ai";
import { Type } from "@sinclair/typebox";

const schema = Type.Object({
  input: Type.String({ description: "Example input" })
});

type ExampleDetails = { note: string | null };

export const exampleTool: AgentTool<typeof schema, ExampleDetails> = {
  name: "example",
  label: "example",
  description: "Demonstrates tool shape",
  parameters: schema,
  execute: async (_toolCallId, params, signal) => {
    if (signal?.aborted) throw new Error("aborted");
    const text = params.input;
    return { content: [{ type: "text", text }], details: { note: null } };
  },
};
```

Hook wiring pattern (register events, call send):

```ts
import type { HookAPI } from "@merlin-agents/coding-agent/hooks";

export default function demoHook(merlin: HookAPI): void {
  merlin.on("agent.start", () => {
    merlin.send("Starting a new agent turn");
  });
}
```

Transport composition pattern:

```ts
const providerTransport = new ProviderTransport({ getApiKey });
const codexTransport = new CodexTransport({ getTokens, setTokens, clearTokens });
const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport });
```

## Milestone 0: Migration prep and guardrails

### Goal
Define the new repo boundaries, naming, and the order of migration. Set up a repeatable audit process so every file you migrate is understood.

### Verification
- You have a new empty repo created and a working copy of the old repo open side by side.
- You can run `rg` and `bun` in both repos.

### Steps

#### 0.1 Lock naming baseline (merlin from day one)
- Set package scope to `@merlin-agents/*`.
- Set CLI name to `merlin` and default config dir to `~/.config/merlin`.
- Record the rename map above in your notes so every file gets updated once.

#### 0.2 Freeze the baseline
- Keep a clean commit in the old repo so you can diff against it.
- Record current scripts and versions (root `package.json`).

#### 0.3 Create an audit checklist
- Create a scratch doc and list each package and key files you will read.
- Check off each file after you read and migrate it.

### Watch out for
- Renaming at the same time as refactoring can hide behavioral changes.
- Changing public APIs without a compatibility plan can complicate later publishing.

## Milestone 1: Root infrastructure in the new repo

### Goal
Replicate the workspace tooling so packages can be dropped in one at a time.

### Verification
- `bun install` succeeds in the new repo.
- `bun scripts/test-all.ts` runs and prints "No workspaces found" (or runs against the migrated ones).

### File checklist (copy and review each)
- `package.json`
- `bunfig.toml`
- `tsconfig.base.json`
- `test/setup.ts`
- `scripts/test-all.ts`
- `.gitignore`

### Steps

#### 1.1 Copy root `package.json`
- Update `name` to `merlin-agent` and ensure `workspaces` match the new repo layout.
- Add a root script alias `merlin` that runs the CLI entrypoint and remove any `marvin` alias.
- Trim `typecheck` to only include packages you have migrated.
- Keep `overrides` for `solid-js` and `babel-preset-solid`.
- Ensure `@sinclair/typebox` is pinned at the root.

#### 1.2 Copy `bunfig.toml`
- Keep the test preload pointing to `./test/setup.ts`.

#### 1.3 Copy `tsconfig.base.json`
- Do not change defaults yet; align to the original build.

#### 1.4 Copy `test/setup.ts`
- Keep the NO_COLOR and stack trace settings so tests behave consistently.

#### 1.5 Copy `scripts/test-all.ts`
- This script is used by `bun run test` at the root. Keep it unchanged for now.

#### 1.6 Copy `.gitignore`
- Use the current repo file as-is to avoid accidental checked-in artifacts.

### Watch out for
- If you change the workspace layout, update `scripts/test-all.ts` root list.

## Milestone 2: Migrate `packages/ai`

### Goal
Bring over the LLM API layer with minimal changes and make sure the model catalog generator still works.

### Verification
- `bun run typecheck` for `packages/ai` passes.
- `bun run test` for `packages/ai` passes (currently a no-op).

### File checklist
- `packages/ai/package.json`
- `packages/ai/tsconfig.json`
- `packages/ai/tsconfig.build.json`
- `packages/ai/src/index.ts`
- `packages/ai/src/agent/types.ts`
- `packages/ai/scripts/generate-models.ts`
- `packages/ai/src/models.generated.ts` (generated)

### Steps

#### 2.1 Copy the entire package
- Keep directory structure identical to avoid path changes.

#### 2.2 Fix build script tooling
- Current scripts use `tsgo` which is not in root devDependencies.
- Decide on one:
  - Option A: keep `tsgo` and add it to devDependencies.
  - Option B: replace `tsgo` with `tsc` and adjust scripts.
- Make this decision now because other packages depend on the same pattern.

#### 2.3 Verify model generation workflow
- The generator hits external APIs; run only when you expect network access.
- Ensure `src/models.generated.ts` is present in the repo for local typechecking.

#### 2.4 Update package name and repository metadata
- Update `name` to `@merlin-agents/ai` and set `repository.url` to the new repo.
- Keep the `files` list and `prepublishOnly` script in place.

### Watch out for
- Running `generate-models` is network dependent. Avoid during offline sessions.
- The generated file is required for typechecking if `src/index.ts` re-exports it.

## Milestone 3: Migrate `packages/agent`

### Goal
Move the agent core and make the Codex instructions cache path configurable for embedding.

### Verification
- `bun run typecheck` for `packages/agent` passes.
- Codex transport still resolves instructions without errors when tokens exist.

### File checklist
- `packages/agent/package.json`
- `packages/agent/tsconfig.json`
- `packages/agent/src/index.ts`
- `packages/agent/src/types.ts`
- `packages/agent/src/transports/CodexTransport.ts`
- `packages/agent/src/transports/codex/instructions.ts`
- `packages/agent/src/codex-auth-cli.ts`

### Steps

#### 3.1 Copy the package and update merlin metadata
- Rename the package to `@merlin-agents/agent-core`.
- Update dependencies to `@merlin-agents/ai` (and any other internal imports).
- Ensure `file:../ai` points to the new repo.

#### 3.2 Make Codex instruction caching configurable
- The old repo hardcodes `~/.marvin/cache`; switch the default to `~/.merlin/cache`.
- Add a new optional cacheDir that can be passed by `CodexTransport`.
- If you want legacy compatibility, fall back to `~/.marvin/cache` only when the merlin cache is missing.

Suggested change shape:

```ts
// instructions.ts
export async function getCodexInstructions(model: string, cacheDir?: string): Promise<string> {
  const defaultCacheDir = join(process.env.HOME ?? "", ".merlin", "cache");
  const resolvedCacheDir = cacheDir ?? defaultCacheDir;
  // use resolvedCacheDir instead of CACHE_DIR
}
```

```ts
// CodexTransport.ts
export interface CodexTransportOptions {
  getTokens: () => Promise<CodexTokens | null>;
  setTokens: (tokens: CodexTokens) => Promise<void>;
  clearTokens: () => Promise<void>;
  cacheDir?: string;
}

private async getInstructions(modelId: string): Promise<string> {
  const cacheDir = this.options.cacheDir;
  return getCodexInstructions(modelId, cacheDir);
}
```

Rationale:
- The SDK can pass a cacheDir under its configDir.
- Existing callers do not need to change.

#### 3.3 Update Codex auth CLI defaults to merlin
- In `packages/agent/src/codex-auth-cli.ts`, set `DEFAULT_CONFIG_DIR` to `~/.config/merlin`.
- Keep legacy support by leaving `LEGACY_CONFIG_DIR` as the old location (e.g. `~/.config/marvin` or `~/.marvin`).
- Update the direct-run guard to check for `merlin` instead of `marvin` in the argv path.

#### 3.4 Keep `AgentState` and `AgentEvent` aligned with `@.../ai`
- This is a dependency edge for all UI and TUI code.
- Do not change types yet unless you are prepared to update the app.

### Watch out for
- Adding `cacheDir` is a public API change. Keep it optional.
- `getCodexInstructions` is internal but used in a public class; treat it as stable.

## Milestone 4: Migrate `packages/base-tools` and make tools cwd-aware

### Goal
Add factory functions so tools can be bound to a specific cwd while keeping existing default exports.

### Verification
- `bun run test` for `packages/base-tools` runs real tests (not no-op).
- A new unit test confirms `resolvePathFromCwd` works.

### File checklist
- `packages/base-tools/package.json`
- `packages/base-tools/tsconfig.json`
- `packages/base-tools/src/index.ts`
- `packages/base-tools/src/tools/path-utils.ts`
- `packages/base-tools/src/tools/read.ts`
- `packages/base-tools/src/tools/write.ts`
- `packages/base-tools/src/tools/edit.ts`
- `packages/base-tools/src/tools/bash.ts`

### Steps

#### 4.1 Update package metadata
- Rename the package to `@merlin-agents/base-tools`.
- Update dependency on `@merlin-agents/ai`.

#### 4.2 Extend path utilities with cwd helpers
- Add `CwdLike`, `toCwdResolver`, and `resolvePathFromCwd`.
- Add `resolveReadPathFromCwd` that applies the macOS screenshot path logic.

#### 4.3 Add tool factories
- Create `createReadTool`, `createWriteTool`, `createEditTool`, `createBashTool`.
- Each factory should call `toCwdResolver` and resolve paths relative to that.
- Keep the existing `readTool`, `writeTool`, `editTool`, `bashTool` exports to preserve behavior.

#### 4.4 Add `createCodingTools`
- Export a helper that returns `[read, bash, edit, write]` bound to a given cwd.
- Keep `codingTools` as the default process.cwd()-based array.

#### 4.5 Add a real test
- Add `packages/base-tools/tests/path-utils.test.ts` and update the test script in `package.json`.
- Keep the test minimal and deterministic.

### Watch out for
- Do not capture `process.cwd()` at module import time; use `toCwdResolver`.
- `read.ts` uses `resolveReadPath` which depends on existence checks; rewire to new cwd version.

## Milestone 5: Migrate `packages/lsp`

### Goal
Keep LSP wrappers compatible with cwd-bound tools and remove implicit cwd assumptions.

### Verification
- `bun run typecheck` for `packages/lsp` passes.

### File checklist
- `packages/lsp/package.json`
- `packages/lsp/tsconfig.json`
- `packages/lsp/src/tool-wrapper.ts`

### Steps

#### 5.1 Copy the package and update merlin metadata
- Rename the package to `@merlin-agents/lsp`.
- Update dependency on `@merlin-agents/ai`.
- Confirm the `AgentTool` type still lines up.

#### 5.2 Audit cwd usage
- `wrapToolsWithLspDiagnostics` already takes `opts.cwd`.
- Ensure all file path resolution uses `opts.cwd` and not `process.cwd()`.

### Watch out for
- The current wrapper uses `params` as unknown; keep this if you are not refactoring types.

## Milestone 6: Create `packages/sdk`

### Goal
Introduce a small SDK that exposes `createMerlinAgent()` and exports config helpers.

### Verification
- `bun run typecheck` for `packages/sdk` passes.
- A simple embed example can run with tools bound to a custom cwd.

### File checklist
- `packages/sdk/package.json` (new)
- `packages/sdk/tsconfig.json` (new)
- `packages/sdk/src/config.ts` (new)
- `packages/sdk/src/merlin-agent.ts` (new)
- `packages/sdk/src/index.ts` (new)

### Steps

#### 6.1 Create the package skeleton
- Create `package.json` with name `@merlin-agents/sdk` and dependencies on `@merlin-agents/agent-core`, `@merlin-agents/ai`, `@merlin-agents/base-tools`, `@merlin-agents/lsp`.
- Add `tsconfig.json` similar to other packages.

#### 6.2 Move config logic into SDK
- Copy `apps/coding-agent/src/config.ts` into `packages/sdk/src/config.ts`.
- Update `resolveConfigDir` to use `~/.config/merlin` and update `GLOBAL_AGENTS_PATHS` accordingly.
- Change the default theme string in config from `marvin` to `merlin`.
- Replace `PROJECT_AGENTS_PATHS` with a function that uses a `cwd` parameter.
- Add `cwd?: string` to `loadAgentsConfig` and `loadAppConfig` options.
- Keep the existing behavior when `cwd` is not provided.

Suggested change shape:

```ts
const projectAgentsPaths = (cwd: string) => [
  () => path.join(cwd, "AGENTS.md"),
  () => path.join(cwd, "CLAUDE.md"),
];

export const loadAgentsConfig = async (options?: { cwd?: string }) => {
  const cwd = options?.cwd ?? process.cwd();
  const global = await loadFirstExisting(GLOBAL_AGENTS_PATHS);
  const project = await loadFirstExisting(projectAgentsPaths(cwd));
  // ...
};
```

#### 6.3 Implement the SDK agent factory
- Implement `createMerlinAgent` in `packages/sdk/src/merlin-agent.ts`.
- Use `createCodingTools(cwd)` for default tools.
- Accept a `tools` override or modifier function.
- Accept a `transport` override for advanced embedding.
- Optional LSP: only enable when explicitly requested.
- Return `{ agent, close }`, where `close` shuts down LSP and is idempotent.

Suggested shape:

```ts
export type MerlinAgentOptions = {
  cwd?: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  tools?: AgentTool<unknown, unknown>[] | ((defaults: AgentTool<unknown, unknown>[]) => AgentTool<unknown, unknown>[]);
  transport?: AgentTransport;
  lsp?: false | { enabled: true; autoInstall?: boolean };
};
```

#### 6.4 Re-export SDK surface
- In `packages/sdk/src/index.ts`, export:
  - `createMerlinAgent` and `MerlinAgentOptions`
  - `loadAgentsConfig`, `loadAppConfig`, `updateAppConfig`
  - `Agent`, `AgentTool`, `Message` types from core packages

#### 6.5 Update root typecheck script
- Add `packages/sdk/tsconfig.json` to root `typecheck` script.

### Watch out for
- SDK should not auto-load hooks or custom tools. Keep it explicit.
- Do not bake in `process.cwd()` inside SDK APIs except as default values.

## Milestone 7: Migrate `packages/open-tui` (if keeping the CLI)

### Goal
Move the UI package unchanged and make sure callers pass explicit cwd to autocomplete.

### Verification
- `bun run typecheck` for `packages/open-tui` passes.

### File checklist
- `packages/open-tui/package.json`
- `packages/open-tui/tsconfig.json`
- `packages/open-tui/src/autocomplete/autocomplete.ts`
- `packages/open-tui/src/context/theme.tsx`

### Steps

#### 7.1 Copy the package and update merlin metadata
- Rename the package to `@merlin-agents/open-tui` and update `repository.url`.
- Keep version and dependencies aligned with the old repo.

#### 7.2 Audit `CombinedAutocompleteProvider`
- It defaults `basePath` to `process.cwd()`.
- In the app, always pass `cwd` explicitly rather than relying on the default.

#### 7.3 Rename the built-in default theme
- In `packages/open-tui/src/context/theme.tsx`, rename the default theme from `marvin` to `merlin`.
- Update the in-code comment and the `availableThemes()` list to start with `merlin`.
- Keep the color palette identical so the visual output is unchanged.

### Watch out for
- `open-tui` uses `solid-js` versions pinned at the root.

## Milestone 8: Migrate `apps/coding-agent` and dogfood SDK

### Goal
Rebuild the CLI as a consumer of the SDK while keeping all existing features.

### Verification
- `bun run typecheck` for the app passes.
- `bun run merlin --help` works.
- `bun run merlin --headless "echo test"` works.

### File checklist
- `apps/coding-agent/package.json`
- `apps/coding-agent/scripts/build.ts`
- `apps/coding-agent/src/index.ts`
- `apps/coding-agent/src/headless.ts`
- `apps/coding-agent/src/tui-app.tsx`
- `apps/coding-agent/src/acp/index.ts`
- `apps/coding-agent/src/config.ts` (should become re-export only)
- `apps/coding-agent/src/session-manager.ts`
- `apps/coding-agent/src/profiler.ts`
- `apps/coding-agent/src/theme-names.ts`
- `apps/coding-agent/src/hooks/types.ts`
- `apps/coding-agent/src/hooks/loader.ts`
- `apps/coding-agent/src/custom-tools/loader.ts`
- `apps/coding-agent/src/hooks/*`
- `apps/coding-agent/src/custom-tools/*`
- `apps/coding-agent/examples/auto-compact.ts`
- `examples/hooks/*`

### Steps

#### 8.1 Update app dependencies
- Add dependency on `@merlin-agents/sdk`.
- Keep dependencies on `open-tui` and `lsp` for now.

#### 8.2 Apply merlin rename sweep inside the app
- `apps/coding-agent/package.json`: rename the package to `@merlin-agents/coding-agent` and the bin to `merlin`.
- `apps/coding-agent/scripts/build.ts`: default output file should be `~/commands/merlin`.
- `apps/coding-agent/src/index.ts`: update usage lines, config paths, and hook examples to `merlin`.
- `apps/coding-agent/src/hooks/loader.ts` and `apps/coding-agent/src/custom-tools/loader.ts`: update docstrings to `~/.config/merlin`.
- `apps/coding-agent/src/hooks/types.ts`: update comments to say `merlin` and use `merlin` in example signatures.
- `apps/coding-agent/src/session-manager.ts`: update any default config dir to `~/.config/merlin`.
- `apps/coding-agent/src/profiler.ts`: rename `MARVIN_TUI_PROFILE` to `MERLIN_TUI_PROFILE`.
- `apps/coding-agent/examples/auto-compact.ts`: rename `MARVIN_COMPACT_THRESHOLD` to `MERLIN_COMPACT_THRESHOLD`.
- `examples/hooks/*`: update parameter name and any `@marvin-agents` import to `@merlin-agents`.
- `apps/coding-agent/src/theme-names.ts`: replace the default theme name with `merlin`.
- `apps/coding-agent/src/acp/index.ts`: update agent name from "Marvin" to "Merlin".

#### 8.3 Convert `apps/coding-agent/src/config.ts` to a re-export wrapper
- Re-export `loadAgentsConfig`, `loadAppConfig`, `updateAppConfig` from the SDK.
- Keep type exports in sync.

#### 8.4 Replace manual wiring in `headless.ts`
- Instead of constructing transports and tools directly, call SDK factory.
- Keep hooks and custom tools in the app layer.
- Use `createCodingTools(cwd)` to align built-ins with the app cwd.

#### 8.5 Replace manual wiring in `tui-app.tsx`
- Use SDK factory for transport, model, and base tools.
- Keep hook loading and custom tool loading where it is.
- Wire tool list like this:
  - `builtins` from `createCodingTools(cwd)`
  - append custom tools
  - wrap with hooks and LSP
  - pass to SDK `createMerlinAgent` as `tools`

#### 8.6 Make SessionManager cwd explicit
- Right now it captures `process.cwd()` in the constructor.
- Add a constructor param for `cwd` and pass it from the app.
- Update session dir generation to use that value.

#### 8.7 Normalize cwd usage in UI
- Pass `cwd` into `CombinedAutocompleteProvider`.
- Pass `cwd` to editor open helpers.

### Watch out for
- `apps/coding-agent/scripts/build.ts` still expects Solid plugin and worker path.
- Do not change the TUI render pipeline while migrating; keep behavior stable.

## Milestone 9: Legacy compatibility (optional)

### Goal
Offer a smooth path for existing marvin users to migrate into the merlin config layout.

### Verification
- `rg "marvin"` only returns intentional legacy paths.
- Running `merlin migrate` (if you add it) copies config without deleting the old directory.

### Steps

#### 9.1 Add legacy config detection (SDK-level)
- If `~/.config/merlin` is missing but `~/.config/marvin` exists, emit a warning.
- Keep config reads and writes on the merlin path; do not silently write to legacy.

#### 9.2 Add an explicit migration command (CLI-level)
- Add `merlin migrate` to copy `~/.config/marvin` to `~/.config/merlin`.
- Keep it copy-only (never delete the old config).

#### 9.3 Keep token migration in Codex auth helper
- In `packages/agent/src/codex-auth-cli.ts`, keep legacy token file detection.
- If found, re-save into the new config dir and leave the old file alone if you want a safe upgrade.

### Watch out for
- Avoid auto-migrating on startup; always ask for an explicit command.
- Never delete legacy config paths automatically.

## Testing strategy

### Package-level checks
- `bun run typecheck` at root after each package is moved.
- `bun run test` at root after each milestone.

### SDK manual checks
- Create a small scratch script that calls `createMerlinAgent` with `cwd` pointing to a different repo and run `read` and `bash` tools.
- Validate that tool paths resolve against the provided cwd, not the current process cwd.

### CLI manual checks
1. `bun run merlin --help`
2. `bun run merlin --headless "echo test"`
3. Run the TUI, open autocomplete, and confirm file suggestions are from the active cwd.

## Troubleshooting quick hits
- If `bun run typecheck` fails because of missing generated models, run the generator or copy `src/models.generated.ts`.
- If Codex instructions fail to cache, confirm the cacheDir exists and is writable.
- If LSP diagnostics do not appear, confirm that `wrapToolsWithLspDiagnostics` wraps `write` and `edit` tools in the final tool list.

## Beyond the basics (optional enhancements)
- Add tests for cwd-bound `bash` and `read` tools using temporary directories.
- Add explicit `cwd` support to `HookRunner` and `loadCustomTools` if you want to embed hooks in the SDK later.
- Add a small example package that demonstrates the SDK usage in a separate repo.

## Quick reference

### Commands you will use
```
bun install
bun run typecheck
bun run test
bun run merlin --help
bun run merlin --headless "echo test"
```

### Files you will touch most
1. `packages/base-tools/src/tools/path-utils.ts`
2. `packages/base-tools/src/tools/read.ts`
3. `packages/base-tools/src/tools/write.ts`
4. `packages/base-tools/src/tools/edit.ts`
5. `packages/base-tools/src/tools/bash.ts`
6. `packages/sdk/src/config.ts`
7. `packages/sdk/src/merlin-agent.ts`
8. `apps/coding-agent/src/headless.ts`
9. `apps/coding-agent/src/tui-app.tsx`
10. `apps/coding-agent/src/index.ts`
11. `apps/coding-agent/package.json`
12. `apps/coding-agent/scripts/build.ts`
13. `apps/coding-agent/src/config.ts`

### Useful references in the old repo
- `apps/coding-agent/src/config.ts` for config parsing and AGENTS.md merge
- `apps/coding-agent/src/index.ts` for CLI usage text and help output
- `apps/coding-agent/src/tui-app.tsx` for full wiring path
- `packages/base-tools/src/index.ts` for tool export shape
- `packages/agent/src/transports/CodexTransport.ts` for transport wiring
- `packages/open-tui/src/context/theme.tsx` for the built-in theme name and defaults

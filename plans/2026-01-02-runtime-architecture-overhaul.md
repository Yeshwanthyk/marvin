# Runtime & UI Architecture Overhaul Implementation Plan

## Plan Metadata
- Created: 2026-01-02
- Ticket: none
- Status: draft
- Owner: yesh
- Assumptions:
  - Bun remains the runtime, and Solid JSX compilation still requires the OpenTUI plugin.
  - External hooks/tools created by users must continue to run unchanged; new validation layers must be opt-in or backward-compatible.
  - Desktop/Tauri adapter can adopt the same runtime factory later but is out of scope here.

## Progress Tracking
- [x] Phase 1: Layered Runtime Foundations
- [x] Phase 2: TUI Feature Split
- [x] Phase 3: Command & Extensibility Modularization
- [x] Phase 4: Testing, Automation, and Documentation

## Overview
Reorganize `apps/coding-agent/src` into explicit layers, extract a shared runtime factory consumed by both TUI and headless entrypoints, decompose the monolithic TUI into composable feature slices with clear UI state modules, modularize slash commands and extensibility contracts with schema validation, and add the integration tests + contributor docs required to keep the architecture healthy.

## Current State
`src/` mixes adapters, runtime, UI, and utilities at one depth (`apps/coding-agent/src/index.ts`, `headless.ts`, `runtime/`, `hooks/`, `components/`), forcing global knowledge to change any feature. TUI orchestration in `tui-app.tsx` (~650 LOC, see `apps/coding-agent/src/tui-app.tsx:1-640`) combines runtime setup, session logic, UI rendering, and keyboard handling. Slash commands live in one monolithic handler (`apps/coding-agent/src/commands.ts:21-360`), and low-level helpers (git, clipboard, diff parsing, tool extraction) are co-located (`apps/coding-agent/src/utils.ts:1-170`). Runtime setup is duplicated between `runtime/create-runtime.ts:1-210` and `headless.ts:1-210`. Tests only cover isolated helpers, with no CLI/runtime integration, and docs focus on usage rather than architecture.

### Key Discoveries
- **Monolithic TUI shell**: `apps/coding-agent/src/tui-app.tsx:1-420` mounts provider, sets up session controller, handles slash commands, keyboard, renderer hooks, and UI layout in one module, blocking encapsulation.
- **Duplicated runtime bootstrap**: `apps/coding-agent/src/runtime/create-runtime.ts:10-200` and `apps/coding-agent/src/headless.ts:10-200` both load config, hooks, transports, LSP, and custom tools independently; divergence risk is high.
- **Commands entangled with context**: `apps/coding-agent/src/commands.ts:21-333` defines `CommandContext`, helper functions, and every slash command implementation together, so extending commands requires editing shared switches plus manual test wiring.
- **Catch-all utilities**: `apps/coding-agent/src/utils.ts:1-150` covers git detection, OSC52 clipboard copy, diff formatting, token extraction, and session helper logic, so unrelated imports drag entire helper bundles into consumers.
- **Sparse integration tests**: `apps/coding-agent/tests` lacks coverage for CLI args, runtime creation, session persistence, or ACP/TUI parity (`tests/commands.test.ts`, `tests/utils.test.ts`, etc. only verify pure functions).

## Desired End State
- Source tree reflects adapters (`adapters/cli`, `adapters/tui`, `adapters/acp`), runtime services (`runtime/agent`, `runtime/session`, `runtime/extensibility`), domain modules (`domain/commands`, `domain/messaging`), and UI components/libraries with minimal cross-layer imports.
- Shared runtime factory composes config load, hooks, custom tools, transports, and LSP wiring once, then adapters (TUI/headless/ACP) consume it; differences are expressed through adapter-specific presenters.
- TUI app is split into App shell (runtime bridge), state modules (prompt queue, session controller, tool inspector), and presentation components (Header, Footer, MessagePane, Composer, Toasts). Each slice exposes clear props/events to reduce coupling.
- Slash commands live in `commands/` with per-command modules + registry; headless or future adapters can reuse command logic. Commands can be tested individually.
- Custom hooks/tools/commands get schema-level validation (TypeBox schema + `marvin validate`) and surface errors in UI, not just stderr.
- Integration tests cover CLI argument parsing, runtime creation, TUI reducers, and ACP parity. Automation enforces folder conventions and ensures new commands/tools register via generator scripts.
- Architecture docs describe runtime lifecycle, directory layout, naming conventions, and extension points; contributors can follow diagrams.

### Verification
- Automated: `bun run typecheck`, `bun run test`, new CLI regression suite (`bun run test apps/coding-agent/tests/runtime-cli.test.ts`), plus lint/generator checks.
- Manual: `marvin --help`, `marvin --headless "ping"`, TUI smoke test verifying prompts, slash commands, and tool expansion, plus `marvin validate` on sample hooks/tools.

## Out of Scope
- Desktop/Tauri adapter refactor (will leverage shared runtime later).
- MCP or remote execution support.
- Overhauling provider transports beyond wiring them through the runtime factory.

## Breaking Changes
- Public CLI/API stays backward compatible. Internally, module paths change but exported behavior is preserved.
- JSON schema validation is additive but surfaces errors earlier; existing misconfigured hooks/tools may now show UI validation errors while still allowing bypass via `--no-validate` flag.
- Session log format remains backward compatible (no structural changes planned in this effort).

## Dependency and Configuration Changes

### Additions
```bash
bun add --dev @sinclair/typebox@0.34.x (already root dep) # leverage for schema validation across packages
```
**Why needed**: Reuse TypeBox schemas for slash command manifests and user extensibility validation (already in root; no new install necessary, but emphasize shared usage).

### Updates
```bash
bun add --dev eslint-plugin-boundaries@^3.5.0
```
**Breaking changes**: None; configure to warn when modules cross layer boundaries. Enforcement staged (warn -> error).

### Removals
_None._

### Configuration Changes
**File**: `apps/coding-agent/tsconfig.json`

**Before**:
```json
{
  "compilerOptions": {
    "rootDir": "src"
  }
}
```

**After**:
```json
{
  "compilerOptions": {
    "rootDir": "src",
    "paths": {
      "@adapters/*": ["src/adapters/*"],
      "@runtime/*": ["src/runtime/*"],
      "@domain/*": ["src/domain/*"],
      "@ext/*": ["src/extensibility/*"],
      "@ui/*": ["src/ui/*"]
    }
  }
}
```
**Impact**: Improves import clarity; ensure ESLint + tsconfig references updated accordingly.

## Error Handling Strategy
- Shared runtime factory must bubble configuration/hook/tool validation errors back through adapter-specific reporters (stderr for headless, toast/log for TUI) without crashing process.
- Slash command registry returns structured errors; TUI surfaces message toast, headless writes JSON error block.
- Schema validation failures provide actionable messages (path + reason) and instructions to bypass via `marvin validate --fix`.
- Runtime factory guards LSP failures (auto-install) and cleans up processes on adapter exit.

## Implementation Approach
1. Establish new directory structure + module aliases, move service-style hooks (session controller, prompt queue) under `runtime/session/` and convert into plain services.
2. Extract a shared runtime builder (`runtime/factory.ts`) powering both TUI (`adapters/tui/app.tsx`) and headless (`adapters/cli/headless.ts`) entrypoints, factoring Codex token management/hook wiring into helper modules.
3. Refactor TUI into App shell and feature components, ensuring App only wires runtime state and delegates rendering to `ui/features/*` with typed props.
4. Create `domain/commands/` with per-command modules + registry, plus `extensibility/{hooks,tools}/` with schema validators and improved error reporting.
5. Layer testing/automation: CLI runtime smoke tests, TUI reducer tests with Solid test harness, ACP parity tests, ESLint boundaries, and plan architecture docs in `apps/coding-agent/docs/architecture.md`.

## Phase Dependencies and Parallelization
- **Phase 1 → Phase 2/3**: Must complete directory moves + runtime factory before UI/command refactors to avoid thrash.
- **Phase 2 & Phase 3**: Can proceed in parallel once runtime factory exists; ensure shared command registry hooking is coordinated.
- **Phase 4**: Depends on previous phases for updated modules to test/document; some doc work can start mid-way.
- Parallelizable tasks: documentation drafting during testing, ESLint boundary rules after directory layout finalizes, integration test harness prepping during Phase 2.

---

## Phase 1: Layered Runtime Foundations

### Overview
Create the new directory layout, move service-style modules into runtime/domain folders, and implement a reusable runtime factory that unifies TUI/headless setup.

### Prerequisites
- [x] Confirm target directory names/aliases with repo maintainers (adapters/runtime/domain/extensibility/ui).
- [x] Ensure no outstanding PRs modify `apps/coding-agent/src/runtime` or `headless.ts`.

### Change Checklist
- [x] Introduce `src/adapters/cli`, `src/adapters/tui`, `src/adapters/acp`, `src/runtime/{factory,session,extensibility}`, `src/domain/commands`, `src/domain/messaging`, `src/ui` directories.
- [x] Move `hooks/useSessionController.ts`, `hooks/usePromptQueue.ts` into `runtime/session/` and convert to framework-agnostic services.
- [x] Extract `runtime/create-runtime.ts` + duplication in `headless.ts` into `runtime/factory.ts` exposing `createRuntime({ adapter })`.
- [x] Add Codex token + provider transport wiring helpers under `runtime/transport/` and share across adapters.
- [x] Update `headless.ts`, `tui-app.tsx`, and ACP entrypoints to consume the new factory.

### Changes

#### 1. Directory & import alias bootstrap
**File**: `apps/coding-agent/tsconfig.json`

**Before**:
```json
{
  "compilerOptions": {
    "baseUrl": "src"
  }
}
```

**After**:
```json
{
  "compilerOptions": {
    "baseUrl": "src",
    "paths": {
      "@adapters/*": ["adapters/*"],
      "@runtime/*": ["runtime/*"],
      "@domain/*": ["domain/*"],
      "@ext/*": ["extensibility/*"],
      "@ui/*": ["ui/*"]
    }
  }
}
```
**Why**: Enables clean imports once files move.

#### 2. Session controller relocation
**File**: `apps/coding-agent/src/hooks/useSessionController.ts`

**Before** (excerpt):
```ts
export function createSessionController(options: SessionControllerOptions): SessionControllerState {
  let sessionStarted = false
  // Solid-specific signal setters passed in
}
```

**After**:
```ts
// File moved to runtime/session/session-controller.ts
export function createSessionController(options: SessionControllerOptions): SessionControllerState {
  let sessionStarted = false
  // Replace Solid setters with adapter-agnostic callbacks (e.g., `options.onMessages`)
}
```
**Why**: Treat session controller as runtime service so TUI/headless share logic.

#### 3. Runtime factory creation
**File**: `apps/coding-agent/src/runtime/factory.ts` (new)

**After**:
```ts
import { createProviderTransports } from "@runtime/transport"
import { loadHooksAndTools } from "@runtime/extensibility"

export interface RuntimeContext {
  agent: Agent
  sessionManager: SessionManager
  hookRunner: HookRunner
  toolRegistry: ToolRegistry
  lsp: LspManager
  config: LoadedAppConfig
}

export async function createRuntime(args: RuntimeInitArgs, adapter: "tui" | "headless" | "acp"): Promise<RuntimeContext> {
  const config = await loadAppConfig(args)
  const { hookRunner, customTools } = await loadHooksAndTools(config, adapter)
  const transports = createProviderTransports(config)
  // Assemble Agent + SessionManager once
}
```
**Why**: Single source of truth for runtime wiring.

#### 4. Headless entrypoint refactor
**File**: `apps/coding-agent/src/headless.ts`

**Before**:
```ts
const loaded = await loadAppConfig(...)
const providerTransport = new ProviderTransport(...)
const { hooks } = await loadHooks(...)
...
const agent = new Agent({ ...tools })
```

**After**:
```ts
import { createRuntime } from "@runtime/factory"

export const runHeadless = async (args: HeadlessArgs) => {
  const runtime = await createRuntime({ ...args }, "headless")
  const promptText = await resolvePrompt(args)
  await runtime.agent.prompt(promptText)
  // Use runtime.hookRunner + sessionManager for persistence
}
```
**Why**: Eliminates duplicated bootstrap logic.

#### 5. Utilities split
**File**: `apps/coding-agent/src/utils.ts`

**Before**: Git helpers, clipboard OSC52, diff/text extraction co-reside.

**After**: Create `runtime/git/git-info.ts`, `ui/clipboard/osc52.ts`, `domain/messaging/content-utils.ts`; update importers accordingly.

### Edge Cases to Handle
- [ ] Ensure moving modules preserves named exports for compatibility (barrel files re-export old paths until adapters updated).
- [ ] Manage cyclic deps when splitting utils; use dependency graph check before finalizing.
- [ ] Headless mode lacks UI send handler; factory must accept adapter hooks for send semantics.

### Success Criteria
**Automated**:
```bash
bun run typecheck
bun run test apps/coding-agent/tests/commands.test.ts
```
**Before proceeding**:
```bash
marvin --help
marvin --headless "ping"
```
**Manual**:
- [ ] Launch TUI; verify session load + prompt works after runtime changes.

### Rollback
```bash
git restore -- apps/coding-agent/src/{runtime,headless.ts,tui-app.tsx,hooks,useSessionController.ts}
```

### Notes
- Keep temporary re-export files (e.g., `hooks/useSessionController.ts` exporting from new location) to minimize churn until Phase 2 completes.

---

## Phase 2: TUI Feature Split

### Overview
Decompose `tui-app.tsx` into App shell + feature components, introduce explicit UI state modules, and push runtime interactions into hooks/services that can be tested separately.

### Prerequisites
- [x] Phase 1 runtime factory and directory layout merged.
- [x] Solid plugin configuration confirmed (no regression while moving TSX files).

### Change Checklist
- [x] Move TUI adapter to `src/adapters/tui/app.tsx` and limit responsibility to mounting providers + wiring runtime context.
- [x] Extract `MainView`, `Composer`, `MessagePane`, `ToolSidebar`, `StatusHeader`, `Footer`, `ToastViewport`, etc., into `src/ui/features/*`.
- [x] Replace inline prompt queue/session logic with services from `@runtime/session`.
- [x] Introduce `ui/state/app-store.ts` (solid signals or simple store) describing UI state transitions; renderer components subscribe to store slices only.
- [x] Relocate keyboard handler + shell command wiring to dedicated modules per feature.

### Changes

#### 1. App shell extraction
**File**: `apps/coding-agent/src/tui-app.tsx`

**Before**:
```ts
export const runTuiOpen = async (args?: RunTuiArgs) => {
  const runtime = await createRuntime(args)
  render(() => (
    <RuntimeProvider runtime={runtime}>
      <App initialSession={initialSession} />
    </RuntimeProvider>
  ))
}
```

**After**:
```ts
// adapters/tui/app.tsx
export const runTui = async (args?: RunTuiArgs) => {
  const runtime = await createRuntime(args, "tui")
  render(() => <TuiRoot runtime={runtime} />)
}
```
**Why**: Aligns naming with adapter-based layout.

#### 2. Feature module creation
**File**: `apps/coding-agent/src/ui/features/message-pane/MessagePane.tsx`

**After** (new):
```tsx
export function MessagePane(props: MessagePaneProps) {
  return (
    <scrollbox>
      <MessageList {...props} />
    </scrollbox>
  )
}
```
**Why**: Separate presentational logic from app state.

#### 3. App store introduction
**File**: `apps/coding-agent/src/ui/state/app-store.ts`

**After**:
```ts
interface AppState { messages: UIMessage[]; toolBlocks: ToolBlock[]; activity: ActivityState; }
export function createAppStore(initial: AppState) {
  const [messages, setMessages] = createSignal(initial.messages)
  // expose setter wrappers consumed by runtime session services
}
```
**Why**: Provides central state management for UI features.

#### 4. Slash command wiring move
**File**: `apps/coding-agent/src/ui/features/composer/SlashCommandHandler.ts`

**After**:
```ts
export function createSlashCommandHandler(ctx: CommandBridge) {
  return async (input: string) => {
    if (!input.startsWith("/")) return false
    if (await ctx.commandRegistry.execute(input)) return true
    return ctx.customCommandExpander.try(input)
  }
}
```
**Why**: Prepares for Phase 3 registry.

### Edge Cases to Handle
- [ ] Ensure Solid signal usage stays within components; runtime services remain framework-agnostic.
- [ ] Preserve keyboard shortcuts + shell injection behavior when moving composer.
- [ ] Validate toast manager + editor bridge still receive correct refs during extraction.

### Success Criteria
**Automated**:
```bash
bun run test apps/coding-agent/tests/ui-message-list.test.ts
bun run typecheck apps/coding-agent/tsconfig.json
```
**Before proceeding**:
```bash
bun run marvin  # run TUI, verify prompt + slash command
```
**Manual**:
- [ ] Add message, run `/theme`, `/model`, shell command injection; ensure UI updates correctly.

### Rollback
```bash
git restore -- apps/coding-agent/src/{tui-app.tsx,ui}
```

### Notes
- Keep `components/Header.tsx`, etc., until new feature modules fully replace them; delete after integration tests pass.

---

## Phase 3: Command & Extensibility Modularization

### Overview
Modularize slash commands, add schema validation for custom hooks/tools/commands, surface validation via UI/toasts, and add `marvin validate` CLI entry.

### Prerequisites
- [ ] Runtime factory + UI slices in production.
- [ ] Agreement on validation UX (blocking vs warning) with maintainers.

### Change Checklist
- [ ] Introduce `src/domain/commands/registry.ts` plus per-command modules under `src/domain/commands/builtin/`.
- [ ] Refactor existing `commands.ts` into modules (e.g., `model.ts`, `theme.ts`, `compact.ts`) and export typed handlers.
- [ ] Add `extensibility/schema.ts` (TypeBox definitions) for hooks/tools/commands; integrate into loader to validate manifests at load time.
- [ ] Implement `marvin validate` CLI (under `adapters/cli/validate.ts`) to preflight user extensibility directories.
- [ ] Update TUI + headless adapters to display validation findings (toast + stderr summary) without crashing.

### Changes

#### 1. Command registry
**File**: `apps/coding-agent/src/domain/commands/registry.ts`

**After**:
```ts
export interface CommandDefinition {
  name: string
  aliases?: string[]
  execute: (args: string, ctx: CommandContext) => Promise<boolean> | boolean
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>()
  register(def: CommandDefinition) { ... }
  async execute(input: string, ctx: CommandContext) { ... }
}
```
**Why**: Decouples command lookups from switch statements.

#### 2. Slash command module example
**File**: `apps/coding-agent/src/domain/commands/builtin/model.ts`

**After**:
```ts
export const modelCommand: CommandDefinition = {
  name: "model",
  async execute(args, ctx) {
    // reused logic moved from commands.ts
  }
}
```
**Why**: Each command is self-contained and testable.

#### 3. Loader validation
**File**: `apps/coding-agent/src/extensibility/tools/loader.ts`

**Before**: Only dynamic import, no schema validation.

**After**:
```ts
import { toolSchema } from "@ext/schema"

const validation = toolSchema.safeParse(tool)
if (!validation.success) {
  errors.push({ path: toolPath, error: formatErrors(validation.error) })
  continue
}
```
**Why**: Surface typed errors before runtime use.

#### 4. `marvin validate` CLI
**File**: `apps/coding-agent/src/adapters/cli/validate.ts`

**After**:
```ts
import { validateCommands, validateHooks, validateTools } from "@ext/validate"

export async function runValidate(args: ValidateArgs) {
  const results = await Promise.all([
    validateCommands(args.configDir),
    validateHooks(args.configDir),
    validateTools(args.configDir),
  ])
  formatAndExit(results)
}
```
**Why**: Users can preflight configs without launching TUI.

### Edge Cases to Handle
- [ ] Custom commands lacking description should still load but produce warnings.
- [ ] Validation errors must not crash runtime; TUI surfaces toast with `View details (/logs)` hint.
- [ ] Headless mode uses JSON output, so include `validationErrors` field in response.

### Success Criteria
**Automated**:
```bash
bun run test apps/coding-agent/tests/commands-registry.test.ts
bun run test apps/coding-agent/tests/extensibility-validation.test.ts
```
**Manual**:
- [ ] Create malformed tool manifest; run `marvin validate` and confirm error.
- [ ] Launch TUI with bad hook; toast displays actionable message.

### Rollback
```bash
git restore -- apps/coding-agent/src/{domain/commands,extensibility,adapters/cli/validate.ts}
```

### Notes
- Keep compatibility layer (`src/commands.ts` re-export) until all imports updated; remove after Phase 3.

---

## Phase 4: Testing, Automation, and Documentation

### Overview
Add integration/regression tests for adapters and runtime, enforce architectural boundaries, and document the architecture.

### Prerequisites
- [ ] Phases 1-3 merged.

### Change Checklist
- [ ] Add CLI smoke tests (`tests/runtime-cli.test.ts`) covering `marvin --help`, `--headless`, `--acp` handshake.
- [ ] Create runtime integration tests instantiating `createRuntime` with mock transports.
- [ ] Add UI reducer/component tests (Solid harness) for `MessageList`, `prompt queue`, `tool inspector`.
- [ ] Configure ESLint/Boundaries to enforce allowed import paths across layers; add CI job verifying tree.
- [ ] Author `apps/coding-agent/docs/architecture.md` (or update existing doc) describing new structure, runtime lifecycle, and extension points; include diagrams + naming conventions.

### Changes

#### 1. CLI smoke test
**File**: `apps/coding-agent/tests/runtime-cli.test.ts`

**After**:
```ts
import { spawnSync } from "node:child_process"

describe("marvin CLI", () => {
  it("prints help", () => {
    const { stdout, status } = spawnSync("bun", ["apps/coding-agent/src/index.ts", "--help"], { env: { ... } })
    expect(status).toBe(0)
    expect(stdout.toString()).toContain("Usage:")
  })
})
```
**Why**: Regression coverage for CLI flag parsing.

#### 2. ESLint boundaries
**File**: `.eslintrc.js`

**After**:
```js
plugins: ["boundaries"],
settings: {
  "boundaries/elements": [
    { type: "adapters", pattern: "apps/coding-agent/src/adapters/*" },
    { type: "runtime", pattern: "apps/coding-agent/src/runtime/*" },
    ...
  ]
},
rules: {
  "boundaries/element-types": ["error", {
    message: "Adapters must not import from adapters", ...
  }]
}
```
**Why**: Prevents future layer leakage.

#### 3. Documentation
**File**: `apps/coding-agent/docs/architecture.md`

**Before**: High-level overview (existing doc in repo root but not adapter-specific).

**After**: Add sections for runtime lifecycle, directory layout, extension validation, command registry, and diagrams aligning with new structure.

### Edge Cases to Handle
- [ ] Tests must run offline (use mocks for provider transports + LSP).
- [ ] ESLint should warn initially; flip to error once codebase conforms.

### Success Criteria
**Automated**:
```bash
bun run check
```
**Manual**:
- [ ] Validate documentation by onboarding a new contributor (dry run) or at least walking through doc verifying steps.

### Rollback
```bash
git restore -- apps/coding-agent/tests apps/coding-agent/docs/architecture.md .eslintrc.js
```

### Notes
- Update `README.md` to link to new architecture doc + validation command.

---

## Testing Strategy

### Unit Tests to Add/Modify
**File**: `apps/coding-agent/tests/domain/commands/model.test.ts`
```ts
describe("/model command", () => {
  it("switches provider/model", async () => {
    const ctx = createMockCommandContext()
    await modelCommand.execute("anthropic claude-3-sonnet", ctx)
    expect(ctx.agent.setModel).toHaveBeenCalled()
  })
})
```

### Integration Tests
- [ ] `tests/runtime-cli.test.ts`: spawn CLI with `--headless` and assert JSON output shape.
- [ ] `tests/runtime-factory.test.ts`: instantiate factory with mock providers to ensure hooks/tools load once.
- [ ] `tests/tui-store.test.tsx`: render `AppStore` + `MessagePane` with Solid tests verifying streaming updates.
- [ ] `tests/extensibility-validation.test.ts`: load malformed hook/tool and assert schema error surfaced.

### Manual Testing Checklist
1. [ ] Run `marvin` TUI, verify new layout + slash commands.
2. [ ] Run `marvin --headless "hello"` and confirm JSON result unaffected.
3. [ ] Run `marvin --acp` and connect from Zed (ensure runtime factory handles ACP adapter).
4. [ ] Validate custom tool manifest via `marvin validate` (expected failure + success cases).
5. [ ] Trigger UI toast from hook validation error and ensure message describes fix.
6. [ ] Confirm ESC abort + shell injection still work after composer refactor.

## Deployment Instructions

### Database Migrations
_Not applicable._

### Feature Flags
- Flag name: `tui_runtime_refactor`
- Rollout plan: hidden flag for canary (internal use) while TUI split stabilizes; remove post-stabilization.
- Removal: After Phase 2 + 3 pass regression tests, delete flag + dead code.

### Environment Variables
_Add to `.env` / config (optional for validation severity):_
```bash
MARVIN_VALIDATE_STRICT=true  # treat schema warnings as blocking
```

### Deployment Order
1. Merge Phase 1 runtime factory + layout (behind feature flag if needed).
2. Deploy CLI release with shared runtime + `marvin validate` (ensures headless users benefit quickly).
3. Enable TUI refactor flag for internal users, monitor metrics/logs.
4. Once stable, flip flag globally and remove legacy modules.

## Anti-Patterns to Avoid
- Allowing adapters to import other adapters; enforce via ESLint boundaries.
- Keeping catch-all `utils.ts`; ensure utilities live next to domain usage.
- Mixing UI state updates with runtime services; App store should mediate.
- Writing tests that hit real providers/LSP; use mocks for determinism.

## Open Questions (must resolve before implementation)
- [ ] None (all constraints addressed in plan).

## References
- `apps/coding-agent/src/tui-app.tsx:1-640`
- `apps/coding-agent/src/runtime/create-runtime.ts:1-210`
- `apps/coding-agent/src/headless.ts:1-210`
- `apps/coding-agent/src/commands.ts:21-360`
- `apps/coding-agent/src/utils.ts:1-170`
- `docs/architecture.md`

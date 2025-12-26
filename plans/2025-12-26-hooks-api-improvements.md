# Hooks API Improvements Implementation Plan

## Overview
Improve Marvin’s hooks API with dependency clarity, configurable discovery/timeout, attachment-aware `send`, and error-aware tool hook emissions while keeping existing event names.

## Current State
Hooks are global-only, have a narrow API surface, and can’t observe tool errors.

### Key Discoveries
- Hooks load only from `~/.config/marvin/hooks/*.ts` via `loadHooks(configDir)`; no project-local or configured paths. `apps/coding-agent/src/hooks/loader.ts:113`.
- `HookAPI.send` accepts only text and `HookEventContext` only exposes `exec`, `cwd`, `configDir`. `apps/coding-agent/src/hooks/types.ts:28` and `apps/coding-agent/src/hooks/types.ts:167`.
- Hook timeout is hardcoded to 5s. `apps/coding-agent/src/hooks/runner.ts:20`.
- `tool.execute.after` only fires on success and always sets `isError: false`. `apps/coding-agent/src/hooks/tool-wrapper.ts:46`.
- TUI connects `send()` to `handleSubmit(text)` with no attachments. `apps/coding-agent/src/tui-app.tsx:376` and `apps/coding-agent/src/tui-app.tsx:408`.
- Config has no hooks section. `apps/coding-agent/src/config.ts:65`.
- Docs instruct `import type { HookAPI } from "@marvin-agents/coding-agent"` and don’t mention hook dependencies. `apps/coding-agent/README.md` Hooks section.

## Desired End State
- Hooks load from global, project-local, and configured paths with dedupe.
- Hook timeout is configurable in `config.json`.
- `send()` supports attachments end-to-end.
- `tool.execute.after` runs for error paths with `isError: true` and error content.
- Docs clearly describe hook dependencies (installing packages in hooks dir or path-based hooks) and the canonical import path for Hook types.

## Out of Scope
- New lifecycle events (`branch/new/switch/shutdown`).
- UI prompt APIs (select/confirm/input) for hooks.
- Hook sandboxing or permission gates.

## Dependency Story (explicit)
- Hooks are regular TS modules; dependency resolution follows Node/Bun rules relative to the hook file.
- We will document that `~/.config/marvin/hooks` should be initialized as an npm package and install `@marvin-agents/coding-agent` (or `@marvin-agents/coding-agent/hooks`) for type imports.
- Project-local hooks can instead live under a repo with its own `node_modules` so they resolve dependencies naturally.

## Error Handling Strategy
- Hook load/import errors stay non-fatal and are surfaced with file path context.
- `tool.execute.before` errors continue to block execution (fail-safe).
- `tool.execute.after` errors are logged and ignored; they do not override tool results.
- For tool execution failures, emit a `tool.execute.after` event with `isError: true` and error text content, then rethrow so the agent loop still marks the tool call as error.

## Implementation Approach
- Add a `hooks` config section (`paths`, `timeoutMs`) in `config.json` parsing and wire it into `loadHooks` + `HookRunner`.
- Extend the hook loader to discover global + project-local hooks plus configured paths with `~` expansion and dedupe.
- Make `HookAPI.send` attachment-aware and thread attachments through `HookRunner` into TUI/agent prompt.
- Emit `tool.execute.after` on errors in the wrapper without changing agent error semantics.
- Update docs + CLI help to reflect dependencies, hook paths, and timeout config.

### Alternative Approaches Considered
- **New `@marvin-agents/hooks` package:** Cleaner separation but adds a new published package. Rejected for now to keep the dependency surface minimal.
- **Adding a hook UI API:** Useful but requires new UI components; deferred to avoid scope creep.

---

## Phase 0: Publishable Hook Entrypoint (Dependency Prereq)

### Overview
Ensure hooks have a stable import path from a published package (so hook files can `import type { HookAPI }` without reaching into app internals).

### Prerequisites
- [ ] `@marvin-agents/coding-agent` (or equivalent) is published.

### Changes

#### 1. Export hook types from published package
**File**: `apps/coding-agent/package.json`
**Lines**: 1-32

**Before**
```json
{
  "name": "@marvin-agents/coding-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "marvin": "./src/index.ts"
  }
}
```

**After**
```json
{
  "name": "@marvin-agents/coding-agent",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "marvin": "./dist/index.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./hooks": {
      "types": "./dist/hooks/index.d.ts",
      "import": "./dist/hooks/index.js"
    },
    "./package.json": "./package.json"
  }
}
```

**Why**: Provides a stable, published dependency path for hook types (`@marvin-agents/coding-agent/hooks`).

> If publishing already handled elsewhere, confirm the `./hooks` export exists and skip this phase.

---

## Phase 1: Hook Discovery + Configurable Timeout

### Overview
Add hook config parsing, project-local hooks, and configurable timeout.

### Prerequisites
- [ ] Phase 0 complete or confirmed.

### Changes

#### 1. Add hooks config to app config
**File**: `apps/coding-agent/src/config.ts`
**Lines**: 65-236

**Before**
```ts
export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  theme: string;
  editor?: EditorConfig;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
  lsp: { enabled: boolean; autoInstall: boolean };
}
```

**After**
```ts
export interface HooksConfig {
  paths: string[];
  timeoutMs: number;
}

export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  theme: string;
  editor?: EditorConfig;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
  lsp: { enabled: boolean; autoInstall: boolean };
  hooks: HooksConfig;
}
```

**Why**: Centralize hook path and timeout config.

#### 2. Parse hook config from `config.json`
**File**: `apps/coding-agent/src/config.ts`
**Lines**: 144-235

**Before**
```ts
  const rawConfig = (await readJsonIfExists(configPath)) ?? {};
  const rawObj = typeof rawConfig === 'object' && rawConfig !== null ? (rawConfig as Record<string, unknown>) : {};
```

**After**
```ts
  const rawConfig = (await readJsonIfExists(configPath)) ?? {};
  const rawObj = typeof rawConfig === 'object' && rawConfig !== null ? (rawConfig as Record<string, unknown>) : {};

  const hooksRaw = rawObj.hooks as Record<string, unknown> | undefined;
  const hookPaths = Array.isArray(hooksRaw?.paths)
    ? hooksRaw!.paths.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  const hookTimeoutMs = typeof hooksRaw?.timeoutMs === "number" && hooksRaw!.timeoutMs > 0
    ? hooksRaw!.timeoutMs
    : 5000;
```

**Why**: Surface configured paths and timeout.

#### 3. Return hooks config in `loadAppConfig`
**File**: `apps/coding-agent/src/config.ts`
**Lines**: 223-235

**Before**
```ts
  return {
    provider,
    modelId: model.id,
    model,
    thinking,
    theme,
    editor,
    systemPrompt,
    agentsConfig,
    configDir,
    configPath,
    lsp,
  };
```

**After**
```ts
  return {
    provider,
    modelId: model.id,
    model,
    thinking,
    theme,
    editor,
    systemPrompt,
    agentsConfig,
    configDir,
    configPath,
    lsp,
    hooks: { paths: hookPaths, timeoutMs: hookTimeoutMs },
  };
```

**Why**: Make hook config available to `headless.ts` and `tui-app.tsx`.

#### 4. Add discovery for project-local + configured paths
**File**: `apps/coding-agent/src/hooks/loader.ts`
**Lines**: 94-139

**Before**
```ts
export async function loadHooks(configDir: string): Promise<LoadHooksResult> {
  const hooks: LoadedHook[] = []
  const errors: Array<{ path: string; error: string }> = []

  const hooksDir = join(configDir, "hooks")
  const paths = discoverHooksInDir(hooksDir)

  for (const hookPath of paths) {
    const { hook, error } = await loadHook(hookPath)
    ...
  }

  return { hooks, errors }
}
```

**After**
```ts
export async function discoverAndLoadHooks(options: {
  configDir: string;
  cwd: string;
  configuredPaths: string[];
}): Promise<LoadHooksResult> {
  const hooks: LoadedHook[] = []
  const errors: Array<{ path: string; error: string }> = []
  const seen = new Set<string>()

  const addPaths = (paths: string[]) => {
    for (const p of paths) {
      const resolved = path.resolve(p)
      if (!seen.has(resolved)) {
        seen.add(resolved)
        allPaths.push(p)
      }
    }
  }

  const globalDir = join(options.configDir, "hooks")
  const projectDir = join(options.cwd, ".marvin", "hooks")

  addPaths(discoverHooksInDir(globalDir))
  addPaths(discoverHooksInDir(projectDir))
  addPaths(options.configuredPaths.map((p) => resolveHookPath(p, options.cwd)))

  for (const hookPath of allPaths) {
    const { hook, error } = await loadHook(hookPath)
    ...
  }

  return { hooks, errors }
}
```

**Why**: Enables project-local hooks and configured hook paths with dedupe.

#### 5. Wire new loader + timeout in TUI and headless
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: 44-110

**Before**
```ts
const { hooks, errors: hookErrors } = await loadHooks(loaded.configDir)
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir)
```

**After**
```ts
const { hooks, errors: hookErrors } = await discoverAndLoadHooks({
  configDir: loaded.configDir,
  cwd,
  configuredPaths: loaded.hooks.paths,
})
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir, loaded.hooks.timeoutMs)
```

**File**: `apps/coding-agent/src/headless.ts`
**Lines**: 83-86

**Before**
```ts
const { hooks, errors: hookErrors } = await loadHooks(loaded.configDir)
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir)
```

**After**
```ts
const { hooks, errors: hookErrors } = await discoverAndLoadHooks({
  configDir: loaded.configDir,
  cwd,
  configuredPaths: loaded.hooks.paths,
})
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir, loaded.hooks.timeoutMs)
```

**Why**: Apply new discovery and configurable timeout uniformly.

### Edge Cases to Handle
- [ ] Configured hook path does not exist → ignore with error entry in `errors` array.
- [ ] Project-local hooks directory missing → return empty list (no error).
- [ ] Duplicate hooks across directories → only load once.

### Success Criteria
**Automated**
```bash
bun test apps/coding-agent/tests/hooks.test.ts
```

**Manual**
- [ ] A hook in `./.marvin/hooks` runs when `marvin` is executed in that repo.
- [ ] `config.json` `hooks.paths` loads an arbitrary hook file.

---

## Phase 2: Attachment-aware send + Error-aware tool hooks

### Overview
Allow hooks to send attachments and observe tool failures via `tool.execute.after`.

### Prerequisites
- [ ] Phase 1 complete.

### Changes

#### 1. Extend HookAPI `send` signature for attachments
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: 8-179

**Before**
```ts
import type { AppMessage, ThinkingLevel } from "@marvin-agents/agent-core"
...
  send(text: string): void
```

**After**
```ts
import type { AppMessage, Attachment, ThinkingLevel } from "@marvin-agents/agent-core"
...
  send(text: string, attachments?: Attachment[]): void
```

**Why**: Allow hooks to inject messages with images/documents.

#### 2. Update Hook loader send handler type
**File**: `apps/coding-agent/src/hooks/loader.ts`
**Lines**: 16-63

**Before**
```ts
export type SendHandler = (text: string) => void
...
send(text: string): void {
  sendHandler(text)
}
```

**After**
```ts
export type SendHandler = (text: string, attachments?: Attachment[]) => void
...
send(text: string, attachments?: Attachment[]): void {
  sendHandler(text, attachments)
}
```

**Why**: Thread attachments through HookRunner.

#### 3. Update `HookRunner.setSendHandler`
**File**: `apps/coding-agent/src/hooks/runner.ts`
**Lines**: 105-113

**Before**
```ts
setSendHandler(handler: SendHandler): void {
  for (const hook of this.hooks) {
    hook.setSendHandler(handler)
  }
}
```

**After**
```ts
setSendHandler(handler: SendHandler): void {
  for (const hook of this.hooks) {
    hook.setSendHandler(handler)
  }
}
```

**Why**: Signature change only (no behavior change).

#### 4. Accept attachments in TUI `handleSubmit`
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: 376-409

**Before**
```ts
const handleSubmit = async (text: string, editorClearFn?: () => void) => {
  ...
  if (isResponding()) {
    queuedMessages.push(text); setQueueCount(queuedMessages.length)
    void agent.queueMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
    editorClearFn?.(); return
  }
  ...
  sessionManager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
  ...
  try { await agent.prompt(text) }
}

props.hookRunner.setSendHandler((text) => void handleSubmit(text))
```

**After**
```ts
const handleSubmit = async (text: string, editorClearFn?: () => void, attachments?: Attachment[]) => {
  ...
  if (isResponding()) {
    queuedMessages.push(text); setQueueCount(queuedMessages.length)
    void agent.queueMessage({
      role: "user",
      content: [{ type: "text", text }],
      attachments: attachments?.length ? attachments : undefined,
      timestamp: Date.now(),
    })
    editorClearFn?.(); return
  }
  ...
  sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text }],
    attachments: attachments?.length ? attachments : undefined,
    timestamp: Date.now(),
  })
  ...
  try { await agent.prompt(text, attachments) }
}

props.hookRunner.setSendHandler((text, attachments) => void handleSubmit(text, undefined, attachments))
```

**Why**: Ensures attachments flow into agent prompt and session persistence.

#### 5. Update headless send handler signature
**File**: `apps/coding-agent/src/headless.ts`
**Lines**: 133-134

**Before**
```ts
hookRunner.setSendHandler(() => {})
```

**After**
```ts
hookRunner.setSendHandler((_text, _attachments) => {})
```

**Why**: Maintain signature consistency (headless remains no-op).

#### 6. Emit `tool.execute.after` on tool errors
**File**: `apps/coding-agent/src/hooks/tool-wrapper.ts`
**Lines**: 46-69

**Before**
```ts
const result = await tool.execute(toolCallId, params, signal, onUpdate)
...
const afterResult = await hookRunner.emitToolExecuteAfter({
  type: "tool.execute.after",
  toolName: tool.name,
  toolCallId,
  input: params,
  content: result.content,
  details: result.details,
  isError: false,
})
```

**After**
```ts
let result: AgentToolResult<TDetails>
try {
  result = await tool.execute(toolCallId, params, signal, onUpdate)
} catch (err) {
  const errorText = err instanceof Error ? err.message : String(err)
  if (hookRunner.hasHandlers("tool.execute.after")) {
    await hookRunner.emitToolExecuteAfter({
      type: "tool.execute.after",
      toolName: tool.name,
      toolCallId,
      input: params,
      content: [{ type: "text", text: errorText }],
      details: undefined,
      isError: true,
    })
  }
  throw err
}

const afterResult = await hookRunner.emitToolExecuteAfter({
  type: "tool.execute.after",
  toolName: tool.name,
  toolCallId,
  input: params,
  content: result.content,
  details: result.details,
  isError: false,
})
```

**Why**: Allow hooks to observe failures while preserving agent error semantics.

### Edge Cases to Handle
- [ ] `attachments` empty → treat as `undefined` to keep sessions compact.
- [ ] Tool throws non-Error → stringify safely.

### Success Criteria
**Automated**
```bash
bun test apps/coding-agent/tests/hooks.test.ts
```

**Manual**
- [ ] A hook can call `marvin.send("text", [attachment])` and the model receives the attachment content.
- [ ] A failing tool triggers `tool.execute.after` with `isError: true`.

---

## Phase 3: Docs + CLI Help Updates

### Overview
Document the dependency model, hook import path, and new config fields.

### Prerequisites
- [ ] Phases 1-2 complete.

### Changes

#### 1. Update hooks documentation
**File**: `apps/coding-agent/README.md`

**Before** (excerpt)
```md
import type { HookAPI } from "@marvin-agents/coding-agent"
```

**After**
```md
import type { HookAPI } from "@marvin-agents/coding-agent/hooks"
```

**Add** (Hooks section)
```md
Dependencies:
- Hooks run as normal TS modules. If you import packages, initialize the hooks folder as a package:
  - cd ~/.config/marvin/hooks
  - npm init -y
  - npm install @marvin-agents/coding-agent

Config:
"hooks": { "paths": ["/abs/path/to/hook.ts"], "timeoutMs": 5000 }

Project-local hooks:
- Place hooks in ./.marvin/hooks/*.ts for repo-specific behavior.
```

**Why**: Make dependency expectations explicit.

#### 2. Update CLI help text
**File**: `apps/coding-agent/src/index.ts`

**Before** (Hooks help)
```ts
"  Place .ts files in ~/.config/marvin/hooks/",
"  Export default function(marvin) { marvin.on(event, handler) }",
```

**After**
```ts
"  Place .ts files in ~/.config/marvin/hooks/ or ./.marvin/hooks/",
"  Install hook deps in ~/.config/marvin/hooks (npm init -y; npm i @marvin-agents/coding-agent)",
"  Config: hooks.paths[], hooks.timeoutMs in config.json",
"  Export default function(marvin) { marvin.on(event, handler) }",
```

**Why**: Keep CLI help aligned with new behavior.

---

## Testing Strategy

### Unit Tests to Add/Modify
**File**: `apps/coding-agent/tests/hooks.test.ts`

```ts
describe("hooks send attachments", () => {
  it("passes attachments to the send handler", async () => {
    // Set send handler and assert attachments received
  })
})

describe("tool wrapper", () => {
  it("emits tool.execute.after on tool errors", async () => {
    // Force tool.execute to throw, assert hook handler ran with isError: true
  })
})

describe("hooks loader", () => {
  it("loads project-local hooks from .marvin/hooks", async () => {
    // Create temp cwd with .marvin/hooks and assert load
  })
})
```

### Manual Testing Checklist
1. [ ] Place a hook in `./.marvin/hooks` and run `marvin` from that repo; verify it fires.
2. [ ] Add a hook that sends an attachment; verify the model sees document text or image blocks.
3. [ ] Add a hook that logs `tool.execute.after` on errors; trigger a failing tool call.

## Anti-Patterns to Avoid
- Changing hook event names or semantics (only additive changes).
- Swallowing tool execution errors (must still surface as `toolResult` errors).
- Assuming hooks can resolve dependencies without `node_modules` in the hook directory.

## References
- Loader: `apps/coding-agent/src/hooks/loader.ts`
- Hook types: `apps/coding-agent/src/hooks/types.ts`
- Hook runner: `apps/coding-agent/src/hooks/runner.ts`
- Tool wrapper: `apps/coding-agent/src/hooks/tool-wrapper.ts`
- TUI send handler: `apps/coding-agent/src/tui-app.tsx:376`
- Config: `apps/coding-agent/src/config.ts`
- Hook tests: `apps/coding-agent/tests/hooks.test.ts`

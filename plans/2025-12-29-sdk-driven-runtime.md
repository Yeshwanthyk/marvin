# SDK-Driven Runtime Implementation Plan

## Plan Metadata
- Created: 2025-12-29
- Ticket: N/A
- Status: draft
- Owner: yesh
- Assumptions:
  - No backward-compat requirements for `@marvin-agents/base-tools` exports
  - TUI keeps manual wiring (no SDK agent factory usage)
  - SDK is internal only (no npm publish in this plan)

## Progress Tracking
- [ ] Phase 1: Base-tools factories + call-site rewiring
- [ ] Phase 2: SDK package + config extraction
- [ ] Phase 3: SDK agent factory + headless/ACP integration
- [ ] Phase 4: Session manager extraction + repo wiring

## Overview
Refactor Marvin to be SDK-driven: move config/session logic into a new `@marvin-agents/sdk`, replace base-tools singletons with explicit cwd-bound factories, and switch headless + ACP modes to use the SDK agent factory. TUI keeps manual wiring but consumes SDK config + session store.

## Current State
- Base tools are singletons (`readTool`, `codingTools`, etc.) that implicitly rely on `process.cwd()`.
- App wiring (config + session store + transport + tool composition) lives in `apps/coding-agent`.
- Config merges project prompts using `process.cwd()`; sessions are rooted to `process.cwd()` on construction.

### Key Discoveries
- Base tool exports are singletons: `packages/base-tools/src/index.ts:1-8`.
- Tool implementations resolve and execute using implicit cwd: `packages/base-tools/src/tools/read.ts:24-35`, `packages/base-tools/src/tools/edit.ts:118-130`, `packages/base-tools/src/tools/write.ts:12-20`, `packages/base-tools/src/tools/bash.ts:29-45`.
- Config uses `process.cwd()` for project prompt resolution: `apps/coding-agent/src/config.ts:15-18`.
- Session manager binds cwd in constructor: `apps/coding-agent/src/session-manager.ts:57-61`.

## Desired End State
- `@marvin-agents/base-tools` exports only factories: `createReadTool`, `createWriteTool`, `createEditTool`, `createBashTool`, `createCodingTools(cwd)`.
- All tool call sites pass explicit `cwd` (no implicit `process.cwd()` in base tools).
- New `@marvin-agents/sdk` contains config loader, session manager, and `createMarvinAgent` factory.
- Headless + ACP use `createMarvinAgent`; TUI continues manual wiring using SDK config/session.

### Verification
- `bun run check`
- Manual: Run TUI and confirm `read`/`write`/`edit`/`bash` operate within the process cwd and continue to persist sessions.
- Manual: Run ACP mode (`marvin acp ...`) and confirm session creation/prompt still works.

## Out of Scope
- Daemon server / HTTP API
- npm publishing (see `plans/2025-01-11-publish-marvin-packages.md`)
- Refactoring TUI to use SDK agent factory

## Breaking Changes
- `@marvin-agents/base-tools` removes singleton exports (`readTool`, `writeTool`, `editTool`, `bashTool`, `codingTools`).
- `apps/coding-agent` imports for config/session must point to SDK.

## Dependency and Configuration Changes

### Additions
- New workspace package: `packages/sdk` (no external deps)
- Add local dependency:
  - `apps/coding-agent/package.json`: `"@marvin-agents/sdk": "file:../../packages/sdk"`

### Updates
None

### Removals
None

### Configuration Changes
None

## Error Handling Strategy
- Tool factories preserve existing error behavior (file not found, abort, timeout).
- `createMarvinAgent()` throws on invalid provider/model (same as `loadAppConfig`).
- Session manager keeps current JSONL persistence behavior; async append errors remain non-fatal (logged).

## Implementation Approach
- Replace singleton tools with explicit, cwd-bound factories to eliminate global cwd coupling.
- Centralize config + session logic in SDK; expose thin, stable API for embedding.
- Keep hook/custom tool loading in app code; SDK remains policy-free.

## Phase Dependencies and Parallelization
- Dependencies:
  - Phase 2 depends on Phase 1
  - Phase 3 depends on Phases 1–2
  - Phase 4 depends on Phase 2 (and updates call sites from Phase 3)
- Parallelizable: none (shared files)
- Suggested @agents: none

---

## Phase 1: Base-tools factories + call-site rewiring

### Overview
Convert base tools to cwd-bound factories and update all call sites to pass explicit `cwd`. Add minimal unit tests for new path resolution utilities.

### Prerequisites
- [ ] Branch `sdk-plan` checked out
- [ ] Open Questions resolved

### Change Checklist
- [ ] Replace singleton exports with factories in `@marvin-agents/base-tools`
- [ ] Update headless/TUI/ACP call sites to use `createCodingTools(cwd)`
- [ ] Add base-tools unit test + update test script

### Changes

#### 1. Cwd-bound path utilities
**File**: `packages/base-tools/src/tools/path-utils.ts`
**Location**: lines 1-48

**Before**:
```ts
export function expandPath(filePath: string): string {
	const normalized = normalizeUnicodeSpaces(filePath);
	if (normalized === "~") {
		return os.homedir();
	}
	if (normalized.startsWith("~/")) {
		return os.homedir() + normalized.slice(1);
	}
	return normalized;
}

export function resolveReadPath(filePath: string): string {
	const expanded = expandPath(filePath);

	if (fileExists(expanded)) {
		return expanded;
	}

	const macOSVariant = tryMacOSScreenshotPath(expanded);
	if (macOSVariant !== expanded && fileExists(macOSVariant)) {
		return macOSVariant;
	}

	return expanded;
}
```

**After**:
```ts
import { resolve as resolvePath } from "node:path";

export function expandPath(filePath: string): string {
	const normalized = normalizeUnicodeSpaces(filePath);
	if (normalized === "~") {
		return os.homedir();
	}
	if (normalized.startsWith("~/")) {
		return os.homedir() + normalized.slice(1);
	}
	return normalized;
}

export function resolvePathFromCwd(cwd: string, filePath: string): string {
	return resolvePath(cwd, expandPath(filePath));
}

export function resolveReadPathFromCwd(cwd: string, filePath: string): string {
	const expanded = expandPath(filePath);
	const candidate = resolvePath(cwd, expanded);
	if (fileExists(candidate)) return candidate;

	const macOSVariant = tryMacOSScreenshotPath(expanded);
	const macCandidate = resolvePath(cwd, macOSVariant);
	if (macCandidate !== candidate && fileExists(macCandidate)) return macCandidate;

	return candidate;
}
```

**Why**: Remove implicit `process.cwd()` and make all file resolution explicit to the caller.

#### 2. Bash tool factory
**File**: `packages/base-tools/src/tools/bash.ts`
**Location**: lines 29-45

**Before**:
```ts
export const bashTool: AgentTool<typeof bashSchema> = {
	name: "bash",
	label: "bash",
	description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
	parameters: bashSchema,
	execute: async (
		_toolCallId: string,
		{ command, timeout }: { command: string; timeout?: number },
		signal?: AbortSignal,
		onUpdate?,
	) => {
		return new Promise((resolve, reject) => {
			const { shell, args } = getShellConfig();
			const child = spawn(shell, [...args, command], {
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
```

**After**:
```ts
export function createBashTool(cwd: string): AgentTool<typeof bashSchema> {
	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
		parameters: bashSchema,
		execute: async (
			_toolCallId: string,
			{ command, timeout }: { command: string; timeout?: number },
			signal?: AbortSignal,
			onUpdate?,
		) => {
			return new Promise((resolve, reject) => {
				const { shell, args } = getShellConfig();
				const child = spawn(shell, [...args, command], {
					cwd,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});
```

**Why**: Ensure bash executes in explicit cwd.

#### 3. Read tool factory
**File**: `packages/base-tools/src/tools/read.ts`
**Location**: lines 24-35

**Before**:
```ts
export const readTool: AgentTool<typeof readSchema> = {
	name: "read",
	label: "read",
	// ...
	execute: async (
		_toolCallId: string,
		{ path, offset, limit }: { path: string; offset?: number; limit?: number },
		signal?: AbortSignal,
	) => {
		const absolutePath = resolvePath(resolveReadPath(path));
```

**After**:
```ts
import { resolveReadPathFromCwd } from "./path-utils.js";

export function createReadTool(cwd: string): AgentTool<typeof readSchema> {
	return {
		name: "read",
		label: "read",
		// ...
		execute: async (
			_toolCallId: string,
			{ path, offset, limit }: { path: string; offset?: number; limit?: number },
			signal?: AbortSignal,
		) => {
			const absolutePath = resolveReadPathFromCwd(cwd, path);
```

**Why**: Ensure file reads resolve against explicit cwd.

#### 4. Edit tool factory
**File**: `packages/base-tools/src/tools/edit.ts`
**Location**: lines 118-130

**Before**:
```ts
export const editTool: AgentTool<typeof editSchema> = {
	name: "edit",
	label: "edit",
	// ...
	execute: async (
		_toolCallId: string,
		{ path, oldText, newText }: { path: string; oldText: string; newText: string },
		signal?: AbortSignal,
	) => {
		const absolutePath = resolvePath(expandPath(path));
```

**After**:
```ts
import { resolvePathFromCwd } from "./path-utils.js";

export function createEditTool(cwd: string): AgentTool<typeof editSchema> {
	return {
		name: "edit",
		label: "edit",
		// ...
		execute: async (
			_toolCallId: string,
			{ path, oldText, newText }: { path: string; oldText: string; newText: string },
			signal?: AbortSignal,
		) => {
			const absolutePath = resolvePathFromCwd(cwd, path);
```

**Why**: Ensure edits resolve against explicit cwd.

#### 5. Write tool factory
**File**: `packages/base-tools/src/tools/write.ts`
**Location**: lines 12-20

**Before**:
```ts
export const writeTool: AgentTool<typeof writeSchema> = {
	name: "write",
	label: "write",
	// ...
	execute: async (_toolCallId: string, { path, content }: { path: string; content: string }, signal?: AbortSignal) => {
		const absolutePath = resolvePath(expandPath(path));
```

**After**:
```ts
import { resolvePathFromCwd } from "./path-utils.js";

export function createWriteTool(cwd: string): AgentTool<typeof writeSchema> {
	return {
		name: "write",
		label: "write",
		// ...
		execute: async (_toolCallId: string, { path, content }: { path: string; content: string }, signal?: AbortSignal) => {
			const absolutePath = resolvePathFromCwd(cwd, path);
```

**Why**: Ensure writes resolve against explicit cwd.

#### 6. Base-tools public exports
**File**: `packages/base-tools/src/index.ts`
**Location**: lines 1-12

**Before**:
```ts
import { bashTool } from "./tools/bash.js";
import { editTool } from "./tools/edit.js";
import { readTool } from "./tools/read.js";
import { writeTool } from "./tools/write.js";

export { bashTool, editTool, readTool, writeTool };

export const codingTools = [readTool, bashTool, editTool, writeTool];
```

**After**:
```ts
import { createBashTool } from "./tools/bash.js";
import { createEditTool } from "./tools/edit.js";
import { createReadTool } from "./tools/read.js";
import { createWriteTool } from "./tools/write.js";

export { createBashTool, createEditTool, createReadTool, createWriteTool };

export function createCodingTools(cwd: string) {
	return [
		createReadTool(cwd),
		createBashTool(cwd),
		createEditTool(cwd),
		createWriteTool(cwd),
	];
}
```

**Why**: Remove singletons and force explicit cwd binding.

#### 7. Headless tool wiring
**File**: `apps/coding-agent/src/headless.ts`
**Location**: lines 1-121

**Before**:
```ts
import { codingTools } from '@marvin-agents/base-tools';
// ...
const cwd = process.cwd();
// ...
const { tools: customTools, errors: toolErrors } = await loadCustomTools(
  loaded.configDir,
  cwd,
  getToolNames(codingTools),
  headlessSendRef,
);

const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)];
```

**After**:
```ts
import { createCodingTools } from '@marvin-agents/base-tools';
// ...
const cwd = process.cwd();
const builtinTools = createCodingTools(cwd);
// ...
const { tools: customTools, errors: toolErrors } = await loadCustomTools(
  loaded.configDir,
  cwd,
  getToolNames(builtinTools),
  headlessSendRef,
);

const allTools: AgentTool<any, any>[] = [...builtinTools, ...customTools.map((t) => t.tool)];
```

**Why**: Replace singleton tool array with cwd-bound factory output.

#### 8. TUI tool wiring
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: lines 12-141

**Before**:
```ts
import { codingTools } from "@marvin-agents/base-tools"
// ...
const cwd = process.cwd()
// ...
const { tools: customTools, errors: toolErrors } = await loadCustomTools(
  loaded.configDir,
  cwd,
  getToolNames(codingTools),
  sendRef,
)

const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)]
// ...
for (const tool of codingTools) {
  toolByName.set(tool.name, { label: tool.label, source: "builtin" })
}
```

**After**:
```ts
import { createCodingTools } from "@marvin-agents/base-tools"
// ...
const cwd = process.cwd()
const builtinTools = createCodingTools(cwd)
// ...
const { tools: customTools, errors: toolErrors } = await loadCustomTools(
  loaded.configDir,
  cwd,
  getToolNames(builtinTools),
  sendRef,
)

const allTools: AgentTool<any, any>[] = [...builtinTools, ...customTools.map((t) => t.tool)]
// ...
for (const tool of builtinTools) {
  toolByName.set(tool.name, { label: tool.label, source: "builtin" })
}
```

**Why**: Keep manual wiring but remove reliance on singleton exports.

#### 9. ACP tool wiring
**File**: `apps/coding-agent/src/acp/index.ts`
**Location**: lines 6-143

**Before**:
```ts
import { codingTools } from "@marvin-agents/base-tools"
// ...
const cwd = params.cwd || process.cwd()
// ...
const agent = new Agent({
  transport,
  initialState: {
    model,
    tools: codingTools,
    thinkingLevel: "medium",
  },
})
```

**After**:
```ts
import { createCodingTools } from "@marvin-agents/base-tools"
// ...
const cwd = params.cwd || process.cwd()
const builtinTools = createCodingTools(cwd)
// ...
const agent = new Agent({
  transport,
  initialState: {
    model,
    tools: builtinTools,
    thinkingLevel: "medium",
  },
})
```

**Why**: Ensure ACP sessions use cwd-bound tool instances.

#### 10. Base-tools test script + unit test
**File**: `packages/base-tools/package.json`
**Location**: lines 6-10

**Before**:
```json
"scripts": {
  "test": "node -e \"process.exit(0)\""
}
```

**After**:
```json
"scripts": {
  "test": "bun test tests"
}
```

**File**: `packages/base-tools/tests/path-utils.test.ts` (new)

**Add**:
```ts
import { describe, it, expect } from "bun:test";
import { resolvePathFromCwd } from "../src/tools/path-utils.js";

describe("resolvePathFromCwd", () => {
	it("resolves relative paths against cwd", () => {
		expect(resolvePathFromCwd("/tmp/project", "file.txt")).toBe("/tmp/project/file.txt");
	});
});
```

**Why**: Validate new cwd-based resolution behavior.

### Edge Cases to Handle
- [ ] Relative file paths: resolve against provided cwd
- [ ] Paths with `~`: expand before resolution
- [ ] Missing files: keep existing error behavior

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test -w @marvin-agents/base-tools
```

**Before proceeding to next phase**:
```bash
bun run check
```

**Manual**:
- [ ] Run TUI and verify `read`/`write`/`edit`/`bash` operate in current cwd

### Rollback
```bash
git restore -- packages/base-tools apps/coding-agent/src/headless.ts apps/coding-agent/src/tui-app.tsx apps/coding-agent/src/acp/index.ts
```

### Notes
- No fallback to `process.cwd()` inside base-tools after this phase.

---

## Phase 2: SDK package + config extraction

### Overview
Create `@marvin-agents/sdk` package and move config loader into it with explicit `cwd` for project prompt resolution. Update app imports/tests to use the SDK.

### Prerequisites
- [ ] Phase 1 automated checks pass

### Change Checklist
- [ ] Add `packages/sdk` package.json + tsconfig
- [ ] Move config loader into SDK (cwd-aware)
- [ ] Update imports to use SDK config functions
- [ ] Pass explicit `cwd` to all `loadAppConfig` call sites

### Changes

#### 1. SDK package skeleton
**File**: `packages/sdk/package.json` (new)

**Add**:
```json
{
  "name": "@marvin-agents/sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "bun test tests"
  },
  "dependencies": {
    "@marvin-agents/agent-core": "file:../agent",
    "@marvin-agents/ai": "file:../ai",
    "@marvin-agents/base-tools": "file:../base-tools",
    "@marvin-agents/lsp": "file:../lsp"
  }
}
```

**File**: `packages/sdk/tsconfig.json` (new)

**Add**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

**Why**: Establish SDK workspace for shared runtime code.

#### 2. SDK config module (cwd-aware)
**File**: `packages/sdk/src/config.ts` (new)

**Add** (excerpt showing cwd injection):
```ts
const projectAgentsPaths = (cwd: string) => [
  () => path.join(cwd, "AGENTS.md"),
  () => path.join(cwd, "CLAUDE.md"),
];

export const loadAgentsConfig = async (options: { cwd: string }): Promise<AgentsConfig> => {
  const cwd = options.cwd;
  const global = await loadFirstExisting(GLOBAL_AGENTS_PATHS);
  const project = await loadFirstExisting(projectAgentsPaths(cwd));
  // ...
};

export const loadAppConfig = async (options: {
  cwd: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
}): Promise<LoadedAppConfig> => {
  // ...
  const agentsConfig = await loadAgentsConfig({ cwd: options.cwd });
  // ...
};
```

**Why**: Config resolution must honor caller-provided cwd.

#### 3. SDK public index
**File**: `packages/sdk/src/index.ts` (new)

**Add**:
```ts
export { loadAgentsConfig, loadAppConfig, updateAppConfig } from "./config.js";
export type { AgentsConfig, LoadedAppConfig, EditorConfig } from "./config.js";
```

**Why**: Provide stable SDK exports for config functions.

#### 4. Update app config imports
**File**: `apps/coding-agent/src/headless.ts`
**Location**: lines 1-8

**Before**:
```ts
import { loadAppConfig } from './config.js';
```

**After**:
```ts
import { loadAppConfig } from '@marvin-agents/sdk';
```

**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: lines 12-18

**Before**:
```ts
import { loadAppConfig, updateAppConfig, type EditorConfig } from "./config.js"
```

**After**:
```ts
import { loadAppConfig, updateAppConfig, type EditorConfig } from "@marvin-agents/sdk"
```

**File**: `apps/coding-agent/src/commands.ts`

**Before**:
```ts
import { updateAppConfig, type EditorConfig } from "./config.js"
```

**After**:
```ts
import { updateAppConfig, type EditorConfig } from "@marvin-agents/sdk"
```

**File**: `apps/coding-agent/src/acp/index.ts`

**Before**:
```ts
import { loadAppConfig } from "../config.js"
```

**After**:
```ts
import { loadAppConfig } from "@marvin-agents/sdk"
```

**File**: `apps/coding-agent/tests/config.test.ts`

**Before**:
```ts
import { loadAppConfig } from '../src/config';
```

**After**:
```ts
import { loadAppConfig } from '@marvin-agents/sdk';
```

**Why**: Centralize config API in SDK.

#### 5. Pass explicit cwd to `loadAppConfig`
**File**: `apps/coding-agent/src/headless.ts`

**Before**:
```ts
const loaded = await loadAppConfig({
  configDir: args.configDir,
  configPath: args.configPath,
  provider,
  model,
  thinking: args.thinking,
});
```

**After**:
```ts
const cwd = process.cwd();
const loaded = await loadAppConfig({
  cwd,
  configDir: args.configDir,
  configPath: args.configPath,
  provider,
  model,
  thinking: args.thinking,
});
```

**File**: `apps/coding-agent/src/tui-app.tsx`

**Before**:
```ts
const loaded = await loadAppConfig({
  configDir: args?.configDir,
  configPath: args?.configPath,
  provider: firstProvider,
  model: firstModel,
  thinking: args?.thinking,
})

const cwd = process.cwd()
```

**After**:
```ts
const cwd = process.cwd()
const loaded = await loadAppConfig({
  cwd,
  configDir: args?.configDir,
  configPath: args?.configPath,
  provider: firstProvider,
  model: firstModel,
  thinking: args?.thinking,
})
```

**File**: `apps/coding-agent/src/acp/index.ts`

**Before**:
```ts
const loaded = await loadAppConfig({
  configDir: args.configDir,
  configPath: args.configPath,
})
```

**After**:
```ts
const loaded = await loadAppConfig({
  cwd: process.cwd(),
  configDir: args.configDir,
  configPath: args.configPath,
})
```

**File**: `apps/coding-agent/tests/config.test.ts`

**Before**:
```ts
const loaded = await loadAppConfig({ configDir, provider: 'openai', model: 'gpt-4.1' });
```

**After**:
```ts
const loaded = await loadAppConfig({ cwd: process.cwd(), configDir, provider: 'openai', model: 'gpt-4.1' });
```

**Why**: Ensure project prompt resolution uses caller-specified cwd.

#### 6. Add SDK dependency to app
**File**: `apps/coding-agent/package.json`
**Location**: `dependencies`

**Before**:
```json
"@marvin-agents/lsp": "file:../../packages/lsp",
"@marvin-agents/open-tui": "file:../../packages/open-tui",
```

**After**:
```json
"@marvin-agents/lsp": "file:../../packages/lsp",
"@marvin-agents/open-tui": "file:../../packages/open-tui",
"@marvin-agents/sdk": "file:../../packages/sdk",
```

**Why**: Enable SDK imports inside app code.

### Edge Cases to Handle
- [ ] Missing project prompt files (AGENTS/CLAUDE) should remain optional
- [ ] Invalid provider/model errors should match existing messages

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test -w @marvin-agents/coding-agent
```

**Before proceeding to next phase**:
```bash
bun run check
```

**Manual**:
- [ ] Launch TUI and verify theme/model selection works from config

### Rollback
```bash
git restore -- packages/sdk apps/coding-agent/src/headless.ts apps/coding-agent/src/tui-app.tsx apps/coding-agent/src/commands.ts apps/coding-agent/src/acp/index.ts apps/coding-agent/tests/config.test.ts apps/coding-agent/package.json
```

### Notes
- `apps/coding-agent/src/config.ts` becomes unused; removal is deferred to Phase 4 to avoid mixing with session changes.

---

## Phase 3: SDK agent factory + headless/ACP integration

### Overview
Add `createMarvinAgent()` to SDK and use it in headless + ACP modes while preserving hooks/custom tools in app code.

### Prerequisites
- [ ] Phase 2 automated checks pass

### Change Checklist
- [ ] Add `createMarvinAgent()` to SDK
- [ ] Update headless mode to use SDK agent factory
- [ ] Update ACP mode to use SDK agent factory

### Changes

#### 1. SDK agent factory
**File**: `packages/sdk/src/marvin-agent.ts` (new)

**Add**:
```ts
import {
  Agent,
  ProviderTransport,
  RouterTransport,
  CodexTransport,
  loadTokens,
  saveTokens,
  clearTokens,
  type AgentTransport,
  type ThinkingLevel,
} from "@marvin-agents/agent-core";
import { getApiKey, type AgentTool } from "@marvin-agents/ai";
import { createCodingTools } from "@marvin-agents/base-tools";
import { createLspManager, wrapToolsWithLspDiagnostics } from "@marvin-agents/lsp";
import { loadAppConfig, type LoadedAppConfig } from "./config.js";

export type MarvinAgentOptions = {
  cwd: string;
  config?: LoadedAppConfig;
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  systemPrompt?: string | ((defaultPrompt: string) => string);
  tools?: AgentTool<any, any>[] | ((defaults: AgentTool<any, any>[]) => AgentTool<any, any>[]);
  transport?: AgentTransport;
  getApiKeyForProvider?: (provider: string) => string | undefined;
  lsp?: false | { enabled: true; autoInstall?: boolean };
};

export async function createMarvinAgent(options: MarvinAgentOptions) {
  const loaded =
    options.config ??
    (await loadAppConfig({
      cwd: options.cwd,
      configDir: options.configDir,
      configPath: options.configPath,
      provider: options.provider,
      model: options.model,
      thinking: options.thinking,
    }));

  const systemPrompt =
    typeof options.systemPrompt === "function"
      ? options.systemPrompt(loaded.systemPrompt)
      : options.systemPrompt ?? loaded.systemPrompt;

  const defaults = createCodingTools(options.cwd);
  const toolList =
    typeof options.tools === "function" ? options.tools(defaults) : options.tools ?? defaults;

  const getApiKeyForProvider =
    options.getApiKeyForProvider ?? ((provider: string) => {
      if (provider === "anthropic") {
        return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider);
      }
      return getApiKey(provider);
    });

  const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider });
  const codexTransport = new CodexTransport({
    getTokens: async () => loadTokens({ configDir: loaded.configDir }),
    setTokens: async (tokens) => saveTokens(tokens, { configDir: loaded.configDir }),
    clearTokens: async () => clearTokens({ configDir: loaded.configDir }),
  });

  const transport =
    options.transport ?? new RouterTransport({ provider: providerTransport, codex: codexTransport });

  const lsp = options.lsp?.enabled
    ? createLspManager({
        cwd: options.cwd,
        configDir: loaded.configDir,
        enabled: true,
        autoInstall: Boolean(options.lsp.autoInstall),
      })
    : null;

  const tools = lsp ? wrapToolsWithLspDiagnostics(toolList, lsp, { cwd: options.cwd }) : toolList;

  const agent = new Agent({
    transport,
    initialState: {
      systemPrompt,
      model: loaded.model,
      thinkingLevel: loaded.thinking,
      tools,
    },
  });

  const close = async () => {
    try {
      await lsp?.shutdown();
    } catch {}
  };

  return { agent, close };
}
```

**Why**: Centralize runtime wiring for embedding and daemon use.

#### 2. SDK exports
**File**: `packages/sdk/src/index.ts`

**Before**:
```ts
export { loadAgentsConfig, loadAppConfig, updateAppConfig } from "./config.js";
export type { AgentsConfig, LoadedAppConfig, EditorConfig } from "./config.js";
```

**After**:
```ts
export { loadAgentsConfig, loadAppConfig, updateAppConfig } from "./config.js";
export type { AgentsConfig, LoadedAppConfig, EditorConfig } from "./config.js";

export { createMarvinAgent } from "./marvin-agent.js";
export type { MarvinAgentOptions } from "./marvin-agent.js";
```

**Why**: Expose SDK agent factory to app code.

#### 3. Headless uses SDK agent factory
**File**: `apps/coding-agent/src/headless.ts`
**Location**: lines 1-121 and 123-179

**Before**:
```ts
import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens } from '@marvin-agents/agent-core';
import { getApiKey, type AgentTool, type Message, type TextContent } from '@marvin-agents/ai';
import { createLspManager, wrapToolsWithLspDiagnostics } from '@marvin-agents/lsp';
// ...
const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider });
const codexTransport = new CodexTransport({ ... });
const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport });
// ...
const lsp = createLspManager({ ... });
const tools = wrapToolsWithLspDiagnostics(wrapToolsWithHooks(allTools, hookRunner), lsp, { cwd });

const agent = new Agent({
  transport,
  initialState: { systemPrompt: loaded.systemPrompt, model: loaded.model, thinkingLevel: loaded.thinking, tools },
});
// ...
} finally {
  await lsp.shutdown().catch(() => {});
}
```

**After**:
```ts
import { createMarvinAgent } from '@marvin-agents/sdk';
// ...
const cwd = process.cwd();
const builtinTools = createCodingTools(cwd);
// ...
const allTools: AgentTool<any, any>[] = [...builtinTools, ...customTools.map((t) => t.tool)];
const hookedTools = wrapToolsWithHooks(allTools, hookRunner);

const { agent, close } = await createMarvinAgent({
  cwd,
  config: loaded,
  tools: hookedTools,
  lsp: loaded.lsp.enabled ? { enabled: true, autoInstall: loaded.lsp.autoInstall } : false,
});
// ...
} finally {
  await close();
}
```

**Why**: Use SDK for transport/model/tool wiring; preserve hooks + custom tools in app.

#### 4. ACP uses SDK agent factory
**File**: `apps/coding-agent/src/acp/index.ts`
**Location**: lines 6-143

**Before**:
```ts
import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens } from "@marvin-agents/agent-core"
import { getApiKey, getModels, type KnownProvider, type Model, type Api } from "@marvin-agents/ai"
import { codingTools } from "@marvin-agents/base-tools"
import { loadAppConfig } from "@marvin-agents/sdk"
// ...
const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider })
const codexTransport = new CodexTransport({ ... })
const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport })
// ...
const agent = new Agent({
  transport,
  initialState: {
    model,
    tools: codingTools,
    thinkingLevel: "medium",
  },
})
```

**After**:
```ts
import { getModels, type KnownProvider, type Model, type Api } from "@marvin-agents/ai"
import { createMarvinAgent } from "@marvin-agents/sdk"
// ...
const { agent } = await createMarvinAgent({
  cwd,
  configDir: loaded.configDir,
  configPath: args.configPath,
  provider,
  model: modelId,
  thinking: "medium",
  lsp: false,
});
```

**Why**: Keep ACP minimal while reusing SDK for transports/tools/config.

### Edge Cases to Handle
- [ ] ACP model not found: preserve current error text
- [ ] Headless with no prompt: keep empty-prompt error path

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test -w @marvin-agents/coding-agent
```

**Before proceeding to next phase**:
```bash
bun run check
```

**Manual**:
- [ ] `marvin --headless` responds with expected output
- [ ] `marvin acp` still accepts `session/new` and `session/prompt`

### Rollback
```bash
git restore -- packages/sdk apps/coding-agent/src/headless.ts apps/coding-agent/src/acp/index.ts
```

### Notes
- LSP wrapping remains in SDK; hook wrapping remains in app.

---

## Phase 4: Session manager extraction + repo wiring

### Overview
Move session persistence into SDK, update all app imports, and include SDK in root typecheck.

### Prerequisites
- [ ] Phase 3 automated checks pass

### Change Checklist
- [ ] Move `SessionManager` into SDK with explicit cwd
- [ ] Update imports in app code + tests
- [ ] Update root typecheck to include SDK

### Changes

#### 1. SDK session manager
**File**: `packages/sdk/src/session-manager.ts` (new)

**Add** (excerpt with explicit cwd):
```ts
export class SessionManager {
  private configDir: string;
  private cwd: string;
  private sessionDir: string;
  // ...

  constructor(options: { configDir: string; cwd: string }) {
    this.configDir = options.configDir;
    this.cwd = options.cwd;
    this.sessionDir = join(options.configDir, "sessions", safeCwd(this.cwd));
  }
  // ...
}
```

**Why**: Remove implicit cwd and make session store reusable.

#### 2. SDK exports
**File**: `packages/sdk/src/index.ts`

**Add**:
```ts
export { SessionManager } from "./session-manager.js";
export type {
  SessionMetadata,
  SessionMessageEntry,
  SessionEntry,
  SessionInfo,
  SessionDetails,
  LoadedSession,
} from "./session-manager.js";
```

**Why**: Expose session manager to app code.

#### 3. Update app imports + constructor signature
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: lines 17-142

**Before**:
```ts
import { SessionManager, type LoadedSession } from "./session-manager.js"
// ...
const sessionManager = new SessionManager(loaded.configDir)
```

**After**:
```ts
import { SessionManager, type LoadedSession } from "@marvin-agents/sdk"
// ...
const sessionManager = new SessionManager({ configDir: loaded.configDir, cwd })
```

**File**: `apps/coding-agent/src/commands.ts`

**Before**:
```ts
import type { SessionManager } from "./session-manager.js"
```

**After**:
```ts
import type { SessionManager } from "@marvin-agents/sdk"
```

**File**: `apps/coding-agent/src/session-picker.tsx`

**Before**:
```ts
import type { SessionManager } from "./session-manager.js"
```

**After**:
```ts
import type { SessionManager } from "@marvin-agents/sdk"
```

**File**: `apps/coding-agent/src/agent-events.ts`

**Before**:
```ts
import type { SessionManager } from "./session-manager.js"
```

**After**:
```ts
import type { SessionManager } from "@marvin-agents/sdk"
```

**File**: `apps/coding-agent/tests/session-manager.test.ts`

**Before**:
```ts
import { SessionManager } from "../src/session-manager";
// ...
manager = new SessionManager(tempDir);
```

**After**:
```ts
import { SessionManager } from "@marvin-agents/sdk";
// ...
manager = new SessionManager({ configDir: tempDir, cwd: "/tmp" });
```

**Why**: Align all session usage with SDK implementation and explicit cwd.

#### 4. Remove app-local session manager
**File**: `apps/coding-agent/src/session-manager.ts`
**Location**: lines 1-220

**Change**: remove file after call sites updated.

**Why**: Single source of truth in SDK.

#### 5. Remove app-local config module
**File**: `apps/coding-agent/src/config.ts`
**Location**: lines 1-243

**Change**: remove file after all imports point to SDK.

**Why**: Single source of truth in SDK.

#### 6. Root typecheck includes SDK
**File**: `package.json`
**Location**: `scripts.typecheck`

**Before**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p packages/lsp/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

**After**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p packages/lsp/tsconfig.json && tsc --noEmit -p packages/sdk/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

**Why**: Ensure SDK stays typechecked in CI/dev.

### Edge Cases to Handle
- [ ] Session list empty: retain current behavior
- [ ] Invalid session file: continue to skip silently

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test -w @marvin-agents/coding-agent
```

**Before proceeding to next phase**:
```bash
bun run check
```

**Manual**:
- [ ] Start TUI, create a session, restart TUI, confirm session load works

### Rollback
```bash
git restore -- packages/sdk apps/coding-agent/src/tui-app.tsx apps/coding-agent/src/commands.ts apps/coding-agent/src/session-picker.tsx apps/coding-agent/src/agent-events.ts apps/coding-agent/src/session-manager.ts apps/coding-agent/src/config.ts apps/coding-agent/tests/session-manager.test.ts package.json
```

### Notes
- Removing `apps/coding-agent/src/session-manager.ts` deletes ~200 lines; confirm before execution.

---

## Testing Strategy

### Unit Tests to Add/Modify
- `packages/base-tools/tests/path-utils.test.ts` for cwd resolution
- Update `apps/coding-agent/tests/session-manager.test.ts` to use SDK import and new constructor signature

### Integration Tests
- [ ] Headless prompt roundtrip with SDK (`marvin --headless`)
- [ ] ACP session new + prompt

### Manual Testing Checklist
1. [ ] TUI run: send prompt; tool calls execute in cwd
2. [ ] TUI resume session: previous messages load and new messages append
3. [ ] ACP: create session and prompt via JSON-RPC

## Deployment Instructions
N/A (internal refactor only)

## Anti-Patterns to Avoid
- Reintroducing `process.cwd()` in base-tools or SDK tool factories
- Letting SDK auto-load hooks/custom tools from disk

## Open Questions (must resolve before implementation)
- None.

## References
- Base-tools exports: `packages/base-tools/src/index.ts:1-8`
- Tool cwd usage: `packages/base-tools/src/tools/read.ts:24-35`, `packages/base-tools/src/tools/bash.ts:29-45`
- Config cwd usage: `apps/coding-agent/src/config.ts:15-18`
- Session manager cwd: `apps/coding-agent/src/session-manager.ts:57-61`

# Marvin Embedded SDK (in-process) Implementation Plan

## Overview
Add a small in-process SDK (`@marvin-agents/sdk`) that exposes `createMarvinAgent()` returning `{ agent, close }`, and refactor built-in tools to be cwd-correct via factories.

## Current State

### Key Discoveries
- Built-in coding tools are exported as static `codingTools` and singletons (`readTool`, `bashTool`, `editTool`, `writeTool`) from `@marvin-agents/base-tools` (`packages/base-tools/src/index.ts:1-8`).
- Built-in tools implicitly assume `process.cwd()`:
  - `bashTool` spawns with no `cwd` option (`packages/base-tools/src/tools/bash.ts:41-45`).
  - `readTool` resolves file paths using `path.resolve(...)` (process cwd) and `resolveReadPath()` existence checks are relative to process cwd (`packages/base-tools/src/tools/read.ts:34-35`, `packages/base-tools/src/tools/path-utils.ts:35-48`).
  - `editTool` / `writeTool` use `resolvePath(expandPath(path))` (process cwd) (`packages/base-tools/src/tools/edit.ts:129`, `packages/base-tools/src/tools/write.ts:19`).
- “App wiring” (transport + tools + LSP + agent) lives in app code (`apps/coding-agent/src/headless.ts:65-128`) and isn’t reusable as a library.
- System prompt merges global + project AGENTS/CLAUDE using `process.cwd()` for project file lookup (`apps/coding-agent/src/config.ts:15-18`, `apps/coding-agent/src/config.ts:45-58`). Embedding with `cwd != process.cwd()` will mismatch prompt vs tool filesystem.

## Desired End State

### SDK
- `createMarvinAgent(options)` creates a configured `Agent`:
  - cwd-correct default tools bound to `options.cwd`
  - default transports (ProviderTransport + CodexTransport + RouterTransport), matching current headless behavior
  - optional LSP (explicit opt-in)
  - explicit tool customization: caller passes custom tools, no implicit discovery
- Returns `{ agent, close }` where `close()` is idempotent and shuts down LSP if enabled.

### Tools
- Existing exports remain (`readTool`, `codingTools`, etc.) and by default operate on `process.cwd()` at execution time.
- New factories allow binding to a specific cwd:
  - `createReadTool(cwd)`, `createBashTool(cwd)`, `createEditTool(cwd)`, `createWriteTool(cwd)`
  - `createCodingTools(cwd)`

### Verification
```bash
bun run typecheck
bun run test
```
Manual: embed with `cwd` pointing at a different repo and confirm `read`/`bash` operate in that repo.

## Out of Scope
- Hooks UI / permission gating.
- SDK auto-loading hooks/tools from `~/.config/marvin`.
- Remote/HTTP server architecture.
- Public npm publishing (covered as addendum only).

## Error Handling Strategy
- `createMarvinAgent()` throws on invalid config/provider/model.
- Tool factories preserve existing tool error semantics; only resolution/cwd changes.
- `close()` never throws.

## Implementation Approach
- Copy opencode’s “thin wrapper + injection knobs” philosophy: SDK is glue; keep heavy logic in existing packages.
- Root-cause fix for embedding: add tool factories + make singletons dynamically use `process.cwd()` at runtime.
- Keep customization explicit:
  - `tools` option is either full override array or `(defaults) => next`.

---

## Phase 1: Refactor `@marvin-agents/base-tools` for cwd correctness

### Overview
Make `read/bash/edit/write` cwd-aware via factories while retaining default exports.

### Prerequisites
- [ ] Working tree clean

### Changes

#### 1) Add cwd helpers + cwd-aware resolution
**File**: `packages/base-tools/src/tools/path-utils.ts`
**Lines**: 1-48

**Before**:
```ts
import { accessSync, constants } from "node:fs";
import * as os from "node:os";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

function tryMacOSScreenshotPath(filePath: string): string {
	return filePath.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

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
import { accessSync, constants } from "node:fs";
import * as os from "node:os";
import { resolve as resolvePath } from "node:path";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

export type CwdLike = string | (() => string);

export function toCwdResolver(cwd?: CwdLike): () => string {
	if (!cwd) return () => process.cwd();
	if (typeof cwd === "function") return cwd;
	return () => cwd;
}

function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

function tryMacOSScreenshotPath(filePath: string): string {
	return filePath.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export function expandPath(filePath: string): string {
	const normalized = normalizeUnicodeSpaces(filePath);
	if (normalized === "~") return os.homedir();
	if (normalized.startsWith("~/")) return os.homedir() + normalized.slice(1);
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

export function resolveReadPath(filePath: string): string {
	return resolveReadPathFromCwd(process.cwd(), filePath);
}
```

**Why**: Enables tools to resolve relative paths against an explicit cwd (embedding) while keeping the default behavior dynamic.

#### 2) Add `createBashTool()` + spawn cwd
**File**: `packages/base-tools/src/tools/bash.ts`
**Lines**: 29-46

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
import { toCwdResolver, type CwdLike } from "./path-utils.js";

export function createBashTool(cwd?: CwdLike): AgentTool<typeof bashSchema> {
	const cwdResolver = toCwdResolver(cwd);
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
			const cwdValue = cwdResolver();
			return new Promise((resolve, reject) => {
				const { shell, args } = getShellConfig();
				const child = spawn(shell, [...args, command], {
					cwd: cwdValue,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});
				// remainder unchanged
			});
		},
	};
}

export const bashTool = createBashTool();
```

#### 3) Add `createReadTool()` + cwd-aware resolution
**File**: `packages/base-tools/src/tools/read.ts`
**Lines**: 1-35

**Before**:
```ts
import { resolve as resolvePath } from "path";
import { resolveReadPath } from "./path-utils.js";

// ...

export const readTool: AgentTool<typeof readSchema> = {
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
import { resolveReadPathFromCwd, toCwdResolver, type CwdLike } from "./path-utils.js";

export function createReadTool(cwd?: CwdLike): AgentTool<typeof readSchema> {
	const cwdResolver = toCwdResolver(cwd);
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. Returns full file content by default — only files exceeding ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB are truncated (with instructions to continue).`,
		parameters: readSchema,
		execute: async (
			_toolCallId: string,
			{ path, offset, limit }: { path: string; offset?: number; limit?: number },
			signal?: AbortSignal,
		) => {
			const cwdValue = cwdResolver();
			const absolutePath = resolveReadPathFromCwd(cwdValue, path);
			// remainder unchanged
		},
	};
}

export const readTool = createReadTool();
```

#### 4) Add `createEditTool()` + cwd-aware resolution
**File**: `packages/base-tools/src/tools/edit.ts`
**Lines**: 118-130

**Before**:
```ts
export const editTool: AgentTool<typeof editSchema> = {
	name: "edit",
	label: "edit",
	description:
		"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
	parameters: editSchema,
	execute: async (
		_toolCallId: string,
		{ path, oldText, newText }: { path: string; oldText: string; newText: string },
		signal?: AbortSignal,
	) => {
		const absolutePath = resolvePath(expandPath(path));
```

**After**:
```ts
import { resolvePathFromCwd, toCwdResolver, type CwdLike } from "./path-utils.js";

export function createEditTool(cwd?: CwdLike): AgentTool<typeof editSchema> {
	const cwdResolver = toCwdResolver(cwd);
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		parameters: editSchema,
		execute: async (
			_toolCallId: string,
			{ path, oldText, newText }: { path: string; oldText: string; newText: string },
			signal?: AbortSignal,
		) => {
			const absolutePath = resolvePathFromCwd(cwdResolver(), path);
			// remainder unchanged
		},
	};
}

export const editTool = createEditTool();
```

#### 5) Add `createWriteTool()` + cwd-aware resolution
**File**: `packages/base-tools/src/tools/write.ts`
**Lines**: 12-21

**Before**:
```ts
export const writeTool: AgentTool<typeof writeSchema> = {
	name: "write",
	label: "write",
	description:
		"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
	parameters: writeSchema,
	execute: async (_toolCallId: string, { path, content }: { path: string; content: string }, signal?: AbortSignal) => {
		const absolutePath = resolvePath(expandPath(path));
		const dir = dirname(absolutePath);
```

**After**:
```ts
import { resolvePathFromCwd, toCwdResolver, type CwdLike } from "./path-utils.js";

export function createWriteTool(cwd?: CwdLike): AgentTool<typeof writeSchema> {
	const cwdResolver = toCwdResolver(cwd);
	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: writeSchema,
		execute: async (
			_toolCallId: string,
			{ path, content }: { path: string; content: string },
			signal?: AbortSignal,
		) => {
			const absolutePath = resolvePathFromCwd(cwdResolver(), path);
			const dir = dirname(absolutePath);
			// remainder unchanged
		},
	};
}

export const writeTool = createWriteTool();
```

#### 6) Export factories + `createCodingTools()`
**File**: `packages/base-tools/src/index.ts`
**Lines**: 1-8

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
import { bashTool, createBashTool } from "./tools/bash.js";
import { editTool, createEditTool } from "./tools/edit.js";
import { readTool, createReadTool } from "./tools/read.js";
import { writeTool, createWriteTool } from "./tools/write.js";
import type { CwdLike } from "./tools/path-utils.js";

export { bashTool, createBashTool, editTool, createEditTool, readTool, createReadTool, writeTool, createWriteTool };

export function createCodingTools(cwd?: CwdLike) {
	return [createReadTool(cwd), createBashTool(cwd), createEditTool(cwd), createWriteTool(cwd)];
}

export const codingTools = [readTool, bashTool, editTool, writeTool];
```

#### 7) Ensure tests actually run for base-tools
**File**: `packages/base-tools/package.json`
**Lines**: 1-16

**Before**:
```json
{
  "name": "@marvin-agents/base-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "node -e \"process.exit(0)\""
  },
  "dependencies": {
    "@marvin-agents/ai": "file:../ai",
    "@sinclair/typebox": "^0.34.41",
    "diff": "^8.0.2",
    "file-type": "^21.1.1"
  }
}
```

**After**:
```json
{
  "name": "@marvin-agents/base-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "bun test tests"
  },
  "dependencies": {
    "@marvin-agents/ai": "file:../ai",
    "@sinclair/typebox": "^0.34.41",
    "diff": "^8.0.2",
    "file-type": "^21.1.1"
  }
}
```

#### 8) Add minimal unit tests for cwd resolution
**File**: `packages/base-tools/tests/path-utils.test.ts` (new)

**Add**:
```ts
import { describe, it, expect } from "bun:test";
import { resolvePathFromCwd } from "../src/tools/path-utils.js";

describe("resolvePathFromCwd", () => {
	it("resolves relative against cwd", () => {
		expect(resolvePathFromCwd("/tmp/x", "foo.txt")).toBe("/tmp/x/foo.txt");
	});
});
```

### Success Criteria
```bash
bun run typecheck
bun run test
```

### Rollback
```bash
git checkout HEAD -- packages/base-tools
```

---

## Phase 2: Create `@marvin-agents/sdk` and extract config/prompt logic

### Overview
Create a new workspace package for SDK code, and move config loading (including AGENTS/CLAUDE merge) into it so SDK doesn’t depend on `apps/*`.

### Prerequisites
- [ ] Phase 1 checks pass

### Changes

#### 1) New package skeleton
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
    "test": "node -e \"process.exit(0)\""
  },
  "dependencies": {
    "@marvin-agents/agent-core": "file:../agent",
    "@marvin-agents/ai": "file:../ai",
    "@marvin-agents/base-tools": "file:../base-tools",
    "@marvin-agents/lsp": "file:../lsp"
  }
}
```

#### 2) Add SDK tsconfig for root typecheck
**File**: `packages/sdk/tsconfig.json` (new)

**Add**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

#### 3) Move config loader into SDK and make it cwd-aware
**File**: `packages/sdk/src/config.ts` (new)

**Add**:
- Copy the full contents of `apps/coding-agent/src/config.ts`.
- Apply these precise changes:

**Change A (project file lookup)**
- Replace `PROJECT_AGENTS_PATHS` (`apps/coding-agent/src/config.ts:15-18`) with:
```ts
const projectAgentsPaths = (cwd: string) => [
  () => path.join(cwd, 'AGENTS.md'),
  () => path.join(cwd, 'CLAUDE.md'),
];
```

**Change B (loadAgentsConfig signature)**
- Change `loadAgentsConfig` (`apps/coding-agent/src/config.ts:45`) to:
```ts
export const loadAgentsConfig = async (options?: { cwd?: string }): Promise<AgentsConfig> => {
  const cwd = options?.cwd ?? process.cwd();
  const global = await loadFirstExisting(GLOBAL_AGENTS_PATHS);
  const project = await loadFirstExisting(projectAgentsPaths(cwd));
  // rest unchanged
};
```

**Change C (thread cwd through loadAppConfig)**
- Add `cwd?: string` to options type (`apps/coding-agent/src/config.ts:110-116`) and call:
```ts
const agentsConfig = await loadAgentsConfig({ cwd: options?.cwd });
```

#### 4) Keep app imports stable via re-export wrapper
**File**: `apps/coding-agent/src/config.ts`

**Before**: existing file (see `apps/coding-agent/src/config.ts:1-220`)

**After**:
```ts
export { loadAgentsConfig, loadAppConfig, updateAppConfig } from "@marvin-agents/sdk";
export type { AgentsConfig, LoadedAppConfig } from "@marvin-agents/sdk";
```

#### 5) Add sdk dependency to the app
**File**: `apps/coding-agent/package.json`
**Lines**: 13-25

**Before**:
```json
"dependencies": {
  "@marvin-agents/agent-core": "file:../../packages/agent",
  "@marvin-agents/ai": "file:../../packages/ai",
  "@marvin-agents/base-tools": "file:../../packages/base-tools",
  "@marvin-agents/lsp": "file:../../packages/lsp",
  "@marvin-agents/open-tui": "file:../../packages/open-tui",
  "@opentui/core": "0.1.62",
  "@opentui/solid": "0.1.62",
  "chalk": "^5.6.2",
  "cli-highlight": "^2.1.11",
  "diff": "^8.0.2",
  "solid-js": "1.9.9"
}
```

**After**:
```json
"dependencies": {
  "@marvin-agents/agent-core": "file:../../packages/agent",
  "@marvin-agents/ai": "file:../../packages/ai",
  "@marvin-agents/base-tools": "file:../../packages/base-tools",
  "@marvin-agents/lsp": "file:../../packages/lsp",
  "@marvin-agents/open-tui": "file:../../packages/open-tui",
  "@marvin-agents/sdk": "file:../../packages/sdk",
  "@opentui/core": "0.1.62",
  "@opentui/solid": "0.1.62",
  "chalk": "^5.6.2",
  "cli-highlight": "^2.1.11",
  "diff": "^8.0.2",
  "solid-js": "1.9.9"
}
```

### Success Criteria
```bash
bun run typecheck
bun run test
```

### Rollback
```bash
git checkout HEAD -- packages/sdk apps/coding-agent/src/config.ts apps/coding-agent/package.json
```

---

## Phase 3: Implement `createMarvinAgent()`

### Overview
Expose a minimal in-process agent factory with explicit customization knobs.

### Prerequisites
- [ ] Phase 2 checks pass

### Changes

#### 1) SDK entrypoint
**File**: `packages/sdk/src/index.ts` (new)

**Add**:
```ts
export { createMarvinAgent, createMarvin, type MarvinAgentOptions } from "./marvin-agent.js";
export { loadAgentsConfig, loadAppConfig, updateAppConfig } from "./config.js";
export type { AgentsConfig, LoadedAppConfig } from "./config.js";

export { Agent } from "@marvin-agents/agent-core";
export type { AgentTool, Message } from "@marvin-agents/ai";
```

#### 2) Agent factory
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
  cwd?: string;
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
  /** SDK opt-in only */
  lsp?: false | { enabled: true; autoInstall?: boolean };
};

export async function createMarvinAgent(options: MarvinAgentOptions = {}) {
  const cwd = options.cwd ?? process.cwd();

  const loaded =
    options.config ??
    (await loadAppConfig({
      cwd,
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

  const defaults = createCodingTools(cwd);
  const toolList =
    typeof options.tools === "function" ? options.tools(defaults) : options.tools ?? defaults;

  const getApiKeyForProvider =
    options.getApiKeyForProvider ??
    ((provider: string) => {
      if (provider === "anthropic") return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider);
      return getApiKey(provider);
    });

  const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider });
  const codexTransport = new CodexTransport({
    getTokens: async () => loadTokens({ configDir: loaded.configDir }),
    setTokens: async (t) => saveTokens(t, { configDir: loaded.configDir }),
    clearTokens: async () => clearTokens({ configDir: loaded.configDir }),
  });

  const transport =
    options.transport ?? new RouterTransport({ provider: providerTransport, codex: codexTransport });

  const lsp = options.lsp?.enabled
    ? createLspManager({
        cwd,
        configDir: loaded.configDir,
        enabled: true,
        autoInstall: Boolean(options.lsp.autoInstall),
      })
    : null;

  const tools = lsp ? wrapToolsWithLspDiagnostics(toolList, lsp, { cwd }) : toolList;

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

export async function createMarvin(options?: MarvinAgentOptions) {
  return createMarvinAgent(options);
}
```

#### 3) Wire root typecheck to include sdk
**File**: `package.json`
**Lines**: 5-10

**Before**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p packages/lsp/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

**After**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p packages/lsp/tsconfig.json && tsc --noEmit -p packages/sdk/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

### Success Criteria
```bash
bun run check
```

### Rollback
```bash
git checkout HEAD -- packages/sdk package.json
```

---

## Phase 4: Dogfood in headless (optional)

### Overview
Use SDK to remove duplication in `apps/coding-agent/src/headless.ts` while keeping hooks/custom-tools loading app-local.

### Prerequisites
- [ ] Phase 3 checks pass

### Changes

#### 1) Replace tool+transport+LSP wiring with SDK
**File**: `apps/coding-agent/src/headless.ts`
**Lines**: 1-8, 72-128, 175-177

**Before (imports)**:
```ts
import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens } from '@marvin-agents/agent-core';
import { codingTools } from '@marvin-agents/base-tools';
import { createLspManager, wrapToolsWithLspDiagnostics } from '@marvin-agents/lsp';
```

**After**:
```ts
import { Agent } from '@marvin-agents/agent-core';
import { createCodingTools } from '@marvin-agents/base-tools';
import { createMarvinAgent } from '@marvin-agents/sdk';
```

**Before (agent creation + LSP shutdown)**:
```ts
const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport });
// ...
const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)];
const lsp = createLspManager({ cwd, configDir: loaded.configDir, enabled: loaded.lsp.enabled, autoInstall: loaded.lsp.autoInstall });
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
const cwd = process.cwd();
const builtins = createCodingTools(cwd);

const { tools: customTools, errors: toolErrors } = await loadCustomTools(
  loaded.configDir,
  cwd,
  getToolNames(builtins),
);

const allTools: AgentTool<any, any>[] = [...builtins, ...customTools.map((t) => t.tool)];
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

### Success Criteria
```bash
bun run check
```

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/headless.ts
```

---

## Manual Testing Checklist
1. [ ] Run process in repo A; set `cwd` to repo B; verify `read` resolves repo B.
2. [ ] `bash` tool: run `pwd`; verify it prints repo B.

## Anti-Patterns to Avoid
- Capturing `process.cwd()` at import-time (e.g. `createCodingTools(process.cwd())`). Use a resolver for defaults.
- SDK auto-discovering tools/hooks from disk.

## Open Questions
- None.

## References
- Base tools export: `packages/base-tools/src/index.ts:1`
- bash spawn options: `packages/base-tools/src/tools/bash.ts:41`
- read absolute path: `packages/base-tools/src/tools/read.ts:34`
- edit absolute path: `packages/base-tools/src/tools/edit.ts:129`
- write absolute path: `packages/base-tools/src/tools/write.ts:19`
- headless wiring: `apps/coding-agent/src/headless.ts:65`

---

# Addendum: Path to a Public `@marvin-agents/sdk`

## Current publish blockers
- `@marvin-agents/base-tools` + `@marvin-agents/lsp` are `private: true` (`packages/base-tools/package.json:4`, `packages/lsp/package.json:4`).
- `@marvin-agents/agent-core` + `@marvin-agents/ai` ship `dist` but entrypoints still reference `src` (`packages/agent/package.json:6-11`, `packages/ai/package.json:6-11`).
- No release tooling in repo (no changesets/lerna).

## Minimal publishing steps
1. Decide publish set: `ai`, `agent-core`, `base-tools`, `lsp` (optional), `sdk`.
2. For each publishable package:
   - Add build pipeline (`tsconfig.build.json` + `build` + `prepublishOnly`) consistent with `packages/agent`/`packages/ai`.
   - Point entrypoints at `dist`:
     - `main: "dist/index.js"`
     - `types: "dist/index.d.ts"`
     - Add `exports` map if desired.
   - Ensure `files` includes `dist/**` + README.
   - Remove `private: true`.
3. Replace workspace `file:` deps with semver ranges so npm consumers resolve correctly.
4. Add a publish script (minimal): build all, then `npm publish -w packages/...`.
5. Verify with `npm pack` and a clean Node project import test.

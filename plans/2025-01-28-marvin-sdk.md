# Marvin SDK Implementation Plan

## Plan Metadata
- Created: 2025-01-28
- Ticket: N/A
- Status: draft
- Owner: yesh
- Assumptions:
  - SDK is a new package (`packages/sdk`) with simple, explicit API
  - Backward compatibility for existing `codingTools` exports maintained
  - No skills system, branded config, or tool auto-installation
  - Config loaded from `~/.config/marvin` with explicit overrides

## Progress Tracking
- [ ] Phase 1: CWD-Bound Tool Factories
- [ ] Phase 2: SDK Package + runAgent
- [ ] Phase 3: AgentSession + State Serialization
- [ ] Phase 4: Streaming API
- [ ] Phase 5: Documentation + Tests

## Overview

Create a simple, embeddable SDK (`@marvin-agents/sdk`) that exposes:
- `createTools(cwd)` — cwd-bound tool factories for concurrent directory support
- `runAgent(options)` — single function to run an agent and get final result
- `createAgentSession(options)` — multi-turn conversation with state serialization
- `runAgentStream(options)` — streaming events for interactive use

The SDK follows a "batteries included but removable" philosophy: sensible defaults from `~/.config/marvin`, but everything overridable per-call.

## Current State

### Tools
- Tools exported as singletons from `packages/base-tools/src/index.ts:1-8`
- Path resolution uses `process.cwd()` implicitly:
  - `bash.ts:41` — no `cwd` option in spawn
  - `read.ts:34` — `resolvePath(resolveReadPath(path))` uses process.cwd()
  - `write.ts:19` — `resolvePath(expandPath(path))` uses process.cwd()
  - `edit.ts:129` — same pattern

### Config
- `apps/coding-agent/src/config.ts` loads from `~/.config/marvin/config.json`
- AGENTS.md discovery: global (`~/.config/marvin/agents.md`) + project (`./AGENTS.md`)
- Project AGENTS.md uses `process.cwd()` for discovery (`config.ts:15-18`)

### Agent
- `Agent` class in `packages/agent/src/agent.ts` handles state, streaming, tool execution
- Transports: `ProviderTransport`, `CodexTransport`, `RouterTransport`
- Events: `AgentEvent` union type with message_start/update/end, tool_execution_*, turn_end, agent_end

## Desired End State

```typescript
// Simple script usage
import { runAgent, createTools } from '@marvin-agents/sdk';

const result = await runAgent({
  prompt: "Review this codebase for security issues",
  cwd: "/path/to/repo",
});

if (result.ok) {
  console.log(result.value.response);
  console.log(`Tokens: ${result.value.usage.totalTokens}`);
} else {
  console.error(result.error.message);
}

// Multi-turn with state
import { createAgentSession } from '@marvin-agents/sdk';

const session = await createAgentSession({ cwd: "/path/to/repo" });
const r1 = await session.chat("What files are in src/?");
const r2 = await session.chat("Show me the main entry point");

// Serialize for later
const state = session.getState();
fs.writeFileSync('session.json', JSON.stringify(state));

// Concurrent multi-directory
const repos = ['/repo-a', '/repo-b', '/repo-c'];
const results = await Promise.all(
  repos.map(cwd => runAgent({ prompt: "Audit dependencies", cwd }))
);
```

### Verification
```bash
bun run check                    # typecheck + test
bun test packages/sdk            # SDK-specific tests
bun test packages/base-tools     # Tool factory tests
```

Manual: Run example script against different directories concurrently, verify isolation.

## Out of Scope
- Skills system
- Branded config directories (different app names)
- Tool auto-installation (rg/fd)
- Ancestor AGENTS.md walking (just global + project)
- Hook UI context (TUI-specific)
- npm publishing (separate plan)

## Breaking Changes
None. All existing exports from `base-tools` preserved. SDK is additive.

## Dependency and Configuration Changes

### Additions
**File**: `packages/sdk/package.json` (new)
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
    "@marvin-agents/base-tools": "file:../base-tools"
  }
}
```

**Why needed**: New SDK package for embeddable agent API.

### Configuration Changes
**File**: `package.json` (root)

**Before**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p packages/lsp/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

**After**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p packages/lsp/tsconfig.json && tsc --noEmit -p packages/sdk/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

## Error Handling Strategy

SDK uses Result pattern for all public APIs:
```typescript
type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };
```

- `runAgent()` returns `Promise<Result<AgentResult>>`
- `session.chat()` returns `Promise<Result<AgentResult>>`
- Tool execution errors captured in result, not thrown
- Config errors (missing provider/model) still throw on initialization

## Implementation Approach

1. **Tool factories first** — Enable cwd isolation at the lowest level
2. **Config extraction** — Move config loading to SDK with cwd parameter
3. **Simple function API** — `runAgent()` wraps Agent class + transport wiring
4. **State management** — `AgentSession` for multi-turn with serialization
5. **Streaming optional** — Add `runAgentStream()` after core works

Alternative considered: Modify existing tools to accept cwd per-call. Rejected because it would change tool parameter schemas and break existing prompts.

## Phase Dependencies and Parallelization
- Dependencies: Phase 2 depends on Phase 1; Phase 3-4 depend on Phase 2
- Parallelizable: Phase 4 can start once Phase 2 is complete (independent of Phase 3)
- Suggested @agents: None (shared files, sequential work)

---

## Phase 1: CWD-Bound Tool Factories

### Overview
Refactor base-tools to support explicit cwd binding via factory functions while preserving existing singleton exports for backward compatibility.

### Prerequisites
- [ ] Working tree clean
- [ ] `bun run check` passes

### Change Checklist
- [ ] Add cwd-aware path utilities to path-utils.ts
- [ ] Create `createBashTool(cwd)` factory
- [ ] Create `createReadTool(cwd)` factory
- [ ] Create `createEditTool(cwd)` factory
- [ ] Create `createWriteTool(cwd)` factory
- [ ] Add `createTools(cwd)` convenience function
- [ ] Update exports in index.ts
- [ ] Add unit tests for path resolution

### Changes

#### 1. CWD-aware path utilities
**File**: `packages/base-tools/src/tools/path-utils.ts`
**Location**: lines 1-48

**Before**:
```typescript
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
```typescript
import { accessSync, constants } from "node:fs";
import * as os from "node:os";
import { resolve as resolvePath } from "node:path";

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

/**
 * Resolve a file path against a specific working directory.
 * Handles ~ expansion before resolution.
 */
export function resolvePathFromCwd(cwd: string, filePath: string): string {
	const expanded = expandPath(filePath);
	// Absolute paths (including ~ expanded to homedir) stay absolute
	if (expanded.startsWith("/")) {
		return expanded;
	}
	return resolvePath(cwd, expanded);
}

/**
 * Resolve a read path against a specific working directory.
 * Handles ~ expansion, macOS screenshot paths, and existence checks.
 */
export function resolveReadPathFromCwd(cwd: string, filePath: string): string {
	const expanded = expandPath(filePath);
	
	// Absolute paths stay absolute
	if (expanded.startsWith("/")) {
		if (fileExists(expanded)) {
			return expanded;
		}
		const macOSVariant = tryMacOSScreenshotPath(expanded);
		if (macOSVariant !== expanded && fileExists(macOSVariant)) {
			return macOSVariant;
		}
		return expanded;
	}
	
	// Relative paths resolve against cwd
	const candidate = resolvePath(cwd, expanded);
	if (fileExists(candidate)) {
		return candidate;
	}

	const macOSVariant = tryMacOSScreenshotPath(expanded);
	const macCandidate = resolvePath(cwd, macOSVariant);
	if (macCandidate !== candidate && fileExists(macCandidate)) {
		return macCandidate;
	}

	return candidate;
}

// Legacy function for backward compatibility (uses process.cwd())
export function resolveReadPath(filePath: string): string {
	return resolveReadPathFromCwd(process.cwd(), filePath);
}
```

**Why**: Enable tools to resolve relative paths against explicit cwd while maintaining backward compatibility.

#### 2. Bash tool factory
**File**: `packages/base-tools/src/tools/bash.ts`
**Location**: lines 1-30 (imports and schema) and lines 31-end (tool definition)

**Before** (lines 27-46):
```typescript
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
```typescript
/**
 * Create a bash tool bound to a specific working directory.
 * @param cwd Working directory for command execution. If not provided, uses process.cwd() at execution time.
 */
export function createBashTool(cwd?: string): AgentTool<typeof bashSchema> {
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
			const workingDir = cwd ?? process.cwd();
			return new Promise((resolve, reject) => {
				const { shell, args } = getShellConfig();
				const child = spawn(shell, [...args, command], {
					cwd: workingDir,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});
				// ... rest of implementation unchanged
```

At end of file, add:
```typescript
// Default singleton for backward compatibility
export const bashTool = createBashTool();
```

**Why**: Enable bash commands to execute in a specific directory for concurrent multi-repo use.

#### 3. Read tool factory
**File**: `packages/base-tools/src/tools/read.ts`
**Location**: lines 1-10 (imports) and lines 24-38 (tool definition start)

**Before** (lines 1-7):
```typescript
import type { AgentTool, ImageContent, TextContent } from "@marvin-agents/ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
import { resolve as resolvePath } from "path";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.js";
import { resolveReadPath } from "./path-utils.js";
```

**After**:
```typescript
import type { AgentTool, ImageContent, TextContent } from "@marvin-agents/ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.js";
import { resolveReadPathFromCwd } from "./path-utils.js";
```

**Before** (lines 24-38):
```typescript
export const readTool: AgentTool<typeof readSchema> = {
	name: "read",
	label: "read",
	description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. Returns full file content by default — only files exceeding ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB are truncated (with instructions to continue).`,
	parameters: readSchema,
	execute: async (
		_toolCallId: string,
		{ path, offset, limit }: { path: string; offset?: number; limit?: number },
		signal?: AbortSignal,
	) => {
		const absolutePath = resolvePath(resolveReadPath(path));
```

**After**:
```typescript
/**
 * Create a read tool bound to a specific working directory.
 * @param cwd Working directory for path resolution. If not provided, uses process.cwd() at execution time.
 */
export function createReadTool(cwd?: string): AgentTool<typeof readSchema> {
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
			const workingDir = cwd ?? process.cwd();
			const absolutePath = resolveReadPathFromCwd(workingDir, path);
```

At end of file, add:
```typescript
// Default singleton for backward compatibility
export const readTool = createReadTool();
```

**Why**: Enable file reads to resolve against specific directory.

#### 4. Write tool factory
**File**: `packages/base-tools/src/tools/write.ts`
**Location**: lines 1-10 (imports) and lines 12-20 (tool definition)

**Before** (lines 1-7):
```typescript
import type { AgentTool } from "@marvin-agents/ai";
import { Type } from "@sinclair/typebox";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve as resolvePath } from "path";
import { expandPath } from "./path-utils.js";
```

**After**:
```typescript
import type { AgentTool } from "@marvin-agents/ai";
import { Type } from "@sinclair/typebox";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { resolvePathFromCwd } from "./path-utils.js";
```

**Before** (lines 12-21):
```typescript
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
```typescript
/**
 * Create a write tool bound to a specific working directory.
 * @param cwd Working directory for path resolution. If not provided, uses process.cwd() at execution time.
 */
export function createWriteTool(cwd?: string): AgentTool<typeof writeSchema> {
	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: writeSchema,
		execute: async (_toolCallId: string, { path, content }: { path: string; content: string }, signal?: AbortSignal) => {
			const workingDir = cwd ?? process.cwd();
			const absolutePath = resolvePathFromCwd(workingDir, path);
			const dir = dirname(absolutePath);
```

At end of file, add:
```typescript
// Default singleton for backward compatibility
export const writeTool = createWriteTool();
```

**Why**: Enable file writes to resolve against specific directory.

#### 5. Edit tool factory
**File**: `packages/base-tools/src/tools/edit.ts`
**Location**: lines 1-10 (imports) and lines 118-135 (tool definition)

**Before** (lines 1-6):
```typescript
import type { AgentTool } from "@marvin-agents/ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import { resolve as resolvePath } from "path";
import { expandPath } from "./path-utils.js";
```

**After**:
```typescript
import type { AgentTool } from "@marvin-agents/ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import { resolvePathFromCwd } from "./path-utils.js";
```

**Before** (lines 118-135):
```typescript
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
```typescript
/**
 * Create an edit tool bound to a specific working directory.
 * @param cwd Working directory for path resolution. If not provided, uses process.cwd() at execution time.
 */
export function createEditTool(cwd?: string): AgentTool<typeof editSchema> {
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
			const workingDir = cwd ?? process.cwd();
			const absolutePath = resolvePathFromCwd(workingDir, path);
```

At end of file, add:
```typescript
// Default singleton for backward compatibility
export const editTool = createEditTool();
```

**Why**: Enable file edits to resolve against specific directory.

#### 6. Update base-tools exports
**File**: `packages/base-tools/src/index.ts`
**Location**: lines 1-8

**Before**:
```typescript
import { bashTool } from "./tools/bash.js";
import { editTool } from "./tools/edit.js";
import { readTool } from "./tools/read.js";
import { writeTool } from "./tools/write.js";

export { bashTool, editTool, readTool, writeTool };

export const codingTools = [readTool, bashTool, editTool, writeTool];
```

**After**:
```typescript
import { bashTool, createBashTool } from "./tools/bash.js";
import { editTool, createEditTool } from "./tools/edit.js";
import { readTool, createReadTool } from "./tools/read.js";
import { writeTool, createWriteTool } from "./tools/write.js";

// Singleton exports for backward compatibility
export { bashTool, editTool, readTool, writeTool };

// Factory exports for cwd-bound tools
export { createBashTool, createEditTool, createReadTool, createWriteTool };

/**
 * Create all coding tools bound to a specific working directory.
 * @param cwd Working directory for path resolution and command execution.
 */
export function createTools(cwd: string) {
	return [
		createReadTool(cwd),
		createBashTool(cwd),
		createEditTool(cwd),
		createWriteTool(cwd),
	];
}

// Legacy export for backward compatibility
export const codingTools = [readTool, bashTool, editTool, writeTool];
```

**Why**: Expose both backward-compatible singletons and new factory functions.

#### 7. Update base-tools package.json for tests
**File**: `packages/base-tools/package.json`
**Location**: lines 7-9

**Before**:
```json
  "scripts": {
    "test": "node -e \"process.exit(0)\""
  },
```

**After**:
```json
  "scripts": {
    "test": "bun test tests"
  },
```

**Why**: Enable actual test execution.

#### 8. Add path resolution tests
**File**: `packages/base-tools/tests/path-utils.test.ts` (new file)

**Add**:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePathFromCwd, resolveReadPathFromCwd } from "../src/tools/path-utils.js";

describe("resolvePathFromCwd", () => {
	it("resolves relative paths against cwd", () => {
		expect(resolvePathFromCwd("/tmp/project", "file.txt")).toBe("/tmp/project/file.txt");
		expect(resolvePathFromCwd("/tmp/project", "src/index.ts")).toBe("/tmp/project/src/index.ts");
	});

	it("preserves absolute paths", () => {
		expect(resolvePathFromCwd("/tmp/project", "/etc/hosts")).toBe("/etc/hosts");
	});

	it("expands ~ to home directory", () => {
		const result = resolvePathFromCwd("/tmp/project", "~/file.txt");
		expect(result.startsWith("/")).toBe(true);
		expect(result.includes("~")).toBe(false);
	});

	it("handles nested relative paths", () => {
		expect(resolvePathFromCwd("/tmp/project", "../other/file.txt")).toBe("/tmp/other/file.txt");
	});
});

describe("resolveReadPathFromCwd", () => {
	const testDir = join(tmpdir(), `marvin-test-${Date.now()}`);
	
	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, "exists.txt"), "content");
	});
	
	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("resolves existing relative files against cwd", () => {
		const result = resolveReadPathFromCwd(testDir, "exists.txt");
		expect(result).toBe(join(testDir, "exists.txt"));
	});

	it("resolves non-existing relative files against cwd", () => {
		const result = resolveReadPathFromCwd(testDir, "missing.txt");
		expect(result).toBe(join(testDir, "missing.txt"));
	});

	it("preserves absolute paths", () => {
		expect(resolveReadPathFromCwd(testDir, "/etc/hosts")).toBe("/etc/hosts");
	});
});
```

**Why**: Validate cwd resolution behavior.

#### 9. Add tool factory tests
**File**: `packages/base-tools/tests/tools.test.ts` (new file)

**Add**:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadTool, createWriteTool, createEditTool, createBashTool, createTools } from "../src/index.js";

describe("createTools", () => {
	const testDir = join(tmpdir(), `marvin-tools-test-${Date.now()}`);
	
	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, "test.txt"), "hello world");
	});
	
	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("creates all four tools", () => {
		const tools = createTools(testDir);
		expect(tools.length).toBe(4);
		expect(tools.map(t => t.name).sort()).toEqual(["bash", "edit", "read", "write"]);
	});
});

describe("createReadTool", () => {
	const testDir = join(tmpdir(), `marvin-read-test-${Date.now()}`);
	
	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, "test.txt"), "hello world");
	});
	
	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("reads file relative to bound cwd", async () => {
		const tool = createReadTool(testDir);
		const result = await tool.execute("test-id", { path: "test.txt" });
		expect(result.content[0].type).toBe("text");
		expect((result.content[0] as any).text).toContain("hello world");
	});
});

describe("createWriteTool", () => {
	const testDir = join(tmpdir(), `marvin-write-test-${Date.now()}`);
	
	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
	});
	
	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("writes file relative to bound cwd", async () => {
		const tool = createWriteTool(testDir);
		await tool.execute("test-id", { path: "output.txt", content: "test content" });
		const written = readFileSync(join(testDir, "output.txt"), "utf-8");
		expect(written).toBe("test content");
	});
});

describe("createBashTool", () => {
	const testDir = join(tmpdir(), `marvin-bash-test-${Date.now()}`);
	
	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
	});
	
	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("executes command in bound cwd", async () => {
		const tool = createBashTool(testDir);
		const result = await tool.execute("test-id", { command: "pwd" });
		expect(result.content[0].type).toBe("text");
		expect((result.content[0] as any).text.trim()).toBe(testDir);
	});
});

describe("createEditTool", () => {
	const testDir = join(tmpdir(), `marvin-edit-test-${Date.now()}`);
	
	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, "edit-me.txt"), "old text here");
	});
	
	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("edits file relative to bound cwd", async () => {
		const tool = createEditTool(testDir);
		await tool.execute("test-id", { 
			path: "edit-me.txt", 
			oldText: "old text", 
			newText: "new text" 
		});
		const content = readFileSync(join(testDir, "edit-me.txt"), "utf-8");
		expect(content).toBe("new text here");
	});
});
```

**Why**: Verify tool factories work correctly with bound cwd.

### Edge Cases to Handle
- [ ] Relative paths with `..`: resolve correctly against cwd
- [ ] Absolute paths: preserve as-is, ignore cwd
- [ ] `~` expansion: expand before considering cwd
- [ ] Missing cwd parameter: fall back to process.cwd() at execution time

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/base-tools/tests
```

**Before proceeding to next phase**:
```bash
bun run check
```

**Manual**:
- [ ] Create two temp directories with different files
- [ ] Create tools for each with `createTools(dir)`
- [ ] Verify read/write/bash execute in correct directories

### Rollback
```bash
git restore -- packages/base-tools/src packages/base-tools/tests packages/base-tools/package.json
```

### Notes
- Singletons preserved for all existing code
- Factories use lazy cwd resolution (process.cwd() if not provided)

---

## Phase 2: SDK Package + runAgent

### Overview
Create the `@marvin-agents/sdk` package with `runAgent()` function that provides a simple, Result-based API for running agents.

### Prerequisites
- [ ] Phase 1 automated checks pass
- [ ] Phase 1 manual verification complete

### Change Checklist
- [ ] Create packages/sdk directory structure
- [ ] Add package.json and tsconfig.json
- [ ] Create Result type and error handling
- [ ] Implement config loading with cwd parameter
- [ ] Implement runAgent() function
- [ ] Add SDK to root typecheck
- [ ] Add unit tests

### Changes

#### 1. SDK package skeleton
**File**: `packages/sdk/package.json` (new file)

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
    "@marvin-agents/base-tools": "file:../base-tools"
  }
}
```

**File**: `packages/sdk/tsconfig.json` (new file)

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

**Why**: Establish SDK as workspace package.

#### 2. Result type
**File**: `packages/sdk/src/result.ts` (new file)

**Add**:
```typescript
/**
 * Result type for operations that can fail.
 * Inspired by Rust's Result and functional programming patterns.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Create a successful result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Create a failed result.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Wrap an async operation in a Result.
 */
export async function tryCatch<T>(
  fn: () => Promise<T>
): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
```

**Why**: Provide errors-as-values pattern for SDK.

#### 3. Config module with cwd support
**File**: `packages/sdk/src/config.ts` (new file)

**Add**:
```typescript
import { getModels, getProviders, type Api, type KnownProvider, type Model } from "@marvin-agents/ai";
import type { ThinkingLevel } from "@marvin-agents/agent-core";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// --- AGENTS.md loading ---

const GLOBAL_AGENTS_PATHS = [
  () => path.join(os.homedir(), ".config", "marvin", "agents.md"),
  () => path.join(os.homedir(), ".codex", "agents.md"),
  () => path.join(os.homedir(), ".claude", "CLAUDE.md"),
];

const projectAgentsPaths = (cwd: string) => [
  () => path.join(cwd, "AGENTS.md"),
  () => path.join(cwd, "CLAUDE.md"),
];

const readFileIfExists = async (p: string): Promise<string | undefined> => {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return undefined;
  }
};

const loadFirstExisting = async (
  pathFns: Array<() => string>
): Promise<{ path: string; content: string } | undefined> => {
  for (const pathFn of pathFns) {
    const p = pathFn();
    const content = await readFileIfExists(p);
    if (content !== undefined) {
      return { path: p, content };
    }
  }
  return undefined;
};

export interface AgentsConfig {
  global?: { path: string; content: string };
  project?: { path: string; content: string };
  combined: string;
}

export const loadAgentsConfig = async (cwd: string): Promise<AgentsConfig> => {
  const global = await loadFirstExisting(GLOBAL_AGENTS_PATHS);
  const project = await loadFirstExisting(projectAgentsPaths(cwd));

  const parts: string[] = [];
  if (global) parts.push(global.content);
  if (project) parts.push(project.content);

  return {
    global,
    project,
    combined: parts.join("\n\n---\n\n"),
  };
};

export interface LoadedConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
}

const isThinkingLevel = (value: unknown): value is ThinkingLevel =>
  value === "off" ||
  value === "minimal" ||
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh";

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

const readJsonIfExists = async (p: string): Promise<unknown | undefined> => {
  if (!(await fileExists(p))) return undefined;
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw) as unknown;
};

const resolveConfigDir = (): string =>
  path.join(os.homedir(), ".config", "marvin");

const resolveProvider = (raw: unknown): KnownProvider | undefined => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const providers = getProviders();
  return providers.includes(raw as KnownProvider)
    ? (raw as KnownProvider)
    : undefined;
};

const resolveModel = (
  provider: KnownProvider,
  raw: unknown
): Model<Api> | undefined => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const models = getModels(provider);
  return models.find((m) => m.id === raw) as Model<Api> | undefined;
};

export interface LoadConfigOptions {
  cwd: string;
  configDir?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  systemPrompt?: string;
}

export const loadConfig = async (
  options: LoadConfigOptions
): Promise<LoadedConfig> => {
  const configDir = options.configDir ?? resolveConfigDir();
  const configPath = path.join(configDir, "config.json");

  const rawConfig = (await readJsonIfExists(configPath)) ?? {};
  const rawObj =
    typeof rawConfig === "object" && rawConfig !== null
      ? (rawConfig as Record<string, unknown>)
      : {};

  // Provider resolution: CLI option > config file
  const providerRaw =
    options.provider ??
    (typeof rawObj.provider === "string" ? rawObj.provider : undefined);

  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error(
      `Invalid or missing provider. Set "provider" in ${configPath} or pass provider option. Known: ${getProviders().join(", ")}`
    );
  }

  // Model resolution: CLI option > config file
  const modelIdRaw =
    options.model ??
    (typeof rawObj.model === "string" ? rawObj.model : undefined);

  const model = resolveModel(provider, modelIdRaw);
  if (!model) {
    const available = getModels(provider)
      .slice(0, 5)
      .map((m) => m.id)
      .join(", ");
    throw new Error(
      `Invalid or missing model for provider ${provider}. Set "model" in ${configPath} or pass model option. Examples: ${available}`
    );
  }

  const thinkingRaw = options.thinking ?? rawObj.thinking;
  const thinking: ThinkingLevel = isThinkingLevel(thinkingRaw)
    ? thinkingRaw
    : "off";

  // Load AGENTS.md from global and project (using provided cwd)
  const agentsConfig = await loadAgentsConfig(options.cwd);

  // Build system prompt
  const basePrompt =
    options.systemPrompt ??
    (typeof rawObj.systemPrompt === "string" && rawObj.systemPrompt.trim()
      ? rawObj.systemPrompt
      : "You are a helpful coding agent. Use tools (read, bash, edit, write) when needed.");

  const systemPrompt = agentsConfig.combined
    ? `${basePrompt}\n\n${agentsConfig.combined}`
    : basePrompt;

  return {
    provider,
    modelId: model.id,
    model,
    thinking,
    systemPrompt,
    agentsConfig,
    configDir,
  };
};
```

**Why**: Config loading that uses explicit cwd for project AGENTS.md discovery.

#### 4. Core types
**File**: `packages/sdk/src/types.ts` (new file)

**Add**:
```typescript
import type { AgentTool, Message } from "@marvin-agents/ai";
import type { ThinkingLevel } from "@marvin-agents/agent-core";

export interface AgentResult {
  /** Final text response from the agent */
  response: string;
  /** All messages from the conversation */
  messages: Message[];
  /** Tool calls that were executed */
  toolCalls: Array<{
    id: string;
    name: string;
    args: unknown;
    result: unknown;
    isError: boolean;
  }>;
  /** Token usage statistics */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

export interface RunAgentOptions {
  /** User prompt to send to the agent */
  prompt: string;
  /** Working directory for tools. Defaults to process.cwd() */
  cwd?: string;
  /** Override the default tools. If not provided, uses createTools(cwd) */
  tools?: AgentTool<any, any>[];
  /** Additional tools to add to the default set */
  additionalTools?: AgentTool<any, any>[];
  /** Override the system prompt. Can be string or function that modifies default */
  systemPrompt?: string | ((defaultPrompt: string) => string);
  /** Override the model (e.g., "claude-sonnet-4-20250514") */
  model?: string;
  /** Override the provider (e.g., "anthropic") */
  provider?: string;
  /** Thinking level for reasoning */
  thinking?: ThinkingLevel;
  /** Config directory override */
  configDir?: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}
```

**Why**: Define SDK interface types.

#### 5. runAgent implementation
**File**: `packages/sdk/src/run-agent.ts` (new file)

**Add**:
```typescript
import {
  Agent,
  ProviderTransport,
  RouterTransport,
  CodexTransport,
  loadTokens,
  saveTokens,
  clearTokens,
} from "@marvin-agents/agent-core";
import { getApiKey, type AgentEvent, type Message, type TextContent } from "@marvin-agents/ai";
import { createTools } from "@marvin-agents/base-tools";
import { loadConfig } from "./config.js";
import { ok, err, type Result } from "./result.js";
import type { AgentResult, RunAgentOptions } from "./types.js";

/**
 * Run an agent with a single prompt and get the final result.
 * 
 * @example
 * ```typescript
 * const result = await runAgent({
 *   prompt: "What files are in the src directory?",
 *   cwd: "/path/to/project"
 * });
 * 
 * if (result.ok) {
 *   console.log(result.value.response);
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 */
export async function runAgent(
  options: RunAgentOptions
): Promise<Result<AgentResult>> {
  try {
    const cwd = options.cwd ?? process.cwd();

    // Load config
    const config = await loadConfig({
      cwd,
      configDir: options.configDir,
      provider: options.provider,
      model: options.model,
      thinking: options.thinking,
    });

    // Build system prompt
    let systemPrompt = config.systemPrompt;
    if (options.systemPrompt) {
      if (typeof options.systemPrompt === "function") {
        systemPrompt = options.systemPrompt(systemPrompt);
      } else {
        systemPrompt = options.systemPrompt;
      }
    }

    // Build tools
    let tools = options.tools ?? createTools(cwd);
    if (options.additionalTools) {
      tools = [...tools, ...options.additionalTools];
    }

    // Create transport
    const getApiKeyForProvider = (provider: string) => {
      if (provider === "anthropic") {
        return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider);
      }
      return getApiKey(provider);
    };

    const providerTransport = new ProviderTransport({
      getApiKey: getApiKeyForProvider,
    });
    const codexTransport = new CodexTransport({
      getTokens: async () => loadTokens({ configDir: config.configDir }),
      setTokens: async (tokens) =>
        saveTokens(tokens, { configDir: config.configDir }),
      clearTokens: async () => clearTokens({ configDir: config.configDir }),
    });
    const transport = new RouterTransport({
      provider: providerTransport,
      codex: codexTransport,
    });

    // Create agent
    const agent = new Agent({
      transport,
      initialState: {
        systemPrompt,
        model: config.model,
        thinkingLevel: config.thinking,
        tools,
      },
    });

    // Collect results
    const toolCalls: AgentResult["toolCalls"] = [];
    let usage: AgentResult["usage"] = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    // Subscribe to events to track tool calls
    agent.subscribe((event: AgentEvent) => {
      if (event.type === "tool_execution_end") {
        toolCalls.push({
          id: event.toolCallId,
          name: event.toolName,
          args: undefined, // Not available in end event
          result: event.result,
          isError: event.isError,
        });
      }
    });

    // Run the agent
    await agent.prompt(options.prompt);
    await agent.waitForIdle();

    // Extract response from messages
    const messages = agent.state.messages;
    let response = "";

    // Find last assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        // Extract text content
        for (const content of msg.content) {
          if (content.type === "text") {
            response = (content as TextContent).text;
            break;
          }
        }
        // Extract usage
        if (msg.usage) {
          usage = {
            inputTokens: msg.usage.input ?? 0,
            outputTokens: msg.usage.output ?? 0,
            totalTokens: msg.usage.totalTokens ?? 0,
            cacheReadTokens: msg.usage.cacheRead ?? 0,
            cacheWriteTokens: msg.usage.cacheWrite ?? 0,
          };
        }
        break;
      }
    }

    // Check for error
    if (agent.state.error) {
      return err(new Error(agent.state.error));
    }

    return ok({
      response,
      messages: messages as Message[],
      toolCalls,
      usage,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
```

**Why**: Main SDK entry point for running agents.

#### 6. SDK public exports
**File**: `packages/sdk/src/index.ts` (new file)

**Add**:
```typescript
// Result type
export { ok, err, tryCatch, type Result } from "./result.js";

// Core function
export { runAgent } from "./run-agent.js";

// Types
export type { AgentResult, RunAgentOptions } from "./types.js";

// Config (for advanced use)
export { loadConfig, loadAgentsConfig } from "./config.js";
export type { LoadedConfig, LoadConfigOptions, AgentsConfig } from "./config.js";

// Re-export commonly needed types
export type { AgentTool, Message } from "@marvin-agents/ai";
export type { ThinkingLevel } from "@marvin-agents/agent-core";

// Re-export tool factories
export { createTools, createReadTool, createWriteTool, createEditTool, createBashTool } from "@marvin-agents/base-tools";
```

**Why**: Clean public API surface.

#### 7. Update root typecheck
**File**: `package.json`
**Location**: scripts.typecheck

**Before**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p packages/lsp/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

**After**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p packages/lsp/tsconfig.json && tsc --noEmit -p packages/sdk/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

**Why**: Include SDK in type checking.

#### 8. Add SDK tests
**File**: `packages/sdk/tests/run-agent.test.ts` (new file)

**Add**:
```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { runAgent } from "../src/run-agent.js";

// Note: Full integration tests require API keys
// These tests verify the structure and error handling

describe("runAgent", () => {
  it("returns error result when provider is missing", async () => {
    const result = await runAgent({
      prompt: "test",
      cwd: "/tmp",
      configDir: "/nonexistent/config",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("provider");
    }
  });

  it("accepts cwd parameter", async () => {
    // This will fail due to missing config, but validates options are accepted
    const result = await runAgent({
      prompt: "test",
      cwd: "/tmp/test-project",
      configDir: "/nonexistent/config",
    });

    expect(result.ok).toBe(false);
  });

  it("accepts systemPrompt override", async () => {
    const result = await runAgent({
      prompt: "test",
      cwd: "/tmp",
      systemPrompt: "Custom prompt",
      configDir: "/nonexistent/config",
    });

    expect(result.ok).toBe(false);
  });

  it("accepts systemPrompt function", async () => {
    const result = await runAgent({
      prompt: "test",
      cwd: "/tmp",
      systemPrompt: (def) => `${def}\n\nExtra context`,
      configDir: "/nonexistent/config",
    });

    expect(result.ok).toBe(false);
  });
});
```

**File**: `packages/sdk/tests/result.test.ts` (new file)

**Add**:
```typescript
import { describe, it, expect } from "bun:test";
import { ok, err, tryCatch } from "../src/result.js";

describe("Result", () => {
  describe("ok", () => {
    it("creates successful result", () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });
  });

  describe("err", () => {
    it("creates failed result", () => {
      const error = new Error("test error");
      const result = err(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe("tryCatch", () => {
    it("returns ok for successful operation", async () => {
      const result = await tryCatch(async () => 42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("returns err for failed operation", async () => {
      const result = await tryCatch(async () => {
        throw new Error("test error");
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("test error");
      }
    });

    it("wraps non-Error throws", async () => {
      const result = await tryCatch(async () => {
        throw "string error";
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("string error");
      }
    });
  });
});
```

**Why**: Verify SDK functionality.

### Edge Cases to Handle
- [ ] Missing provider in config: throw with helpful message
- [ ] Missing model in config: throw with helpful message
- [ ] API key not found: error in result, not thrown
- [ ] Agent abort: captured in result
- [ ] Empty response: return empty string in response field

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/sdk/tests
```

**Before proceeding to next phase**:
```bash
bun run check
```

**Manual**:
- [ ] Create `~/.config/marvin/config.json` with valid provider/model
- [ ] Run simple script using `runAgent()`
- [ ] Verify result structure matches interface

### Rollback
```bash
rm -rf packages/sdk
git restore -- package.json
```

### Notes
- SDK does not auto-load hooks or custom tools (app responsibility)
- Transport creation is internal; no hook injection points yet

---

## Phase 3: AgentSession + State Serialization

### Overview
Add `createAgentSession()` for multi-turn conversations with state serialization for prompt cache efficiency.

### Prerequisites
- [ ] Phase 2 automated checks pass

### Change Checklist
- [ ] Add session types
- [ ] Implement AgentSession class
- [ ] Add state serialization/deserialization
- [ ] Add createAgentSession factory
- [ ] Add tests

### Changes

#### 1. Session types
**File**: `packages/sdk/src/types.ts`
**Location**: end of file

**Add**:
```typescript
export interface SerializedState {
  /** Messages for prompt cache */
  messages: Message[];
  /** System prompt used */
  systemPrompt: string;
  /** Model ID */
  model: string;
  /** Provider */
  provider: string;
  /** Thinking level */
  thinking: ThinkingLevel;
  /** Serialization timestamp */
  timestamp: number;
}

export interface CreateSessionOptions {
  /** Working directory for tools. Defaults to process.cwd() */
  cwd?: string;
  /** Override the default tools */
  tools?: AgentTool<any, any>[];
  /** Additional tools to add */
  additionalTools?: AgentTool<any, any>[];
  /** Override system prompt */
  systemPrompt?: string | ((defaultPrompt: string) => string);
  /** Override model */
  model?: string;
  /** Override provider */
  provider?: string;
  /** Thinking level */
  thinking?: ThinkingLevel;
  /** Config directory override */
  configDir?: string;
  /** Restore from serialized state */
  state?: SerializedState;
}
```

**Why**: Define session interface types.

#### 2. AgentSession implementation
**File**: `packages/sdk/src/session.ts` (new file)

**Add**:
```typescript
import {
  Agent,
  ProviderTransport,
  RouterTransport,
  CodexTransport,
  loadTokens,
  saveTokens,
  clearTokens,
} from "@marvin-agents/agent-core";
import { getApiKey, type AgentEvent, type Message, type TextContent } from "@marvin-agents/ai";
import { createTools } from "@marvin-agents/base-tools";
import { loadConfig } from "./config.js";
import { ok, err, type Result } from "./result.js";
import type { AgentResult, CreateSessionOptions, SerializedState } from "./types.js";

export class AgentSession {
  private agent: Agent;
  private config: Awaited<ReturnType<typeof loadConfig>>;
  private cwd: string;

  private constructor(
    agent: Agent,
    config: Awaited<ReturnType<typeof loadConfig>>,
    cwd: string
  ) {
    this.agent = agent;
    this.config = config;
    this.cwd = cwd;
  }

  static async create(options: CreateSessionOptions = {}): Promise<AgentSession> {
    const cwd = options.cwd ?? process.cwd();

    // If restoring from state, use state's config
    const configOptions = options.state
      ? {
          cwd,
          configDir: options.configDir,
          provider: options.state.provider,
          model: options.state.model,
          thinking: options.state.thinking,
        }
      : {
          cwd,
          configDir: options.configDir,
          provider: options.provider,
          model: options.model,
          thinking: options.thinking,
        };

    const config = await loadConfig(configOptions);

    // Build system prompt
    let systemPrompt = options.state?.systemPrompt ?? config.systemPrompt;
    if (options.systemPrompt && !options.state) {
      if (typeof options.systemPrompt === "function") {
        systemPrompt = options.systemPrompt(systemPrompt);
      } else {
        systemPrompt = options.systemPrompt;
      }
    }

    // Build tools
    let tools = options.tools ?? createTools(cwd);
    if (options.additionalTools) {
      tools = [...tools, ...options.additionalTools];
    }

    // Create transport
    const getApiKeyForProvider = (provider: string) => {
      if (provider === "anthropic") {
        return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider);
      }
      return getApiKey(provider);
    };

    const providerTransport = new ProviderTransport({
      getApiKey: getApiKeyForProvider,
    });
    const codexTransport = new CodexTransport({
      getTokens: async () => loadTokens({ configDir: config.configDir }),
      setTokens: async (tokens) =>
        saveTokens(tokens, { configDir: config.configDir }),
      clearTokens: async () => clearTokens({ configDir: config.configDir }),
    });
    const transport = new RouterTransport({
      provider: providerTransport,
      codex: codexTransport,
    });

    // Create agent with restored messages if available
    const initialMessages = options.state?.messages ?? [];

    const agent = new Agent({
      transport,
      initialState: {
        systemPrompt,
        model: config.model,
        thinkingLevel: config.thinking,
        tools,
        messages: initialMessages,
      },
    });

    return new AgentSession(agent, config, cwd);
  }

  /**
   * Send a message and get the response.
   */
  async chat(prompt: string, signal?: AbortSignal): Promise<Result<AgentResult>> {
    try {
      const toolCalls: AgentResult["toolCalls"] = [];
      let usage: AgentResult["usage"] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };

      // Subscribe to track tool calls
      const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
        if (event.type === "tool_execution_end") {
          toolCalls.push({
            id: event.toolCallId,
            name: event.toolName,
            args: undefined,
            result: event.result,
            isError: event.isError,
          });
        }
      });

      try {
        await this.agent.prompt(prompt);
        await this.agent.waitForIdle();
      } finally {
        unsubscribe();
      }

      // Extract response
      const messages = this.agent.state.messages;
      let response = "";

      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === "assistant") {
          for (const content of msg.content) {
            if (content.type === "text") {
              response = (content as TextContent).text;
              break;
            }
          }
          if (msg.usage) {
            usage = {
              inputTokens: msg.usage.input ?? 0,
              outputTokens: msg.usage.output ?? 0,
              totalTokens: msg.usage.totalTokens ?? 0,
              cacheReadTokens: msg.usage.cacheRead ?? 0,
              cacheWriteTokens: msg.usage.cacheWrite ?? 0,
            };
          }
          break;
        }
      }

      if (this.agent.state.error) {
        return err(new Error(this.agent.state.error));
      }

      return ok({
        response,
        messages: messages as Message[],
        toolCalls,
        usage,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get current conversation state for serialization.
   */
  getState(): SerializedState {
    return {
      messages: this.agent.state.messages as Message[],
      systemPrompt: this.agent.state.systemPrompt,
      model: this.config.modelId,
      provider: this.config.provider,
      thinking: this.agent.state.thinkingLevel,
      timestamp: Date.now(),
    };
  }

  /**
   * Get all messages in the conversation.
   */
  getMessages(): Message[] {
    return this.agent.state.messages as Message[];
  }

  /**
   * Clear conversation history.
   */
  reset(): void {
    this.agent.reset();
  }

  /**
   * Abort current operation.
   */
  abort(): void {
    this.agent.abort();
  }
}

/**
 * Create a new agent session for multi-turn conversations.
 * 
 * @example
 * ```typescript
 * const session = await createAgentSession({ cwd: "/path/to/project" });
 * 
 * const r1 = await session.chat("What files are in src/?");
 * const r2 = await session.chat("Show me the main entry point");
 * 
 * // Save state for later
 * const state = session.getState();
 * fs.writeFileSync("session.json", JSON.stringify(state));
 * 
 * // Restore later
 * const restored = await createAgentSession({ state: JSON.parse(fs.readFileSync("session.json")) });
 * ```
 */
export async function createAgentSession(
  options: CreateSessionOptions = {}
): Promise<AgentSession> {
  return AgentSession.create(options);
}
```

**Why**: Multi-turn conversation support with state serialization.

#### 3. Update exports
**File**: `packages/sdk/src/index.ts`

**Add after runAgent export**:
```typescript
// Session
export { AgentSession, createAgentSession } from "./session.js";
export type { SerializedState, CreateSessionOptions } from "./types.js";
```

**Why**: Expose session API.

#### 4. Add session tests
**File**: `packages/sdk/tests/session.test.ts` (new file)

**Add**:
```typescript
import { describe, it, expect } from "bun:test";
import { createAgentSession } from "../src/session.js";
import type { SerializedState } from "../src/types.js";

describe("createAgentSession", () => {
  it("accepts cwd parameter", async () => {
    // Will fail due to missing config, but validates options
    try {
      await createAgentSession({
        cwd: "/tmp/test-project",
        configDir: "/nonexistent/config",
      });
    } catch (e) {
      expect((e as Error).message).toContain("provider");
    }
  });

  it("accepts state for restoration", async () => {
    const state: SerializedState = {
      messages: [],
      systemPrompt: "Test prompt",
      model: "gpt-4",
      provider: "openai",
      thinking: "off",
      timestamp: Date.now(),
    };

    try {
      await createAgentSession({
        state,
        configDir: "/nonexistent/config",
      });
    } catch (e) {
      // Expected to fail, but should accept the state parameter
      expect(e).toBeDefined();
    }
  });
});
```

**Why**: Validate session creation.

### Edge Cases to Handle
- [ ] Restore with missing tools: use new cwd's tools
- [ ] Restore with different model available: use config's model
- [ ] Empty message history: valid state

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/sdk/tests
```

**Before proceeding to next phase**:
```bash
bun run check
```

### Rollback
```bash
git restore -- packages/sdk/src/session.ts packages/sdk/src/types.ts packages/sdk/src/index.ts packages/sdk/tests/session.test.ts
```

---

## Phase 4: Streaming API

### Overview
Add `runAgentStream()` for streaming events during agent execution.

### Prerequisites
- [ ] Phase 3 automated checks pass

### Change Checklist
- [ ] Implement runAgentStream generator
- [ ] Add streaming types
- [ ] Add tests

### Changes

#### 1. Streaming types
**File**: `packages/sdk/src/types.ts`
**Location**: end of file

**Add**:
```typescript
// Re-export AgentEvent for streaming consumers
export type { AgentEvent } from "@marvin-agents/ai";

export interface StreamAgentOptions extends RunAgentOptions {
  /** Called when streaming starts */
  onStart?: () => void;
  /** Called when streaming ends */
  onEnd?: (result: Result<AgentResult>) => void;
}
```

**Why**: Streaming-specific types.

#### 2. runAgentStream implementation
**File**: `packages/sdk/src/stream.ts` (new file)

**Add**:
```typescript
import {
  Agent,
  ProviderTransport,
  RouterTransport,
  CodexTransport,
  loadTokens,
  saveTokens,
  clearTokens,
} from "@marvin-agents/agent-core";
import { getApiKey, type AgentEvent, type Message, type TextContent } from "@marvin-agents/ai";
import { createTools } from "@marvin-agents/base-tools";
import { loadConfig } from "./config.js";
import { ok, err, type Result } from "./result.js";
import type { AgentResult, StreamAgentOptions } from "./types.js";

/**
 * Run an agent with streaming events.
 * 
 * @example
 * ```typescript
 * for await (const event of runAgentStream({ prompt: "Hello", cwd: "/project" })) {
 *   if (event.type === "message_update") {
 *     process.stdout.write(event.assistantMessageEvent.delta?.text ?? "");
 *   }
 * }
 * ```
 */
export async function* runAgentStream(
  options: StreamAgentOptions
): AsyncGenerator<AgentEvent, Result<AgentResult>, undefined> {
  const cwd = options.cwd ?? process.cwd();

  try {
    // Load config
    const config = await loadConfig({
      cwd,
      configDir: options.configDir,
      provider: options.provider,
      model: options.model,
      thinking: options.thinking,
    });

    // Build system prompt
    let systemPrompt = config.systemPrompt;
    if (options.systemPrompt) {
      if (typeof options.systemPrompt === "function") {
        systemPrompt = options.systemPrompt(systemPrompt);
      } else {
        systemPrompt = options.systemPrompt;
      }
    }

    // Build tools
    let tools = options.tools ?? createTools(cwd);
    if (options.additionalTools) {
      tools = [...tools, ...options.additionalTools];
    }

    // Create transport
    const getApiKeyForProvider = (provider: string) => {
      if (provider === "anthropic") {
        return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider);
      }
      return getApiKey(provider);
    };

    const providerTransport = new ProviderTransport({
      getApiKey: getApiKeyForProvider,
    });
    const codexTransport = new CodexTransport({
      getTokens: async () => loadTokens({ configDir: config.configDir }),
      setTokens: async (tokens) =>
        saveTokens(tokens, { configDir: config.configDir }),
      clearTokens: async () => clearTokens({ configDir: config.configDir }),
    });
    const transport = new RouterTransport({
      provider: providerTransport,
      codex: codexTransport,
    });

    // Create agent
    const agent = new Agent({
      transport,
      initialState: {
        systemPrompt,
        model: config.model,
        thinkingLevel: config.thinking,
        tools,
      },
    });

    // Collect results
    const toolCalls: AgentResult["toolCalls"] = [];
    let usage: AgentResult["usage"] = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    // Create event queue
    const eventQueue: AgentEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;

    // Subscribe to events
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === "tool_execution_end") {
        toolCalls.push({
          id: event.toolCallId,
          name: event.toolName,
          args: undefined,
          result: event.result,
          isError: event.isError,
        });
      }

      eventQueue.push(event);
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    });

    // Start agent in background
    const agentPromise = (async () => {
      try {
        await agent.prompt(options.prompt);
        await agent.waitForIdle();
      } finally {
        done = true;
        if (resolveWait) {
          resolveWait();
        }
      }
    })();

    options.onStart?.();

    // Yield events as they arrive
    while (!done || eventQueue.length > 0) {
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }

      if (!done) {
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
    }

    // Wait for agent to complete
    await agentPromise;
    unsubscribe();

    // Extract response
    const messages = agent.state.messages;
    let response = "";

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        for (const content of msg.content) {
          if (content.type === "text") {
            response = (content as TextContent).text;
            break;
          }
        }
        if (msg.usage) {
          usage = {
            inputTokens: msg.usage.input ?? 0,
            outputTokens: msg.usage.output ?? 0,
            totalTokens: msg.usage.totalTokens ?? 0,
            cacheReadTokens: msg.usage.cacheRead ?? 0,
            cacheWriteTokens: msg.usage.cacheWrite ?? 0,
          };
        }
        break;
      }
    }

    const result = agent.state.error
      ? err(new Error(agent.state.error))
      : ok({
          response,
          messages: messages as Message[],
          toolCalls,
          usage,
        });

    options.onEnd?.(result);
    return result;
  } catch (e) {
    const result = err(e instanceof Error ? e : new Error(String(e)));
    options.onEnd?.(result);
    return result;
  }
}

/**
 * Collect all streaming events and return final result.
 * Convenience wrapper around runAgentStream.
 */
export async function collectStream(
  options: StreamAgentOptions
): Promise<{ events: AgentEvent[]; result: Result<AgentResult> }> {
  const events: AgentEvent[] = [];
  let result: Result<AgentResult> = err(new Error("No result"));

  const stream = runAgentStream(options);
  
  while (true) {
    const { value, done } = await stream.next();
    if (done) {
      result = value;
      break;
    }
    events.push(value);
  }

  return { events, result };
}
```

**Why**: Enable streaming for interactive use cases.

#### 3. Update exports
**File**: `packages/sdk/src/index.ts`

**Add**:
```typescript
// Streaming
export { runAgentStream, collectStream } from "./stream.js";
export type { StreamAgentOptions, AgentEvent } from "./types.js";
```

**Why**: Expose streaming API.

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/sdk/tests
```

### Rollback
```bash
git restore -- packages/sdk/src/stream.ts packages/sdk/src/types.ts packages/sdk/src/index.ts
```

---

## Phase 5: Documentation + Tests

### Overview
Add comprehensive documentation and integration tests.

### Prerequisites
- [ ] Phase 4 automated checks pass

### Change Checklist
- [ ] Create SDK README
- [ ] Add example scripts
- [ ] Add integration tests (require API keys)

### Changes

#### 1. SDK README
**File**: `packages/sdk/README.md` (new file)

**Add**:
```markdown
# @marvin-agents/sdk

A simple, embeddable SDK for building AI agents with Marvin.

## Installation

```bash
# From the monorepo
bun install
```

## Quick Start

```typescript
import { runAgent } from '@marvin-agents/sdk';

const result = await runAgent({
  prompt: "What files are in the src directory?",
  cwd: "/path/to/project"
});

if (result.ok) {
  console.log(result.value.response);
} else {
  console.error(result.error.message);
}
```

## API

### runAgent(options)

Run an agent with a single prompt and get the final result.

```typescript
interface RunAgentOptions {
  prompt: string;           // User prompt
  cwd?: string;             // Working directory (default: process.cwd())
  tools?: AgentTool[];      // Override default tools
  additionalTools?: AgentTool[];  // Add extra tools
  systemPrompt?: string | ((default: string) => string);
  model?: string;           // Override model
  provider?: string;        // Override provider
  thinking?: ThinkingLevel; // Reasoning level
  configDir?: string;       // Config directory
  signal?: AbortSignal;     // Cancellation
}
```

Returns `Promise<Result<AgentResult>>` where Result is:
- `{ ok: true, value: AgentResult }` on success
- `{ ok: false, error: Error }` on failure

### createAgentSession(options)

Create a multi-turn conversation session.

```typescript
const session = await createAgentSession({ cwd: "/project" });

const r1 = await session.chat("What files are here?");
const r2 = await session.chat("Show me the main file");

// Save state
const state = session.getState();
fs.writeFileSync("session.json", JSON.stringify(state));

// Restore later
const restored = await createAgentSession({ 
  state: JSON.parse(fs.readFileSync("session.json")) 
});
```

### runAgentStream(options)

Stream events during agent execution.

```typescript
for await (const event of runAgentStream({ prompt, cwd })) {
  if (event.type === "message_update") {
    // Handle streaming text
  }
  if (event.type === "tool_execution_start") {
    // Tool started
  }
}
```

### createTools(cwd)

Create cwd-bound tools for custom use.

```typescript
import { createTools, runAgent } from '@marvin-agents/sdk';

const tools = createTools("/path/to/project");
// tools are bound to /path/to/project

await runAgent({
  prompt: "...",
  tools,
  cwd: "/path/to/project"
});
```

## Configuration

The SDK loads configuration from `~/.config/marvin/config.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "thinking": "medium"
}
```

Environment variables for API keys:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- etc.

AGENTS.md files are loaded from:
- `~/.config/marvin/agents.md` (global)
- `./AGENTS.md` in the cwd (project)

## Examples

### Simple Script

```typescript
import { runAgent } from '@marvin-agents/sdk';

async function main() {
  const result = await runAgent({
    prompt: "Review this codebase for security issues",
    cwd: process.argv[2] || process.cwd()
  });

  if (result.ok) {
    console.log(result.value.response);
  } else {
    console.error("Error:", result.error.message);
    process.exit(1);
  }
}

main();
```

### Concurrent Multi-Repo

```typescript
import { runAgent } from '@marvin-agents/sdk';

const repos = ['/repo-a', '/repo-b', '/repo-c'];

const results = await Promise.all(
  repos.map(cwd => runAgent({ 
    prompt: "Audit dependencies for vulnerabilities",
    cwd 
  }))
);

for (let i = 0; i < repos.length; i++) {
  const r = results[i];
  console.log(`\n${repos[i]}:`);
  console.log(r.ok ? r.value.response : `Error: ${r.error.message}`);
}
```

### Custom Tools

```typescript
import { runAgent, createTools, type AgentTool } from '@marvin-agents/sdk';

const myTool: AgentTool = {
  name: "my_tool",
  label: "My Tool",
  description: "Does something custom",
  parameters: { type: "object", properties: {} },
  execute: async () => ({
    content: [{ type: "text", text: "Custom result" }],
    details: undefined
  })
};

await runAgent({
  prompt: "Use my_tool",
  additionalTools: [myTool]
});
```
```

**Why**: User-facing documentation.

#### 2. Example scripts
**File**: `packages/sdk/examples/simple.ts` (new file)

**Add**:
```typescript
#!/usr/bin/env bun
import { runAgent } from "../src/index.js";

async function main() {
  const cwd = process.argv[2] || process.cwd();
  const prompt = process.argv[3] || "List the files in the current directory";

  console.log(`Running agent in: ${cwd}`);
  console.log(`Prompt: ${prompt}\n`);

  const result = await runAgent({ prompt, cwd });

  if (result.ok) {
    console.log("Response:");
    console.log(result.value.response);
    console.log(`\nTokens: ${result.value.usage.totalTokens}`);
  } else {
    console.error("Error:", result.error.message);
    process.exit(1);
  }
}

main();
```

**Why**: Runnable example.

### Success Criteria

**Automated**:
```bash
bun run check
```

**Manual**:
- [ ] README renders correctly
- [ ] Example script runs with valid config

### Rollback
```bash
git restore -- packages/sdk/README.md packages/sdk/examples
```

---

## Testing Strategy

### Unit Tests (packages/sdk/tests/)
- `result.test.ts` - Result type utilities
- `run-agent.test.ts` - runAgent option validation
- `session.test.ts` - Session creation and state

### Unit Tests (packages/base-tools/tests/)
- `path-utils.test.ts` - CWD path resolution
- `tools.test.ts` - Tool factory behavior

### Integration Tests (require API keys)
- Full runAgent with real LLM call
- Multi-turn session with state serialization
- Concurrent multi-directory execution

### Manual Testing Checklist
1. [ ] Run `packages/sdk/examples/simple.ts` against a repo
2. [ ] Verify tool outputs reference correct directory
3. [ ] Create session, save state, restore, continue conversation
4. [ ] Run concurrent agents on different directories

## Deployment Instructions
N/A (internal SDK, not published yet)

## Anti-Patterns to Avoid
- Capturing `process.cwd()` at import time (use lazy resolution)
- Throwing errors instead of returning Result
- Auto-loading hooks/custom tools in SDK (app responsibility)

## Open Questions
None.

## References
- Base tools: `packages/base-tools/src/tools/*.ts`
- Agent class: `packages/agent/src/agent.ts`
- Config loading: `apps/coding-agent/src/config.ts`
- Similar SDK pattern: opencode's embedding API

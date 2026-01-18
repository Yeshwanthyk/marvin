# SDK-ready merlin repo migration implementation guide

> Purpose: Tutorial for rebuilding the project in a new repo, package by package, while making the codebase SDK-ready.
> Time estimate: 16-24 hours of focused coding (spread over several sessions)
> Difficulty: Advanced

---

## Table of Contents

- [Background and Context](#background-and-context)
- [Milestone 0: Migration Prep](#milestone-0-migration-prep-and-guardrails)
- [Milestone 1: Root Infrastructure](#milestone-1-root-infrastructure-in-the-new-repo)
- [Milestone 2: packages/ai](#milestone-2-migrate-packagesai)
- [Milestone 3: packages/agent](#milestone-3-migrate-packagesagent)
- [Milestone 4: packages/base-tools](#milestone-4-migrate-packagesbase-tools-and-make-tools-cwd-aware)
- [Milestone 5: packages/lsp](#milestone-5-migrate-packageslsp)
- [Milestone 6: packages/sdk](#milestone-6-create-packagessdk)
- [Milestone 7: packages/open-tui](#milestone-7-migrate-packagesopen-tui-if-keeping-the-cli)
- [Milestone 8: apps/coding-agent](#milestone-8-migrate-appscoding-agent-and-dogfood-sdk)
- [Milestone 9: Legacy Compatibility](#milestone-9-legacy-compatibility-optional)
- [Testing Strategy](#testing-strategy)
- [Troubleshooting](#troubleshooting-quick-hits)

---

## Background and context

### Why we are doing this

- You want to learn the system deeply by rebuilding it section by section.
- The current repo has tight coupling to `process.cwd()` and config paths, which blocks clean embedding.
- The embedded SDK plan requires cwd-correct tools and reusable wiring outside the CLI app.
- A clean-room repo migration is the best place to fix assumptions without destabilizing the existing repo.

### Naming baseline (assumed in this guide)

This guide assumes the new repo is merlin from day one. Use this mapping everywhere as you migrate:

| Old | New |
|-----|-----|
| Package scope: `@marvin-agents/*` | `@merlin-agents/*` |
| CLI binary: `marvin` | `merlin` |
| Config dir: `~/.config/marvin` | `~/.config/merlin` |
| Codex cache: `~/.marvin/cache` | `~/.merlin/cache` |
| Env vars: `MARVIN_*` | `MERLIN_*` |
| Default theme: `marvin` | `merlin` |
| Hook API parameter name in examples: `marvin` | `merlin` |
| Repo name and URLs: `marvin` | `merlin` |

### What "SDK-ready" means here

The goal is to make the core agent functionality usable as an embeddable library, not just a CLI tool. Specifically:

1. **All default tools can be bound to a specific cwd** (not implicitly `process.cwd()`).
2. **Config loading can target a specific cwd** (for project AGENTS.md and CLAUDE.md).
3. **Transport wiring is reusable outside the CLI** (no TUI or hook assumptions).
4. **The SDK does not auto-load hooks or custom tools**; it accepts explicit tool lists.
5. **The CLI app becomes a consumer of the SDK**, not the owner of wiring.

### How the current system works (mental model)

#### Package layering

```
packages/ai        → LLM types, models, providers, tool schemas
packages/agent     → Agent state, transports, Codex OAuth, message lifecycle
packages/base-tools→ read/write/edit/bash tools
packages/lsp       → LSP diagnostics wrapper for write/edit tools
packages/open-tui  → TUI components and autocomplete
apps/coding-agent  → CLI app: config, tools, hooks, TUI, sessions
```

#### Tool pipeline (TUI and headless)

```
config → built-in tools + custom tools → hook wrapper → LSP wrapper → Agent
```

This ordering matters! The hook wrapper intercepts tool execution, and the LSP wrapper adds diagnostics *after* hooks run.

#### Mode entrypoints

The CLI has three modes:
- **TUI**: `apps/coding-agent/src/tui-app.tsx` (full interactive experience)
- **Headless**: `apps/coding-agent/src/headless.ts` (single prompt, JSON output)
- **ACP**: `apps/coding-agent/src/acp/index.ts` (Zed editor integration)

#### Key coupling issues to remove for SDK readiness

1. **`process.cwd()` used implicitly** - Tools use `path.resolve()` which defaults to process.cwd()
2. **Hardcoded config paths** - `~/.config/marvin` baked into multiple files
3. **Cache paths hardcoded** - `~/.marvin/cache` for Codex instructions
4. **Session storage paths** - Based on process.cwd() at construction time

---

## Key files to understand (read these in the old repo)

### Core Files - Quick Reference

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
| `apps/coding-agent/src/profiler.ts` | Profiler env var | Rename `MARVIN_*` → `MERLIN_*` |
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

### Deep Dive: packages/base-tools

The base-tools package contains the core file manipulation tools. Here's how they currently work:

#### path-utils.ts - Current Implementation

```typescript
// packages/base-tools/src/tools/path-utils.ts
import { accessSync, constants } from "node:fs";
import * as os from "node:os";

// Handles unicode spaces that can appear in file paths (e.g., from macOS screenshots)
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

function normalizeUnicodeSpaces(str: string): string {
  return str.replace(UNICODE_SPACES, " ");
}

// macOS screenshots have weird AM/PM spacing - this fixes that
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

// Expands ~ to home directory
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

// For read operations: tries the literal path first, then macOS variant
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

**Problem:** This file only handles tilde expansion. When tools call `path.resolve(expandPath(path))`, the `path.resolve()` uses `process.cwd()` implicitly for relative paths.

#### read.ts - Current Implementation

```typescript
// packages/base-tools/src/tools/read.ts (simplified)
import { resolve as resolvePath } from "path";
import { resolveReadPath } from "./path-utils.js";

// ... schema definition ...

export const readTool: AgentTool<typeof schema, ReadDetails> = {
  name: "read",
  label: "read",
  description: "Read the contents of a file...",
  parameters: schema,
  execute: async (_toolCallId, params, signal) => {
    const { path, offset, limit } = params;
    
    // THE PROBLEM: resolvePath uses process.cwd() implicitly!
    const absolutePath = resolvePath(resolveReadPath(path));
    
    // ... rest of implementation
  },
};
```

#### bash.ts - Current Implementation

```typescript
// packages/base-tools/src/tools/bash.ts (simplified)
import { spawn } from "child_process";
import { getShellConfig } from "../utils/shell.js";

export const bashTool: AgentTool<typeof schema, BashDetails> = {
  name: "bash",
  label: "bash",
  description: "Execute a bash command in the current working directory...",
  parameters: schema,
  execute: async (_toolCallId, params, signal) => {
    const { command, timeout } = params;
    
    const { shell, args } = getShellConfig();
    // THE PROBLEM: No cwd option - inherits from parent process!
    const child = spawn(shell, [...args, command], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    // ... rest of implementation
  },
};
```

### Deep Dive: apps/coding-agent/src/config.ts

This file handles loading configuration and merging AGENTS.md files:

```typescript
// apps/coding-agent/src/config.ts (key parts)
import * as path from "path";
import * as os from "os";

// GLOBAL paths - searched in order, first found wins
const GLOBAL_AGENTS_PATHS = [
  () => path.join(os.homedir(), '.config', 'marvin', 'agents.md'),
  () => path.join(os.homedir(), '.codex', 'agents.md'),
  () => path.join(os.homedir(), '.claude', 'CLAUDE.md'),
];

// PROJECT paths - PROBLEM: Uses process.cwd() directly!
const PROJECT_AGENTS_PATHS = [
  () => path.join(process.cwd(), 'AGENTS.md'),
  () => path.join(process.cwd(), 'CLAUDE.md'),
];

// Default config directory - hardcoded!
const resolveConfigDir = (): string => path.join(os.homedir(), '.config', 'marvin');

// Loads first existing file from a list of path functions
const loadFirstExisting = async (pathFns: Array<() => string>): Promise<{ path: string; content: string } | undefined> => {
  for (const pathFn of pathFns) {
    const p = pathFn();
    const content = await readFileIfExists(p);
    if (content !== undefined) {
      return { path: p, content };
    }
  }
  return undefined;
};

// Merges global and project AGENTS.md files
export const loadAgentsConfig = async (): Promise<AgentsConfig> => {
  const global = await loadFirstExisting(GLOBAL_AGENTS_PATHS);
  const project = await loadFirstExisting(PROJECT_AGENTS_PATHS);

  const parts: string[] = [];
  if (global) parts.push(global.content);
  if (project) parts.push(project.content);

  return {
    global,
    project,
    combined: parts.join('\n\n---\n\n'),
  };
};

// Main config loader
export const loadAppConfig = async (options?: {
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
}): Promise<LoadedAppConfig> => {
  const configDir = options?.configDir ?? resolveConfigDir();
  const configPath = options?.configPath ?? path.join(configDir, 'config.json');

  // ... load config.json ...
  
  // Merge AGENTS.md content into system prompt
  const agentsConfig = await loadAgentsConfig();
  
  const systemPrompt = agentsConfig.combined
    ? `${basePrompt}\n\n${agentsConfig.combined}`
    : basePrompt;

  return { 
    provider, modelId, model, thinking, 
    theme: theme ?? 'marvin',  // Default theme name
    systemPrompt, agentsConfig, configDir, configPath, 
    // ... 
  };
};
```

**Problems to fix:**
1. `PROJECT_AGENTS_PATHS` uses `process.cwd()` directly
2. `resolveConfigDir` returns hardcoded `~/.config/marvin`
3. Default theme is `'marvin'`

### Deep Dive: Codex Instructions Cache

```typescript
// packages/agent/src/transports/codex/instructions.ts
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

// PROBLEM: Hardcoded cache directory!
const CACHE_DIR = join(process.env.HOME || "", ".marvin", "cache");
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

type ModelFamily = "gpt-5.2-codex" | "gpt-5.2";

const PROMPT_FILES: Record<ModelFamily, string> = {
  "gpt-5.2-codex": "gpt-5.2-codex_prompt.md",
  "gpt-5.2": "gpt_5_2_prompt.md",
};

function getCacheFiles(family: ModelFamily) {
  return {
    cache: join(CACHE_DIR, `codex-instructions-${family}.md`),
    meta: join(CACHE_DIR, `codex-instructions-${family}-meta.json`),
  };
}

export async function getCodexInstructions(model: string): Promise<string> {
  const family = getModelFamily(model);
  const { cache: CACHE_FILE, meta: CACHE_META_FILE } = getCacheFiles(family);

  try {
    // Check if cached and TTL valid
    if (existsSync(CACHE_META_FILE) && existsSync(CACHE_FILE)) {
      const meta = JSON.parse(readFileSync(CACHE_META_FILE, "utf-8"));
      if (Date.now() - meta.lastChecked < CACHE_TTL_MS) {
        return readFileSync(CACHE_FILE, "utf-8");
      }
    }

    // Fetch from GitHub...
    const tag = await getLatestReleaseTag();
    const url = `https://raw.githubusercontent.com/openai/codex/${tag}/codex-rs/core/${PROMPT_FILES[family]}`;
    
    // ... fetch and cache ...
  } catch (err) {
    // Fallback: return stale cache if available
    if (existsSync(CACHE_FILE)) {
      return readFileSync(CACHE_FILE, "utf-8");
    }
    throw err;
  }
}
```

### Deep Dive: Token Storage

```typescript
// packages/agent/src/codex-auth-cli.ts
import { homedir } from "os";
import { join } from "path";

// PROBLEM: Hardcoded config directories!
const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "marvin");
const LEGACY_CONFIG_DIR = join(homedir(), ".marvin");

export interface TokenStoreOptions {
  configDir?: string;
  tokensFile?: string;
}

function resolveTokensFile(options?: TokenStoreOptions): string {
  if (options?.tokensFile) return options.tokensFile;
  const configDir = options?.configDir ?? DEFAULT_CONFIG_DIR;
  return join(configDir, "codex-tokens.json");
}

// Loads tokens with legacy migration
export function loadTokens(options?: TokenStoreOptions): CodexTokens | null {
  const tokensFile = resolveTokensFile(options);
  
  try {
    const data = readFileSync(tokensFile, "utf-8");
    return JSON.parse(data);
  } catch {
    // Try legacy location
  }

  const legacyFile = join(LEGACY_CONFIG_DIR, "codex-tokens.json");
  try {
    const data = readFileSync(legacyFile, "utf-8");
    const tokens = JSON.parse(data);
    
    // Migrate: save to new location, delete old
    saveTokens(tokens, { configDir: DEFAULT_CONFIG_DIR });
    unlinkSync(legacyFile);
    
    return tokens;
  } catch {
    return null;
  }
}
```

### Deep Dive: Session Manager

```typescript
// apps/coding-agent/src/session-manager.ts
import { join } from "path";

// Converts /path/to/project → --path--to--project--
const safeCwd = (cwd: string): string => {
  return '--' + cwd.replace(/\//g, '--') + '--';
};

export class SessionManager {
  private configDir: string;
  private cwd: string;
  private sessionDir: string;

  // PROBLEM: Captures process.cwd() at construction time!
  constructor(configDir: string = join(process.env.HOME || '', '.config', 'marvin')) {
    this.configDir = configDir;
    this.cwd = process.cwd();  // <-- This is the issue
    this.sessionDir = join(configDir, 'sessions', safeCwd(this.cwd));
  }

  startSession(provider: string, modelId: string, thinkingLevel: ThinkingLevel): string {
    this.ensureDir();
    
    const id = randomUUID();
    const timestamp = Date.now();
    const filename = `${timestamp}_${id}.jsonl`;
    this.currentSessionPath = join(this.sessionDir, filename);
    
    // First line is metadata
    const metadata: SessionMetadata = {
      type: 'session',
      id,
      timestamp,
      cwd: this.cwd,
      provider,
      modelId,
      thinkingLevel,
    };
    
    writeFileSync(this.currentSessionPath, JSON.stringify(metadata) + '\n');
    return id;
  }

  // Appends messages as JSONL entries
  appendMessage(message: AppMessage): void {
    if (!this.currentSessionPath) return;

    const entry: SessionMessageEntry = {
      type: 'message',
      timestamp: Date.now(),
      message,
    };

    // Fire-and-forget async write
    appendFile(this.currentSessionPath, JSON.stringify(entry) + '\n', (err) => {
      if (err) console.error('Session write error:', err.message);
    });
  }
}
```

**Session file structure:**
```
~/.config/marvin/sessions/--Users--me--myproject--/
  1735689600000_abc123.jsonl   <- Each file is one session
  1735689700000_def456.jsonl
```

**JSONL format:**
```jsonl
{"type":"session","id":"abc123","timestamp":1735689600000,"cwd":"/Users/me/myproject",...}
{"type":"message","timestamp":1735689601000,"message":{"role":"user","content":"Hello"}}
{"type":"message","timestamp":1735689602000,"message":{"role":"assistant","content":"Hi!"}}
```

---

## Patterns to follow

### AgentTool pattern (schema + execute + abort handling)

Every tool follows this structure:

```typescript
import type { AgentTool } from "@merlin-agents/ai";
import { Type } from "@sinclair/typebox";

// 1. Define the parameter schema using TypeBox
const schema = Type.Object({
  input: Type.String({ description: "Example input" })
});

// 2. Define a type for the details returned (for UI rendering)
type ExampleDetails = { note: string | null };

// 3. Export the tool object
export const exampleTool: AgentTool<typeof schema, ExampleDetails> = {
  name: "example",          // Unique identifier
  label: "example",         // Display name in TUI
  description: "Demonstrates tool shape",  // Shown to LLM
  parameters: schema,
  execute: async (_toolCallId, params, signal) => {
    // Always check abort signal first
    if (signal?.aborted) throw new Error("aborted");
    
    const text = params.input;
    
    // Return format is always { content, details }
    return { 
      content: [{ type: "text", text }], 
      details: { note: null } 
    };
  },
};
```

### Hook wiring pattern (register events, call send)

Hooks are user-defined plugins that can observe and intercept agent behavior:

```typescript
import type { HookFactory } from "@merlin-agents/coding-agent/hooks";

// Default export is a factory function that receives the API
const hook: HookFactory = (merlin) => {
  // Register handlers for events
  merlin.on("agent.start", () => {
    // Use send() to inject messages into the conversation
    merlin.send("Starting a new agent turn");
  });
  
  // Can also intercept tool execution
  merlin.on("tool.execute.before", (event, ctx) => {
    console.log(`About to run ${event.toolName}`);
    // Return { block: true, reason: "..." } to prevent execution
  });
};

export default hook;
```

**Available events:**
- `app.start` - CLI started
- `session.start`, `session.resume`, `session.clear` - Session lifecycle
- `agent.start`, `agent.end` - Agent turn lifecycle
- `turn.start`, `turn.end` - Per-turn lifecycle (includes token usage)
- `tool.execute.before` - Before tool runs (can block)
- `tool.execute.after` - After tool runs (can modify result)

### Transport composition pattern

Transports handle communication with LLM providers:

```typescript
import { ProviderTransport, CodexTransport, RouterTransport } from "@merlin-agents/agent-core";

// Provider transport: handles Anthropic, OpenAI, Google, etc.
const providerTransport = new ProviderTransport({ 
  getApiKey: async (provider) => getApiKeyForProvider(provider) 
});

// Codex transport: handles OpenAI Codex with OAuth
const codexTransport = new CodexTransport({ 
  getTokens: async () => loadTokens({ configDir }), 
  setTokens: async (tokens) => saveTokens(tokens, { configDir }),
  clearTokens: async () => clearTokens({ configDir }),
});

// Router transport: routes requests based on model.provider
const transport = new RouterTransport({ 
  provider: providerTransport, 
  codex: codexTransport 
});

// When model.provider === "codex", uses codexTransport
// Otherwise, uses providerTransport
```

---

## Milestone 0: Migration prep and guardrails

### Goal

Define the new repo boundaries, naming, and the order of migration. Set up a repeatable audit process so every file you migrate is understood.

### Verification

- [ ] You have a new empty repo created and a working copy of the old repo open side by side.
- [ ] You can run `rg` and `bun` in both repos.

### Steps

#### 0.1 Lock naming baseline (merlin from day one)

Create a file `NAMING.md` in the new repo root:

```markdown
# Naming Conventions

## Package Scope
All packages use `@merlin-agents/*` scope.

## CLI Binary
The CLI is named `merlin`.

## Config Directory
Default config: `~/.config/merlin`
Legacy (for migration): `~/.config/marvin`, `~/.marvin`

## Cache Directory  
Default cache: `~/.merlin/cache`
Legacy: `~/.marvin/cache`

## Environment Variables
All env vars use `MERLIN_` prefix.

## Theme
Default theme is named `merlin`.
```

#### 0.2 Freeze the baseline

In the old repo, record the current state:

```bash
# Record current package versions
cat package.json | jq '{name, version, workspaces, scripts}' > ~/baseline-root.json

# Record all package.json files
for pkg in packages/*/package.json apps/*/package.json; do
  echo "=== $pkg ===" >> ~/baseline-packages.txt
  cat $pkg | jq '{name, version, dependencies, devDependencies}' >> ~/baseline-packages.txt
done
```

#### 0.3 Create an audit checklist

Create a tracking document (e.g., `MIGRATION-STATUS.md`):

```markdown
# Migration Status

## Milestone 1: Root Infrastructure
- [ ] package.json
- [ ] bunfig.toml
- [ ] tsconfig.base.json
- [ ] test/setup.ts
- [ ] scripts/test-all.ts
- [ ] .gitignore

## Milestone 2: packages/ai
- [ ] package.json
- [ ] src/index.ts
- [ ] src/agent/types.ts
- [ ] src/models.generated.ts
- [ ] scripts/generate-models.ts

## Milestone 3: packages/agent
...
```

### Watch out for

- Renaming at the same time as refactoring can hide behavioral changes.
- Changing public APIs without a compatibility plan can complicate later publishing.
- Keep a terminal open in the old repo to reference code as you work.

---

## Milestone 1: Root infrastructure in the new repo

### Goal

Replicate the workspace tooling so packages can be dropped in one at a time.

### Verification

- [ ] `bun install` succeeds in the new repo.
- [ ] `bun scripts/test-all.ts` runs (may say "No workspaces found" initially).

### File checklist

Copy and review each file from the old repo:

1. `package.json`
2. `bunfig.toml`
3. `tsconfig.base.json`
4. `test/setup.ts`
5. `scripts/test-all.ts`
6. `.gitignore`

### Steps

#### 1.1 Copy root `package.json`

Create `package.json` in the new repo:

```json
{
  "name": "merlin-agent",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "typecheck": "bun run --filter '*' typecheck",
    "test": "bun run scripts/test-all.ts",
    "merlin": "bun apps/coding-agent/src/index.ts"
  },
  "devDependencies": {
    "@sinclair/typebox": "^0.34.33",
    "typescript": "^5.8.3"
  },
  "overrides": {
    "solid-js": "1.9.5",
    "babel-preset-solid": "1.9.5"
  }
}
```

**Key changes from old:**
- `name` is now `merlin-agent` (was `marvin-agent`)
- `scripts.merlin` replaces `scripts.marvin`
- Keep the `overrides` for solid-js version pinning (TUI requires specific version)

#### 1.2 Copy `bunfig.toml`

```toml
[test]
preload = ["./test/setup.ts"]
```

This ensures the test setup runs before all tests.

#### 1.3 Copy `tsconfig.base.json`

This is the shared TypeScript config that all packages extend:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "lib": ["ES2022", "DOM"],
    "types": ["bun-types"]
  }
}
```

Don't change this yet - it matches the old repo's build settings.

#### 1.4 Copy `test/setup.ts`

```typescript
// test/setup.ts
// Disable colors in test output for consistent snapshots
process.env.NO_COLOR = "1";

// Limit stack traces for cleaner test output
Error.stackTraceLimit = 10;
```

#### 1.5 Copy `scripts/test-all.ts`

This script runs tests across all packages:

```typescript
#!/usr/bin/env bun
import { $ } from "bun";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const packagesDir = join(import.meta.dir, "..", "packages");
const appsDir = join(import.meta.dir, "..", "apps");

async function runTests() {
  const dirs = [
    ...readdirSync(packagesDir).map(d => join(packagesDir, d)),
    ...readdirSync(appsDir).map(d => join(appsDir, d)),
  ].filter(d => existsSync(join(d, "package.json")));

  if (dirs.length === 0) {
    console.log("No workspaces found");
    return;
  }

  for (const dir of dirs) {
    const pkg = await Bun.file(join(dir, "package.json")).json();
    if (pkg.scripts?.test) {
      console.log(`\n=== Testing ${pkg.name} ===`);
      await $`bun test ${dir}`.nothrow();
    }
  }
}

await runTests();
```

#### 1.6 Copy `.gitignore`

```gitignore
node_modules/
dist/
.DS_Store
*.log
.env
.env.local
coverage/
```

### Watch out for

- If you change the workspace layout later, update `scripts/test-all.ts` accordingly.
- The `overrides` in package.json are critical for solid-js compatibility.

---

## Milestone 2: Migrate `packages/ai`

### Goal

Bring over the LLM API layer with minimal changes. This package defines types for tools, messages, and models.

### What this package does

- Defines the `AgentTool` interface that all tools implement
- Provides the model catalog (generated from provider APIs)
- Contains provider-specific API wrappers
- Exports types used throughout the codebase

### Verification

- [ ] `bun run typecheck` for `packages/ai` passes.
- [ ] `bun run test` for `packages/ai` passes (currently a no-op).

### File checklist

```
packages/ai/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── src/
│   ├── index.ts              # Main exports
│   ├── agent/
│   │   └── types.ts          # AgentTool, AgentToolResult, etc.
│   ├── models.generated.ts   # Generated model catalog
│   └── ...
└── scripts/
    └── generate-models.ts    # Model generation script
```

### Steps

#### 2.1 Copy the entire package

```bash
# From old repo root
cp -r packages/ai ~/merlin/packages/
```

#### 2.2 Update package.json

Edit `packages/ai/package.json`:

```json
{
  "name": "@merlin-agents/ai",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "generate-models": "bun scripts/generate-models.ts"
  },
  "dependencies": {
    "@sinclair/typebox": "^0.34.33"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/your-org/merlin"
  }
}
```

**Key changes:**
- `name` is now `@merlin-agents/ai`
- Updated `repository.url` to new repo

#### 2.3 Understand the key types

The most important type is `AgentTool`:

```typescript
// packages/ai/src/agent/types.ts
import type { Static, TSchema } from "@sinclair/typebox";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export interface AgentToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];
  details?: TDetails;
}

export interface AgentTool<
  TParams extends TSchema = TSchema,
  TDetails = unknown
> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal?: AbortSignal,
    onUpdate?: (partial: AgentToolResult<TDetails>) => void
  ) => Promise<AgentToolResult<TDetails>>;
}
```

This interface is used by:
- Built-in tools (read, write, edit, bash)
- Custom user tools
- The agent loop to call tools

#### 2.4 Verify model generation workflow

The model catalog is generated from provider APIs. Don't run this unless you need updated models:

```bash
# Only run when you need to update models
cd packages/ai
bun run generate-models
```

This hits OpenAI, Anthropic, and Google APIs to fetch available models.

Ensure `src/models.generated.ts` exists - it's required for typechecking.

### Watch out for

- Running `generate-models` requires network access and API keys
- The generated file must be committed - it's not generated at build time
- Keep all exports in `src/index.ts` intact - other packages depend on them

---

## Milestone 3: Migrate `packages/agent`

### Goal

Move the agent core and make the Codex instructions cache path configurable for embedding.

### What this package does

- `Agent` class: manages conversation state, runs the agent loop
- Transports: handle communication with different LLM providers
- Codex OAuth: manages authentication with OpenAI Codex
- Types: message types, conversation events

### Verification

- [ ] `bun run typecheck` for `packages/agent` passes.
- [ ] Codex transport still resolves instructions without errors when tokens exist.

### File checklist

```
packages/agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── agent.ts                    # Main Agent class
│   ├── types.ts                    # Message types, events
│   ├── codex-auth-cli.ts           # Token storage (NEEDS UPDATE)
│   └── transports/
│       ├── index.ts
│       ├── RouterTransport.ts      # Routes to provider/codex
│       ├── ProviderTransport.ts    # Direct API calls
│       ├── CodexTransport.ts       # Codex OAuth (NEEDS UPDATE)
│       └── codex/
│           ├── instructions.ts     # Cache logic (NEEDS UPDATE)
│           ├── types.ts
│           └── constants.ts
```

### Steps

#### 3.1 Copy the package and update metadata

```bash
cp -r packages/agent ~/merlin/packages/
```

Edit `packages/agent/package.json`:

```json
{
  "name": "@merlin-agents/agent-core",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@merlin-agents/ai": "file:../ai"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

**Key changes:**
- `name` is now `@merlin-agents/agent-core`
- Dependencies point to `@merlin-agents/ai`

#### 3.2 Make Codex instruction caching configurable

**Before** (`packages/agent/src/transports/codex/instructions.ts`):

```typescript
// Hardcoded path!
const CACHE_DIR = join(process.env.HOME || "", ".marvin", "cache");
```

**After:**

```typescript
// packages/agent/src/transports/codex/instructions.ts
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

// Default cache directory (can be overridden)
const DEFAULT_CACHE_DIR = join(process.env.HOME || "", ".merlin", "cache");
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

type ModelFamily = "gpt-5.2-codex" | "gpt-5.2";

const PROMPT_FILES: Record<ModelFamily, string> = {
  "gpt-5.2-codex": "gpt-5.2-codex_prompt.md",
  "gpt-5.2": "gpt_5_2_prompt.md",
};

function getModelFamily(model: string): ModelFamily {
  const normalized = model.toLowerCase();
  if (normalized.includes("gpt-5.2-codex") || normalized.includes("gpt 5.2 codex")) {
    return "gpt-5.2-codex";
  }
  return "gpt-5.2";
}

function getCacheFiles(family: ModelFamily, cacheDir: string) {
  return {
    cache: join(cacheDir, `codex-instructions-${family}.md`),
    meta: join(cacheDir, `codex-instructions-${family}-meta.json`),
  };
}

// NEW: cacheDir parameter
export async function getCodexInstructions(
  model: string, 
  cacheDir?: string
): Promise<string> {
  const resolvedCacheDir = cacheDir ?? DEFAULT_CACHE_DIR;
  const family = getModelFamily(model);
  const { cache: cacheFile, meta: metaFile } = getCacheFiles(family, resolvedCacheDir);

  try {
    // Check if cached and TTL valid
    if (existsSync(metaFile) && existsSync(cacheFile)) {
      const meta = JSON.parse(readFileSync(metaFile, "utf-8"));
      if (Date.now() - meta.lastChecked < CACHE_TTL_MS) {
        return readFileSync(cacheFile, "utf-8");
      }
    }

    // Fetch latest release tag from GitHub
    const tag = await getLatestReleaseTag();
    const promptFile = PROMPT_FILES[family];
    const url = `https://raw.githubusercontent.com/openai/codex/${tag}/codex-rs/core/${promptFile}`;

    // Check if tag matches cached version
    if (existsSync(metaFile) && existsSync(cacheFile)) {
      const meta = JSON.parse(readFileSync(metaFile, "utf-8"));
      if (meta.tag === tag) {
        meta.lastChecked = Date.now();
        writeFileSync(metaFile, JSON.stringify(meta));
        return readFileSync(cacheFile, "utf-8");
      }
    }

    // Fetch and cache
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch instructions: ${res.status}`);
    const instructions = await res.text();

    mkdirSync(resolvedCacheDir, { recursive: true });
    writeFileSync(cacheFile, instructions);
    writeFileSync(metaFile, JSON.stringify({
      etag: res.headers.get("etag"),
      tag,
      lastChecked: Date.now(),
    }));

    return instructions;
  } catch (err) {
    // Fallback: return stale cache if available
    if (existsSync(cacheFile)) {
      return readFileSync(cacheFile, "utf-8");
    }
    throw err;
  }
}

async function getLatestReleaseTag(): Promise<string> {
  const res = await fetch("https://api.github.com/repos/openai/codex/releases/latest");
  if (!res.ok) throw new Error(`Failed to fetch release tag: ${res.status}`);
  const data = await res.json();
  return data.tag_name;
}
```

#### 3.3 Update CodexTransport to pass cacheDir

**Before:**

```typescript
// packages/agent/src/transports/CodexTransport.ts
export interface CodexTransportOptions {
  getTokens: () => Promise<CodexTokens | null>;
  setTokens: (tokens: CodexTokens) => Promise<void>;
  clearTokens: () => Promise<void>;
}
```

**After:**

```typescript
// packages/agent/src/transports/CodexTransport.ts
import { getCodexInstructions } from "./codex/instructions.js";

export interface CodexTransportOptions {
  getTokens: () => Promise<CodexTokens | null>;
  setTokens: (tokens: CodexTokens) => Promise<void>;
  clearTokens: () => Promise<void>;
  cacheDir?: string;  // NEW: optional cache directory
}

export class CodexTransport implements AgentTransport {
  private instructionsCache: Record<string, string> = {};
  private options: CodexTransportOptions;

  constructor(options: CodexTransportOptions) {
    this.options = options;
  }

  private async getInstructions(modelId: string): Promise<string> {
    // Cache per model family
    const cacheKey = modelId.toLowerCase().includes("codex") ? "codex" : "general";
    if (!this.instructionsCache[cacheKey]) {
      // Pass cacheDir to the instructions fetcher
      this.instructionsCache[cacheKey] = await getCodexInstructions(
        modelId, 
        this.options.cacheDir
      );
    }
    return this.instructionsCache[cacheKey];
  }

  // ... rest of implementation unchanged
}
```

#### 3.4 Update Codex auth CLI defaults

**Before:**

```typescript
// packages/agent/src/codex-auth-cli.ts
const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "marvin");
const LEGACY_CONFIG_DIR = join(homedir(), ".marvin");
```

**After:**

```typescript
// packages/agent/src/codex-auth-cli.ts
import { homedir } from "os";
import { join, basename, dirname } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync, unlinkSync } from "fs";

// NEW: Updated default to merlin
const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "merlin");

// Legacy paths for migration
const LEGACY_CONFIG_DIRS = [
  join(homedir(), ".config", "marvin"),  // Previous XDG location
  join(homedir(), ".marvin"),             // Original legacy location
];

export interface TokenStoreOptions {
  configDir?: string;
  tokensFile?: string;
}

function resolveTokensFile(options?: TokenStoreOptions): string {
  if (options?.tokensFile) return options.tokensFile;
  const configDir = options?.configDir ?? DEFAULT_CONFIG_DIR;
  return join(configDir, "codex-tokens.json");
}

function findLegacyTokensFile(): string | null {
  for (const dir of LEGACY_CONFIG_DIRS) {
    const file = join(dir, "codex-tokens.json");
    if (existsSync(file)) {
      return file;
    }
  }
  return null;
}

export function loadTokens(options?: TokenStoreOptions): CodexTokens | null {
  const tokensFile = resolveTokensFile(options);
  
  // Try primary location first
  try {
    const data = readFileSync(tokensFile, "utf-8");
    const parsed = JSON.parse(data);
    if (isCodexTokens(parsed)) return parsed;
  } catch {
    // Fall through to legacy
  }

  // Only check legacy if using default config (not custom path)
  if (options?.configDir || options?.tokensFile) {
    return null;
  }

  // Try legacy locations
  const legacyFile = findLegacyTokensFile();
  if (!legacyFile) return null;

  try {
    const data = readFileSync(legacyFile, "utf-8");
    const parsed = JSON.parse(data);
    if (!isCodexTokens(parsed)) return null;

    // Migrate to new location (best-effort)
    try {
      saveTokens(parsed, { configDir: DEFAULT_CONFIG_DIR });
      unlinkSync(legacyFile);
      console.error(`Migrated Codex tokens from ${legacyFile} to ${tokensFile}`);
    } catch {
      // Migration failed, but we have the tokens
    }

    return parsed;
  } catch {
    return null;
  }
}

// Security: 0o700 for directories, 0o600 for files
function ensurePrivateDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort
  }
}

function writePrivateFileAtomicSync(filePath: string, contents: string): void {
  const dir = dirname(filePath);
  ensurePrivateDirSync(dir);
  
  // Write to temp file, then atomic rename
  const tmpPath = join(dir, `.${basename(filePath)}.tmp.${process.pid}.${Date.now()}`);
  try {
    writeFileSync(tmpPath, contents, { mode: 0o600 });
    renameSync(tmpPath, filePath);
    chmodSync(filePath, 0o600);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* cleanup */ }
  }
}

export function saveTokens(tokens: CodexTokens, options?: TokenStoreOptions): void {
  const tokensFile = resolveTokensFile(options);
  writePrivateFileAtomicSync(tokensFile, `${JSON.stringify(tokens, null, 2)}\n`);
}

export function clearTokens(options?: TokenStoreOptions): void {
  const tokensFile = resolveTokensFile(options);
  try {
    unlinkSync(tokensFile);
  } catch {
    // File doesn't exist, that's fine
  }
}

function isCodexTokens(obj: unknown): obj is CodexTokens {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "access" in obj &&
    "refresh" in obj &&
    "expires" in obj &&
    typeof (obj as any).access === "string" &&
    typeof (obj as any).refresh === "string" &&
    typeof (obj as any).expires === "number"
  );
}
```

### Watch out for

- Adding `cacheDir` is a public API change - keep it optional with a sensible default
- The legacy migration should be transparent to users - they shouldn't need to do anything
- Token files contain secrets - always use restrictive file permissions

---

## Milestone 4: Migrate `packages/base-tools` and make tools cwd-aware

### Goal

Add factory functions so tools can be bound to a specific cwd while keeping existing default exports.

### What this package does

- Provides the four core tools: `read`, `write`, `edit`, `bash`
- Handles path resolution and expansion
- Manages file truncation for large outputs

### Verification

- [ ] `bun run test` for `packages/base-tools` runs real tests.
- [ ] A new unit test confirms `resolvePathFromCwd` works correctly.

### File checklist

```
packages/base-tools/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Main exports (NEEDS UPDATE)
│   └── tools/
│       ├── path-utils.ts     # Path resolution (NEEDS UPDATE)
│       ├── read.ts           # Read tool (NEEDS UPDATE)
│       ├── write.ts          # Write tool (NEEDS UPDATE)
│       ├── edit.ts           # Edit tool (NEEDS UPDATE)
│       ├── bash.ts           # Bash tool (NEEDS UPDATE)
│       └── truncate.ts       # Truncation logic (unchanged)
└── tests/
    └── path-utils.test.ts    # NEW: Unit tests
```

### Steps

#### 4.1 Update package metadata

Edit `packages/base-tools/package.json`:

```json
{
  "name": "@merlin-agents/base-tools",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@merlin-agents/ai": "file:../ai"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test tests/"
  }
}
```

#### 4.2 Extend path utilities with cwd helpers

This is the core change. We need to support binding tools to a specific working directory.

**Create new path-utils.ts:**

```typescript
// packages/base-tools/src/tools/path-utils.ts
import { accessSync, constants } from "node:fs";
import * as os from "node:os";
import { resolve as pathResolve } from "node:path";

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

// Expands ~ to home directory
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

// For read operations: tries literal path first, then macOS variant
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

// ============================================================
// NEW: CWD-aware path resolution
// ============================================================

/**
 * CwdLike can be:
 * - A string (the working directory path)
 * - A function that returns the working directory
 * - undefined (use process.cwd())
 */
export type CwdLike = string | (() => string) | undefined;

/**
 * A CwdResolver is a function that returns the current working directory.
 * We use functions instead of capturing strings to support dynamic cwd scenarios.
 */
export type CwdResolver = () => string;

/**
 * Converts a CwdLike to a CwdResolver function.
 * 
 * Why a function? Because we don't want to capture process.cwd() at module
 * import time. That would break tools if the process cwd changes later.
 */
export function toCwdResolver(cwd: CwdLike): CwdResolver {
  if (cwd === undefined) {
    // Default: use process.cwd() at call time
    return () => process.cwd();
  }
  if (typeof cwd === "function") {
    return cwd;
  }
  // String: return a constant
  return () => cwd;
}

/**
 * Resolves a file path relative to a cwd.
 * 
 * - If path starts with ~, expands to home directory
 * - If path is absolute, returns as-is
 * - If path is relative, resolves against cwd
 */
export function resolvePathFromCwd(filePath: string, cwd: CwdResolver): string {
  const expanded = expandPath(filePath);
  
  // If already absolute, just return it
  if (expanded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(expanded)) {
    return expanded;
  }
  
  // Resolve relative to cwd
  return pathResolve(cwd(), expanded);
}

/**
 * Like resolvePathFromCwd, but with macOS screenshot path handling.
 * Used by the read tool.
 */
export function resolveReadPathFromCwd(filePath: string, cwd: CwdResolver): string {
  const expanded = expandPath(filePath);
  
  // For absolute paths, check macOS variant first
  if (expanded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(expanded)) {
    if (fileExists(expanded)) {
      return expanded;
    }
    const macOSVariant = tryMacOSScreenshotPath(expanded);
    if (macOSVariant !== expanded && fileExists(macOSVariant)) {
      return macOSVariant;
    }
    return expanded;
  }
  
  // For relative paths, resolve against cwd first, then check variants
  const resolved = pathResolve(cwd(), expanded);
  if (fileExists(resolved)) {
    return resolved;
  }
  
  const macOSVariant = tryMacOSScreenshotPath(resolved);
  if (macOSVariant !== resolved && fileExists(macOSVariant)) {
    return macOSVariant;
  }
  
  return resolved;
}
```

#### 4.3 Add tool factories

Now we create factory functions for each tool. Each factory returns a tool bound to a specific cwd.

**read.ts - Add createReadTool:**

```typescript
// packages/base-tools/src/tools/read.ts
import type { AgentTool } from "@merlin-agents/ai";
import { Type } from "@sinclair/typebox";
import { readFile, stat } from "node:fs/promises";
import { 
  resolveReadPath, 
  resolveReadPathFromCwd, 
  toCwdResolver,
  type CwdLike 
} from "./path-utils.js";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.js";
import { truncateOutput, LINE_LIMIT, SIZE_LIMIT } from "./truncate.js";

const schema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Max lines to read" })),
});

export interface ReadDetails {
  path: string;
  mimeType: string | null;
  lineCount: number | null;
  truncated: boolean;
  offset: number | null;
  limit: number | null;
}

/**
 * Creates a read tool bound to a specific working directory.
 * 
 * @param cwd - The working directory. Can be:
 *   - A string path
 *   - A function that returns a path
 *   - undefined (uses process.cwd())
 */
export function createReadTool(cwd: CwdLike): AgentTool<typeof schema, ReadDetails> {
  const resolveCwd = toCwdResolver(cwd);

  return {
    name: "read",
    label: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. Returns full file content by default — only files exceeding ${LINE_LIMIT} lines or ${Math.round(SIZE_LIMIT / 1024)}KB are truncated (with instructions to continue).`,
    parameters: schema,
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) throw new Error("aborted");

      const { path, offset, limit } = params;
      
      // Use cwd-aware resolution
      const absolutePath = resolveReadPathFromCwd(path, resolveCwd);

      // Check if it's an image
      const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
      if (mimeType) {
        const buffer = await readFile(absolutePath);
        const base64 = buffer.toString("base64");
        return {
          content: [{ type: "image", source: { type: "base64", media_type: mimeType, data: base64 } }],
          details: { path: absolutePath, mimeType, lineCount: null, truncated: false, offset: null, limit: null },
        };
      }

      // Read text file
      const content = await readFile(absolutePath, "utf-8");
      const lines = content.split("\n");
      const lineCount = lines.length;

      // Handle offset/limit
      const startLine = offset ? Math.max(1, offset) - 1 : 0;
      const endLine = limit ? startLine + limit : lines.length;
      const selectedLines = lines.slice(startLine, endLine);
      const selectedContent = selectedLines.join("\n");

      // Truncate if needed
      const { text, truncated, actualOffset, actualLimit } = truncateOutput(
        selectedContent,
        offset,
        limit
      );

      return {
        content: [{ type: "text", text }],
        details: {
          path: absolutePath,
          mimeType: null,
          lineCount,
          truncated,
          offset: actualOffset,
          limit: actualLimit,
        },
      };
    },
  };
}

// Default export uses process.cwd()
export const readTool = createReadTool(undefined);
```

**bash.ts - Add createBashTool:**

```typescript
// packages/base-tools/src/tools/bash.ts
import type { AgentTool } from "@merlin-agents/ai";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { getShellConfig, killProcessTree } from "../utils/shell.js";
import { truncateOutput } from "./truncate.js";
import { toCwdResolver, type CwdLike } from "./path-utils.js";

const schema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
});

export interface BashDetails {
  code: number | null;
  signal: string | null;
  truncated: boolean;
}

/**
 * Creates a bash tool bound to a specific working directory.
 */
export function createBashTool(cwd: CwdLike): AgentTool<typeof schema, BashDetails> {
  const resolveCwd = toCwdResolver(cwd);

  return {
    name: "bash",
    label: "bash",
    description: "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 1500 lines or 100KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
    parameters: schema,
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) throw new Error("aborted");

      const { command, timeout } = params;
      const { shell, args } = getShellConfig();
      
      return new Promise((resolve, reject) => {
        const child = spawn(shell, [...args, command], {
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          cwd: resolveCwd(),  // <-- NOW USES CWD!
        });

        let stdout = "";
        let stderr = "";
        let killed = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        // Handle abort signal
        const onAbort = () => {
          killed = true;
          killProcessTree(child.pid!);
          reject(new Error("aborted"));
        };

        signal?.addEventListener("abort", onAbort, { once: true });

        // Handle timeout
        if (timeout && timeout > 0) {
          timeoutId = setTimeout(() => {
            killed = true;
            killProcessTree(child.pid!);
          }, timeout * 1000);
        }

        child.stdout.on("data", (data) => { stdout += data.toString(); });
        child.stderr.on("data", (data) => { stderr += data.toString(); });

        child.on("error", (err) => {
          if (timeoutId) clearTimeout(timeoutId);
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        });

        child.on("close", (code, sig) => {
          if (timeoutId) clearTimeout(timeoutId);
          signal?.removeEventListener("abort", onAbort);

          const combined = stdout + stderr;
          const { text, truncated } = truncateOutput(combined);

          resolve({
            content: [{ type: "text", text }],
            details: {
              code: killed && timeout ? null : code,
              signal: killed ? (timeout ? "TIMEOUT" : "ABORT") : sig,
              truncated,
            },
          });
        });
      });
    },
  };
}

// Default export uses process.cwd()
export const bashTool = createBashTool(undefined);
```

**write.ts - Add createWriteTool:**

```typescript
// packages/base-tools/src/tools/write.ts
import type { AgentTool } from "@merlin-agents/ai";
import { Type } from "@sinclair/typebox";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expandPath, resolvePathFromCwd, toCwdResolver, type CwdLike } from "./path-utils.js";

const schema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

export interface WriteDetails {
  path: string;
  bytesWritten: number;
}

/**
 * Creates a write tool bound to a specific working directory.
 */
export function createWriteTool(cwd: CwdLike): AgentTool<typeof schema, WriteDetails> {
  const resolveCwd = toCwdResolver(cwd);

  return {
    name: "write",
    label: "write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: schema,
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) throw new Error("aborted");

      const { path, content } = params;
      
      // Use cwd-aware resolution
      const absolutePath = resolvePathFromCwd(path, resolveCwd);
      const dir = dirname(absolutePath);

      // Ensure directory exists
      await mkdir(dir, { recursive: true });
      
      // Write file
      await writeFile(absolutePath, content, "utf-8");

      return {
        content: [{ type: "text", text: `Wrote ${content.length} bytes to ${absolutePath}` }],
        details: { path: absolutePath, bytesWritten: content.length },
      };
    },
  };
}

// Default export uses process.cwd()
export const writeTool = createWriteTool(undefined);
```

**edit.ts - Add createEditTool:**

```typescript
// packages/base-tools/src/tools/edit.ts
import type { AgentTool } from "@merlin-agents/ai";
import { Type } from "@sinclair/typebox";
import { readFile, writeFile } from "node:fs/promises";
import { resolvePathFromCwd, toCwdResolver, type CwdLike } from "./path-utils.js";

const schema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
  newText: Type.String({ description: "New text to replace the old text with" }),
});

export interface EditDetails {
  path: string;
  matchCount: number;
}

/**
 * Creates an edit tool bound to a specific working directory.
 */
export function createEditTool(cwd: CwdLike): AgentTool<typeof schema, EditDetails> {
  const resolveCwd = toCwdResolver(cwd);

  return {
    name: "edit",
    label: "edit",
    description: "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
    parameters: schema,
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) throw new Error("aborted");

      const { path, oldText, newText } = params;
      
      // Use cwd-aware resolution
      const absolutePath = resolvePathFromCwd(path, resolveCwd);

      // Read current content
      const content = await readFile(absolutePath, "utf-8");

      // Check if oldText exists
      if (!content.includes(oldText)) {
        throw new Error(`Could not find text to replace in ${absolutePath}. The oldText must match exactly.`);
      }

      // Count occurrences
      let matchCount = 0;
      let searchPos = 0;
      while ((searchPos = content.indexOf(oldText, searchPos)) !== -1) {
        matchCount++;
        searchPos += oldText.length;
      }

      // Replace all occurrences
      const newContent = content.replaceAll(oldText, newText);
      await writeFile(absolutePath, newContent, "utf-8");

      const message = matchCount === 1
        ? `Replaced 1 occurrence in ${absolutePath}`
        : `Replaced ${matchCount} occurrences in ${absolutePath}`;

      return {
        content: [{ type: "text", text: message }],
        details: { path: absolutePath, matchCount },
      };
    },
  };
}

// Default export uses process.cwd()
export const editTool = createEditTool(undefined);
```

#### 4.4 Add `createCodingTools` helper

Update the main index to export both defaults and factories:

```typescript
// packages/base-tools/src/index.ts
// Individual tool exports
export { readTool, createReadTool, type ReadDetails } from "./tools/read.js";
export { writeTool, createWriteTool, type WriteDetails } from "./tools/write.js";
export { editTool, createEditTool, type EditDetails } from "./tools/edit.js";
export { bashTool, createBashTool, type BashDetails } from "./tools/bash.js";

// Path utilities
export { 
  expandPath, 
  resolveReadPath,
  resolvePathFromCwd,
  resolveReadPathFromCwd,
  toCwdResolver,
  type CwdLike,
  type CwdResolver,
} from "./tools/path-utils.js";

// Tool registry (cwd-scoped)
import { createToolRegistry } from "./tool-registry.js";

export const toolRegistry = createToolRegistry(process.cwd());
```

#### 4.5 Add unit tests

Create `packages/base-tools/tests/path-utils.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { 
  expandPath, 
  resolvePathFromCwd, 
  resolveReadPathFromCwd,
  toCwdResolver 
} from "../src/tools/path-utils.js";

describe("expandPath", () => {
  test("expands ~ to home directory", () => {
    const result = expandPath("~");
    expect(result).toBe(process.env.HOME);
  });

  test("expands ~/path to home directory + path", () => {
    const result = expandPath("~/foo/bar");
    expect(result).toBe(`${process.env.HOME}/foo/bar`);
  });

  test("leaves absolute paths unchanged", () => {
    const result = expandPath("/absolute/path");
    expect(result).toBe("/absolute/path");
  });

  test("leaves relative paths unchanged", () => {
    const result = expandPath("relative/path");
    expect(result).toBe("relative/path");
  });
});

describe("toCwdResolver", () => {
  test("undefined returns process.cwd resolver", () => {
    const resolver = toCwdResolver(undefined);
    expect(resolver()).toBe(process.cwd());
  });

  test("string returns constant resolver", () => {
    const resolver = toCwdResolver("/custom/path");
    expect(resolver()).toBe("/custom/path");
  });

  test("function is returned as-is", () => {
    const fn = () => "/dynamic/path";
    const resolver = toCwdResolver(fn);
    expect(resolver).toBe(fn);
    expect(resolver()).toBe("/dynamic/path");
  });
});

describe("resolvePathFromCwd", () => {
  test("absolute paths are returned unchanged", () => {
    const cwd = toCwdResolver("/some/dir");
    const result = resolvePathFromCwd("/absolute/path", cwd);
    expect(result).toBe("/absolute/path");
  });

  test("relative paths are resolved against cwd", () => {
    const cwd = toCwdResolver("/project/root");
    const result = resolvePathFromCwd("src/file.ts", cwd);
    expect(result).toBe("/project/root/src/file.ts");
  });

  test("tilde paths are expanded before resolution", () => {
    const cwd = toCwdResolver("/project/root");
    const result = resolvePathFromCwd("~/Documents/file.txt", cwd);
    expect(result).toBe(`${process.env.HOME}/Documents/file.txt`);
  });

  test(".. navigation works correctly", () => {
    const cwd = toCwdResolver("/project/root/src");
    const result = resolvePathFromCwd("../package.json", cwd);
    expect(result).toBe("/project/root/package.json");
  });
});

describe("resolveReadPathFromCwd", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `path-utils-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("resolves existing files", () => {
    const filePath = join(testDir, "test.txt");
    writeFileSync(filePath, "content");
    
    const cwd = toCwdResolver(testDir);
    const result = resolveReadPathFromCwd("test.txt", cwd);
    expect(result).toBe(filePath);
  });

  test("returns resolved path for non-existent files", () => {
    const cwd = toCwdResolver(testDir);
    const result = resolveReadPathFromCwd("nonexistent.txt", cwd);
    expect(result).toBe(join(testDir, "nonexistent.txt"));
  });
});
```

### Watch out for

- **Never capture `process.cwd()` at module import time** - always use `toCwdResolver` to defer resolution
- The factories are the primary API for SDK users - the default exports are for backwards compatibility
- Do not export legacy tool arrays; use the tool registry + factories instead

---

## Milestone 5: Migrate `packages/lsp`

### Goal

Keep LSP wrappers compatible with cwd-bound tools and remove implicit cwd assumptions.

### What this package does

- Wraps `write` and `edit` tools to run LSP diagnostics after file changes
- Shows TypeScript errors inline in the agent response
- Only wraps tools that modify files (not `read` or `bash`)

### Verification

- [ ] `bun run typecheck` for `packages/lsp` passes.

### File checklist

```
packages/lsp/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── tool-wrapper.ts    # Main wrapper logic
    └── lsp-manager.ts     # LSP client management
```

### Steps

#### 5.1 Copy and update metadata

Edit `packages/lsp/package.json`:

```json
{
  "name": "@merlin-agents/lsp",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@merlin-agents/ai": "file:../ai"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

#### 5.2 Audit cwd usage in tool-wrapper.ts

The LSP wrapper already accepts `opts.cwd`. Verify it uses this consistently:

```typescript
// packages/lsp/src/tool-wrapper.ts
import type { AgentTool } from "@merlin-agents/ai";

export interface LspWrapOptions {
  cwd: string;
  onCheckStart?: () => void;
  onCheckEnd?: () => void;
}

/**
 * Wraps write and edit tools to run LSP diagnostics after execution.
 * 
 * Only wraps tools named "write" or "edit" - other tools pass through unchanged.
 */
export function wrapToolsWithLspDiagnostics(
  tools: AgentTool<any, any>[],
  lspManager: LspManager,
  opts: LspWrapOptions
): AgentTool<any, any>[] {
  return tools.map((tool) => {
    // Only wrap file-modifying tools
    if (tool.name !== "write" && tool.name !== "edit") {
      return tool;
    }

    return {
      ...tool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        // Run the original tool
        const result = await tool.execute(toolCallId, params, signal, onUpdate);

        // Run LSP diagnostics
        opts.onCheckStart?.();
        try {
          // Use opts.cwd, not process.cwd()
          const diagnostics = await lspManager.getDiagnostics(
            params.path, 
            opts.cwd
          );
          
          if (diagnostics.length > 0) {
            // Append diagnostics to the result
            const diagText = diagnostics
              .map(d => `${d.file}:${d.line}: ${d.message}`)
              .join("\n");
            
            return {
              ...result,
              content: [
                ...result.content,
                { type: "text", text: `\n\nLSP Diagnostics:\n${diagText}` },
              ],
            };
          }
        } finally {
          opts.onCheckEnd?.();
        }

        return result;
      },
    };
  });
}
```

The key point: `opts.cwd` is already passed in and used. No changes needed if it's already correct.

### Watch out for

- The wrapper uses `params.path` which may be relative - ensure LSP manager resolves it against `opts.cwd`
- Only `write` and `edit` are wrapped, not `bash` (which could also modify files, but that's a different discussion)

---

## Milestone 6: Create `packages/sdk`

### Goal

Introduce a small SDK that exposes `createMerlinAgent()` and exports config helpers.

### What this package does

- Provides a simple API for embedding the agent in other applications
- Handles config loading with cwd awareness
- Creates properly wired agents with default tools

### Verification

- [ ] `bun run typecheck` for `packages/sdk` passes.
- [ ] A simple embed example can run with tools bound to a custom cwd.

### File structure

```
packages/sdk/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Public exports
    ├── config.ts             # Config loading (moved from apps/coding-agent)
    └── merlin-agent.ts       # Agent factory
```

### Steps

#### 6.1 Create the package skeleton

Create `packages/sdk/package.json`:

```json
{
  "name": "@merlin-agents/sdk",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@merlin-agents/ai": "file:../ai",
    "@merlin-agents/agent-core": "file:../agent",
    "@merlin-agents/base-tools": "file:../base-tools",
    "@merlin-agents/lsp": "file:../lsp"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

Create `packages/sdk/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

#### 6.2 Move config logic into SDK

Create `packages/sdk/src/config.ts`:

```typescript
// packages/sdk/src/config.ts
import * as path from "path";
import * as os from "os";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ThinkingLevel } from "@merlin-agents/agent-core";
import { getProviders, getModels, type Model, type Api, type KnownProvider } from "@merlin-agents/ai";

// ============================================================
// Path Constants - Updated for merlin
// ============================================================

/**
 * Global AGENTS.md search paths (user-wide instructions).
 * Searched in order, first found wins.
 */
const GLOBAL_AGENTS_PATHS = [
  () => path.join(os.homedir(), '.config', 'merlin', 'agents.md'),
  () => path.join(os.homedir(), '.config', 'marvin', 'agents.md'),  // Legacy
  () => path.join(os.homedir(), '.codex', 'agents.md'),             // Codex compat
  () => path.join(os.homedir(), '.claude', 'CLAUDE.md'),            // Claude compat
];

/**
 * Returns project-level AGENTS.md search paths for a given cwd.
 * 
 * @param cwd - The project working directory
 * @returns Array of path functions, searched in order
 */
const projectAgentsPaths = (cwd: string) => [
  () => path.join(cwd, 'AGENTS.md'),
  () => path.join(cwd, 'CLAUDE.md'),
];

/**
 * Returns the default config directory.
 * Changed from ~/.config/marvin to ~/.config/merlin.
 */
export const resolveConfigDir = (): string => 
  path.join(os.homedir(), '.config', 'merlin');

// ============================================================
// Types
// ============================================================

export interface AgentsConfig {
  global?: { path: string; content: string };
  project?: { path: string; content: string };
  combined: string;
}

export interface EditorConfig {
  command: string;
  args: string[];
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
}

// ============================================================
// Helpers
// ============================================================

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

async function readJsonIfExists(filePath: string): Promise<unknown> {
  const content = await readFileIfExists(filePath);
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

async function loadFirstExisting(
  pathFns: Array<() => string>
): Promise<{ path: string; content: string } | undefined> {
  for (const pathFn of pathFns) {
    const p = pathFn();
    const content = await readFileIfExists(p);
    if (content !== undefined) {
      return { path: p, content };
    }
  }
  return undefined;
}

// ============================================================
// Public API
// ============================================================

/**
 * Loads AGENTS.md configuration from global and project paths.
 * 
 * @param options.cwd - Project directory for AGENTS.md lookup (default: process.cwd())
 * @returns Combined global + project instructions
 */
export const loadAgentsConfig = async (options?: { 
  cwd?: string 
}): Promise<AgentsConfig> => {
  const cwd = options?.cwd ?? process.cwd();
  
  const global = await loadFirstExisting(GLOBAL_AGENTS_PATHS);
  const project = await loadFirstExisting(projectAgentsPaths(cwd));

  const parts: string[] = [];
  if (global) parts.push(global.content);
  if (project) parts.push(project.content);

  return {
    global,
    project,
    combined: parts.join('\n\n---\n\n'),
  };
};

/**
 * Loads full application configuration.
 * 
 * @param options.cwd - Project directory (affects AGENTS.md loading)
 * @param options.configDir - Config directory (default: ~/.config/merlin)
 * @param options.configPath - Explicit config file path
 * @param options.provider - Override provider
 * @param options.model - Override model
 * @param options.thinking - Override thinking level
 */
export const loadAppConfig = async (options?: {
  cwd?: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
}): Promise<LoadedAppConfig> => {
  const cwd = options?.cwd ?? process.cwd();
  const configDir = options?.configDir ?? resolveConfigDir();
  const configPath = options?.configPath ?? path.join(configDir, 'config.json');

  // Load config.json
  const rawConfig = (await readJsonIfExists(configPath)) ?? {};
  const rawObj = typeof rawConfig === 'object' && rawConfig !== null 
    ? (rawConfig as Record<string, unknown>) 
    : {};

  // Support nested { config: {...} } structure
  const nestedConfig = typeof rawObj.config === 'object' && rawObj.config !== null
    ? (rawObj.config as Record<string, unknown>)
    : {};

  // Resolve provider (CLI > nested > top-level)
  const providerRaw = options?.provider ??
    (typeof nestedConfig.provider === 'string' ? nestedConfig.provider : undefined) ??
    (typeof rawObj.provider === 'string' ? rawObj.provider : undefined);

  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error(`Invalid or missing provider: ${providerRaw}`);
  }

  // Resolve model
  const modelIdRaw = options?.model ??
    (typeof nestedConfig.model === 'string' ? nestedConfig.model : undefined) ??
    (typeof rawObj.model === 'string' ? rawObj.model : undefined);

  const model = resolveModel(provider, modelIdRaw);
  if (!model) {
    throw new Error(`Invalid or missing model: ${modelIdRaw}`);
  }

  // Resolve other settings
  const thinking: ThinkingLevel = options?.thinking ??
    (typeof nestedConfig.thinking === 'string' ? nestedConfig.thinking as ThinkingLevel : undefined) ??
    (typeof rawObj.thinking === 'string' ? rawObj.thinking as ThinkingLevel : undefined) ??
    'off';

  // Theme default changed from 'marvin' to 'merlin'
  const theme: string = 
    (typeof rawObj.theme === 'string' ? rawObj.theme : undefined) ?? 'merlin';

  // LSP settings
  const lspRaw = typeof rawObj.lsp === 'object' && rawObj.lsp !== null
    ? (rawObj.lsp as Record<string, unknown>)
    : {};
  const lsp = {
    enabled: typeof lspRaw.enabled === 'boolean' ? lspRaw.enabled : true,
    autoInstall: typeof lspRaw.autoInstall === 'boolean' ? lspRaw.autoInstall : true,
  };

  // Load and merge AGENTS.md - NOW WITH CWD PARAMETER
  const agentsConfig = await loadAgentsConfig({ cwd });

  // Build system prompt
  const basePrompt = typeof rawObj.systemPrompt === 'string' && rawObj.systemPrompt.trim().length > 0
    ? rawObj.systemPrompt
    : 'You are a helpful coding agent. Use tools (read, bash, edit, write) when needed.';

  const systemPrompt = agentsConfig.combined
    ? `${basePrompt}\n\n${agentsConfig.combined}`
    : basePrompt;

  return {
    provider,
    modelId: model.id,
    model,
    thinking,
    theme,
    systemPrompt,
    agentsConfig,
    configDir,
    configPath,
    lsp,
  };
};

function resolveProvider(providerRaw: string | undefined): KnownProvider | undefined {
  const providers = getProviders();
  if (!providerRaw) {
    // Default to first available provider
    return providers[0];
  }
  return providers.find(p => p === providerRaw);
}

function resolveModel(provider: KnownProvider, modelIdRaw: string | undefined): Model<Api> | undefined {
  const models = getModels(provider);
  if (!modelIdRaw) {
    // Default to first model for provider
    return models[0];
  }
  return models.find(m => m.id === modelIdRaw);
}
```

#### 6.3 Implement the SDK agent factory

Create `packages/sdk/src/merlin-agent.ts`:

```typescript
// packages/sdk/src/merlin-agent.ts
import { Agent, ProviderTransport, CodexTransport, RouterTransport } from "@merlin-agents/agent-core";
import { createCodingTools } from "@merlin-agents/base-tools";
import { createLspManager, wrapToolsWithLspDiagnostics } from "@merlin-agents/lsp";
import type { AgentTool, Model, Api } from "@merlin-agents/ai";
import type { ThinkingLevel } from "@merlin-agents/agent-core";
import { loadAppConfig, type LoadedAppConfig } from "./config.js";

// ============================================================
// Types
// ============================================================

export interface MerlinAgentOptions {
  /**
   * Working directory for file tools and config loading.
   * Default: process.cwd()
   */
  cwd?: string;

  /**
   * Config directory (where config.json lives).
   * Default: ~/.config/merlin
   */
  configDir?: string;

  /**
   * Explicit config file path. Overrides configDir.
   */
  configPath?: string;

  /**
   * LLM provider override (e.g., "anthropic", "openai", "codex").
   */
  provider?: string;

  /**
   * Model ID override.
   */
  model?: string;

  /**
   * Thinking level override.
   */
  thinking?: ThinkingLevel;

  /**
   * Tools to use. Can be:
   * - An array of tools (replaces defaults)
   * - A function that receives default tools and returns modified tools
   * 
   * Default: createCodingTools(cwd)
   */
  tools?: AgentTool<any, any>[] | ((defaults: AgentTool<any, any>[]) => AgentTool<any, any>[]);

  /**
   * Custom transport. If provided, bypasses default transport creation.
   * Use this for custom LLM integrations.
   */
  transport?: AgentTransport;

  /**
   * LSP configuration.
   * - false: disable LSP
   * - { enabled: true, autoInstall?: boolean }: enable LSP
   * 
   * Default: Uses config file settings
   */
  lsp?: false | { enabled: true; autoInstall?: boolean };

  /**
   * Function to retrieve API keys for providers.
   * Default: Reads from environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
   */
  getApiKey?: (provider: string) => Promise<string | undefined>;

  /**
   * Codex token management (for OpenAI Codex provider).
   * Only needed if using the codex provider.
   */
  codex?: {
    getTokens: () => Promise<{ access: string; refresh: string; expires: number } | null>;
    setTokens: (tokens: { access: string; refresh: string; expires: number }) => Promise<void>;
    clearTokens: () => Promise<void>;
  };
}

export interface MerlinAgent {
  /**
   * The underlying Agent instance.
   */
  agent: Agent;

  /**
   * The loaded configuration.
   */
  config: LoadedAppConfig;

  /**
   * Shuts down the agent, including any LSP processes.
   * Call this when done to clean up resources.
   */
  close: () => Promise<void>;
}

// ============================================================
// Factory
// ============================================================

/**
 * Creates a Merlin agent with sensible defaults.
 * 
 * This is the main entry point for embedding Merlin in other applications.
 * 
 * @example Basic usage
 * ```typescript
 * const { agent, close } = await createMerlinAgent({
 *   cwd: "/path/to/project",
 * });
 * 
 * // Use the agent
 * await agent.prompt("Hello!");
 * 
 * // Clean up
 * await close();
 * ```
 * 
 * @example With custom tools
 * ```typescript
 * const { agent, close } = await createMerlinAgent({
 *   cwd: "/path/to/project",
 *   tools: (defaults) => [...defaults, myCustomTool],
 * });
 * ```
 */
export async function createMerlinAgent(
  options: MerlinAgentOptions = {}
): Promise<MerlinAgent> {
  const cwd = options.cwd ?? process.cwd();
  
  // Load configuration
  const config = await loadAppConfig({
    cwd,
    configDir: options.configDir,
    configPath: options.configPath,
    provider: options.provider,
    model: options.model,
    thinking: options.thinking,
  });

  // Resolve LSP settings
  const lspSettings = options.lsp === false
    ? { enabled: false, autoInstall: false }
    : options.lsp ?? config.lsp;

  // Create tools
  const defaultTools = createCodingTools(cwd);
  let tools: AgentTool<any, any>[];
  
  if (typeof options.tools === "function") {
    tools = options.tools(defaultTools);
  } else if (options.tools) {
    tools = options.tools;
  } else {
    tools = defaultTools;
  }

  // Create LSP manager (if enabled)
  let lspManager: LspManager | null = null;
  if (lspSettings.enabled) {
    lspManager = createLspManager({
      cwd,
      configDir: config.configDir,
      enabled: true,
      autoInstall: lspSettings.autoInstall,
    });
    tools = wrapToolsWithLspDiagnostics(tools, lspManager, { cwd });
  }

  // Create transport
  const transport = options.transport ?? createDefaultTransport(options, config);

  // Create agent
  const agent = new Agent({
    transport,
    initialState: {
      systemPrompt: config.systemPrompt,
      model: config.model,
      thinkingLevel: config.thinking,
      tools,
    },
  });

  // Return wrapped agent with close function
  return {
    agent,
    config,
    close: async () => {
      if (lspManager) {
        await lspManager.stop();
      }
    },
  };
}

function createDefaultTransport(
  options: MerlinAgentOptions,
  config: LoadedAppConfig
): AgentTransport {
  const getApiKey = options.getApiKey ?? defaultGetApiKey;

  const providerTransport = new ProviderTransport({ getApiKey });

  // Only create Codex transport if tokens are provided
  let codexTransport: CodexTransport | undefined;
  if (options.codex) {
    codexTransport = new CodexTransport({
      getTokens: options.codex.getTokens,
      setTokens: options.codex.setTokens,
      clearTokens: options.codex.clearTokens,
      cacheDir: path.join(config.configDir, "..", ".merlin", "cache"),
    });
  }

  return new RouterTransport({
    provider: providerTransport,
    codex: codexTransport,
  });
}

async function defaultGetApiKey(provider: string): Promise<string | undefined> {
  const envMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    xai: "XAI_API_KEY",
  };
  
  const envVar = envMap[provider];
  return envVar ? process.env[envVar] : undefined;
}
```

#### 6.4 Re-export SDK surface

Create `packages/sdk/src/index.ts`:

```typescript
// packages/sdk/src/index.ts

// Main factory
export { 
  createMerlinAgent, 
  type MerlinAgentOptions, 
  type MerlinAgent 
} from "./merlin-agent.js";

// Config utilities
export { 
  loadAgentsConfig, 
  loadAppConfig, 
  resolveConfigDir,
  type AgentsConfig,
  type LoadedAppConfig,
  type EditorConfig,
} from "./config.js";

// Re-export key types from dependencies
export type { Agent, ThinkingLevel } from "@merlin-agents/agent-core";
export type { AgentTool, AgentToolResult, TextContent, ImageContent, Model, Api, KnownProvider } from "@merlin-agents/ai";
export { createToolRegistry, createReadTool, createWriteTool, createEditTool, createBashTool } from "@merlin-agents/base-tools";
```

#### 6.5 Update root typecheck script

Add `packages/sdk/tsconfig.json` to the root `typecheck` path in `package.json` workspaces.

### Watch out for

- **SDK should NOT auto-load hooks or custom tools** - that's CLI-specific behavior
- All cwd-dependent APIs should accept an optional `cwd` parameter
- The `close()` function is important - users must call it to clean up LSP processes

---

## Milestone 7: Migrate `packages/open-tui` (if keeping the CLI)

### Goal

Move the UI package unchanged and make sure callers pass explicit cwd to autocomplete.

### Verification

- [ ] `bun run typecheck` for `packages/open-tui` passes.

### File checklist

```
packages/open-tui/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── autocomplete/
    │   └── autocomplete.ts    # Has process.cwd() default
    └── context/
        └── theme.tsx          # Default theme name
```

### Steps

#### 7.1 Update package metadata

Edit `packages/open-tui/package.json`:

```json
{
  "name": "@merlin-agents/open-tui",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "solid-js": "^1.9.5"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

#### 7.2 Audit `CombinedAutocompleteProvider`

The autocomplete uses a `basePath` that defaults to `process.cwd()`:

```typescript
// packages/open-tui/src/autocomplete/autocomplete.ts
export interface AutocompleteOptions {
  basePath?: string;  // Defaults to process.cwd() if not provided
}

export function createAutocomplete(options?: AutocompleteOptions) {
  const basePath = options?.basePath ?? process.cwd();
  // ...
}
```

This is fine as a default, but the CLI should always pass `cwd` explicitly:

```typescript
// In tui-app.tsx
const autocomplete = createAutocomplete({ 
  basePath: cwd  // Always pass explicitly!
});
```

#### 7.3 Rename the built-in default theme

Find the default theme definition and rename:

```typescript
// packages/open-tui/src/context/theme.tsx

// Find this:
const defaultDarkTheme: Theme = {
  name: "marvin",
  // ...
};

// Change to:
const defaultDarkTheme: Theme = {
  name: "merlin",
  // ...
};

// Also update availableThemes():
export function availableThemes(): string[] {
  return [
    "merlin",  // Default, was "marvin"
    "dark",
    "light",
    // ... other themes
  ];
}
```

Keep the actual color values unchanged - only the name changes.

### Watch out for

- `solid-js` version must match the root `overrides` in package.json
- The TUI has many files - focus only on the cwd-related changes for now

---

## Milestone 8: Migrate `apps/coding-agent` and dogfood SDK

### Goal

Rebuild the CLI as a consumer of the SDK while keeping all existing features.

### Verification

- [ ] `bun run typecheck` for the app passes.
- [ ] `bun run merlin --help` works.
- [ ] `bun run merlin --headless "echo test"` works.

### File checklist

These are the key files that need updates:

```
apps/coding-agent/
├── package.json               # Rename package, update bin
├── scripts/build.ts           # Update output path
├── src/
│   ├── index.ts              # Rename all marvin strings
│   ├── headless.ts           # Use SDK
│   ├── tui-app.tsx           # Use SDK
│   ├── config.ts             # Re-export from SDK
│   ├── session-manager.ts    # Add cwd parameter
│   ├── profiler.ts           # Rename env vars
│   ├── theme-names.ts        # Update default theme
│   ├── hooks/
│   │   ├── types.ts          # Update docs
│   │   └── loader.ts         # Update paths
│   └── custom-tools/
│       └── loader.ts         # Update paths
└── examples/
    └── auto-compact.ts       # Rename env vars
```

### Steps

#### 8.1 Update package.json

```json
{
  "name": "@merlin-agents/coding-agent",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "merlin": "./src/index.ts"
  },
  "exports": {
    ".": "./src/index.ts",
    "./hooks": "./src/hooks/index.ts"
  },
  "dependencies": {
    "@merlin-agents/sdk": "file:../../packages/sdk",
    "@merlin-agents/open-tui": "file:../../packages/open-tui",
    "@merlin-agents/lsp": "file:../../packages/lsp"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "bun scripts/build.ts"
  }
}
```

#### 8.2 Update build.ts

```typescript
// apps/coding-agent/scripts/build.ts
#!/usr/bin/env bun
/**
 * Build script for merlin CLI
 * 
 * Single-step compile with Solid plugin - assets are embedded automatically.
 */
import solidPlugin from "@opentui/solid/bun-plugin";
import { readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const workspaceRoot = join(__dirname, "../../..");

// Changed from "marvin" to "merlin"
const outfile = process.argv[2] || join(process.env.HOME!, "commands", "merlin");

// ... rest of build script unchanged
```

#### 8.3 Apply rename sweep in index.ts

Find and replace all occurrences:

```typescript
// apps/coding-agent/src/index.ts

// In printHelp():
const help = `
Usage:
  merlin [options] [prompt...]

Options:
  --headless                   Run in headless mode (single prompt, JSON output)
  --provider <name>            LLM provider (anthropic, openai, google, codex)
  --model <id>                 Model ID
  --thinking <level>           Thinking level (off, minimal, low, medium, high, xhigh)
  --config-dir <dir>           Config directory (default: ~/.config/merlin)
  --config <path>              Config file path
  --acp                        Run as ACP server (Zed integration)
  --continue, -c               Continue last session
  --resume                     Pick a session to resume
  --version, -v                Show version
  --help, -h                   Show this help

Custom commands:
  Create ~/.config/merlin/commands/<name>.ts exporting (api) => ({ ... })

Custom hooks:
  Create ~/.config/merlin/hooks/<name>.ts exporting:
    export default function(merlin) { merlin.on(event, handler) }

  Events: app.start, session.start, session.resume, session.clear,
          agent.start, agent.end, turn.start, turn.end,
          tool.execute.before, tool.execute.after

  Use merlin.send(text) to inject messages into conversation.

Custom tools:
  Create ~/.config/merlin/tools/<name>.ts exporting:
    export default function(api) { return { name, description, parameters, execute } }
`;
```

#### 8.4 Update profiler.ts

```typescript
// apps/coding-agent/src/profiler.ts
export function isProfilingEnabled(): boolean {
  // Changed from MARVIN_TUI_PROFILE to MERLIN_TUI_PROFILE
  return process.env.MERLIN_TUI_PROFILE === "1";
}
```

#### 8.5 Update theme-names.ts

```typescript
// apps/coding-agent/src/theme-names.ts
/**
 * Available theme names.
 * "merlin" is the built-in default theme.
 */
export const THEME_NAMES = [
  "merlin",  // Changed from "marvin"
  "dark",
  "light",
  // ... other themes
];

export const DEFAULT_THEME = "merlin";
```

#### 8.6 Update hooks/loader.ts

```typescript
// apps/coding-agent/src/hooks/loader.ts
/**
 * Loads hooks from ~/.config/merlin/hooks/*.ts
 */
export async function loadHooks(configDir: string): Promise<LoadedHook[]> {
  const hooksDir = path.join(configDir, "hooks");
  // ...
}
```

#### 8.7 Update custom-tools/loader.ts

```typescript
// apps/coding-agent/src/custom-tools/loader.ts
/**
 * Loads custom tools from ~/.config/merlin/tools/*.ts
 */
export async function loadCustomTools(
  configDir: string,
  cwd: string,
  builtInToolNames: string[],
  sendRef: SendRef
): Promise<CustomToolsLoadResult> {
  const toolsDir = path.join(configDir, "tools");
  // ...
}
```

#### 8.8 Update hooks/types.ts

```typescript
// apps/coding-agent/src/hooks/types.ts
/**
 * Hook API provided to hook factories.
 * 
 * @example
 * ```typescript
 * import type { HookFactory } from "@merlin-agents/coding-agent/hooks";
 * 
 * const hook: HookFactory = (merlin) => {
 *   merlin.on("agent.start", () => {
 *     merlin.send("Hello!");
 *   });
 * };
 * 
 * export default hook;
 * ```
 */
export interface HookAPI {
  // ...
}
```

#### 8.9 Convert config.ts to re-export

```typescript
// apps/coding-agent/src/config.ts
// Re-export from SDK - app no longer owns config logic
export { 
  loadAgentsConfig, 
  loadAppConfig, 
  resolveConfigDir,
  type AgentsConfig,
  type LoadedAppConfig,
  type EditorConfig,
} from "@merlin-agents/sdk";

// App-specific config updates can stay here
export { updateAppConfig } from "./config-updates.js";
```

#### 8.10 Update headless.ts to use SDK

```typescript
// apps/coding-agent/src/headless.ts
import { createMerlinAgent } from "@merlin-agents/sdk";
import { loadTokens, saveTokens, clearTokens } from "@merlin-agents/agent-core";
import { loadHooks, HookRunner, wrapToolsWithHooks } from "./hooks/index.js";
import { loadCustomTools } from "./custom-tools/index.js";

export async function runHeadless(options: {
  prompt: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
}) {
  const cwd = process.cwd();
  
  // Use SDK to create base agent
  const { agent, config, close } = await createMerlinAgent({
    cwd,
    configDir: options.configDir,
    configPath: options.configPath,
    provider: options.provider,
    model: options.model,
    thinking: options.thinking,
    // Provide Codex token management
    codex: {
      getTokens: async () => loadTokens({ configDir: config.configDir }),
      setTokens: async (tokens) => saveTokens(tokens, { configDir: config.configDir }),
      clearTokens: async () => clearTokens({ configDir: config.configDir }),
    },
    // Custom tool handling stays in CLI layer
    tools: async (defaults) => {
      // Load hooks
      const hooks = await loadHooks(config.configDir);
      const hookRunner = new HookRunner(hooks, { cwd, configDir: config.configDir });
      
      // Load custom tools (sendRef is no-op in headless)
      const sendRef = { current: () => {} };
      const { tools: customTools } = await loadCustomTools(
        config.configDir,
        cwd,
        defaults.map(t => t.name),
        sendRef
      );
      
      // Combine and wrap with hooks
      const allTools = [...defaults, ...customTools.map(t => t.tool)];
      return wrapToolsWithHooks(allTools, hookRunner);
    },
  });

  try {
    // Run the prompt
    const result = await agent.prompt(options.prompt);
    
    // Output as JSON
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally {
    await close();
  }
}
```

#### 8.11 Update session-manager.ts

Add explicit cwd parameter:

```typescript
// apps/coding-agent/src/session-manager.ts
export class SessionManager {
  private configDir: string;
  private cwd: string;
  private sessionDir: string;

  constructor(options: { 
    configDir?: string; 
    cwd?: string;  // NEW: Explicit cwd parameter
  } = {}) {
    // Changed default from ~/.config/marvin to ~/.config/merlin
    this.configDir = options.configDir ?? join(process.env.HOME || '', '.config', 'merlin');
    this.cwd = options.cwd ?? process.cwd();  // Now can be passed explicitly
    this.sessionDir = join(this.configDir, 'sessions', safeCwd(this.cwd));
  }

  // ... rest unchanged
}
```

#### 8.12 Update examples

```typescript
// apps/coding-agent/examples/auto-compact.ts
// Changed from MARVIN_COMPACT_THRESHOLD to MERLIN_COMPACT_THRESHOLD
const threshold = parseInt(process.env.MERLIN_COMPACT_THRESHOLD ?? "80", 10);
```

#### 8.13 Update acp/index.ts

```typescript
// apps/coding-agent/src/acp/index.ts
// Change agent name from "Marvin" to "Merlin"
const ACP_AGENT_INFO = {
  name: "Merlin",
  version: pkg.version,
  // ...
};
```

### Watch out for

- The TUI render pipeline is complex - don't change it while migrating
- Build script requires the Solid plugin - use `bun run build` not `bun build --compile`
- The `sendRef` pattern allows late binding - don't break this

---

## Milestone 9: Legacy compatibility (optional)

### Goal

Offer a smooth path for existing marvin users to migrate into the merlin config layout.

### Verification

- [ ] `rg "marvin"` in new repo only returns intentional legacy paths.
- [ ] Running `merlin migrate` (if added) copies config without deleting old directory.

### Steps

#### 9.1 Add legacy config detection (SDK-level)

In `packages/sdk/src/config.ts`:

```typescript
// Check for legacy config on startup
export async function checkLegacyConfig(): Promise<{
  hasLegacy: boolean;
  legacyPath: string | null;
  message: string | null;
}> {
  const merlinConfig = path.join(os.homedir(), '.config', 'merlin');
  const marvinConfig = path.join(os.homedir(), '.config', 'marvin');
  
  const hasMerlin = existsSync(merlinConfig);
  const hasMarvin = existsSync(marvinConfig);
  
  if (!hasMerlin && hasMarvin) {
    return {
      hasLegacy: true,
      legacyPath: marvinConfig,
      message: `Found legacy config at ${marvinConfig}. Run 'merlin migrate' to copy to ${merlinConfig}.`,
    };
  }
  
  return { hasLegacy: false, legacyPath: null, message: null };
}
```

#### 9.2 Add explicit migration command (CLI-level)

Add to `apps/coding-agent/src/index.ts`:

```typescript
if (args.migrate) {
  await runMigrate();
  return;
}

async function runMigrate() {
  const merlinConfig = path.join(os.homedir(), '.config', 'merlin');
  const marvinConfig = path.join(os.homedir(), '.config', 'marvin');
  
  if (!existsSync(marvinConfig)) {
    console.log("No legacy config found at", marvinConfig);
    return;
  }
  
  if (existsSync(merlinConfig)) {
    console.log("Merlin config already exists at", merlinConfig);
    console.log("Manual migration needed. Legacy config:", marvinConfig);
    return;
  }
  
  // Copy directory
  console.log(`Copying ${marvinConfig} to ${merlinConfig}...`);
  await cp(marvinConfig, merlinConfig, { recursive: true });
  console.log("Migration complete!");
  console.log("Note: Original config preserved at", marvinConfig);
}
```

#### 9.3 Keep token migration in Codex auth helper

Already handled in Milestone 3 - the `loadTokens` function checks legacy paths.

### Watch out for

- **Never auto-migrate on startup** - always require explicit command
- **Never delete legacy config** - copy only, let users delete manually
- Show clear messages about what's happening

---

## Testing strategy

### Package-level checks

After each package is migrated:

```bash
# Typecheck everything
bun run typecheck

# Run all tests
bun run test
```

### SDK manual checks

Create a test script `test-sdk.ts`:

```typescript
// test-sdk.ts
import { createMerlinAgent } from "@merlin-agents/sdk";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function main() {
  // Create a temp project directory
  const projectDir = join(tmpdir(), `merlin-test-${Date.now()}`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "test.txt"), "Hello, world!");

  console.log("Testing SDK with cwd:", projectDir);

  const { agent, config, close } = await createMerlinAgent({
    cwd: projectDir,
  });

  console.log("Config loaded:");
  console.log("  Provider:", config.provider);
  console.log("  Model:", config.modelId);
  console.log("  ConfigDir:", config.configDir);

  // Test that read tool works with the bound cwd
  // (This would require an actual LLM call in production)
  console.log("Agent created successfully!");

  await close();
  rmSync(projectDir, { recursive: true });
  console.log("Test complete!");
}

main().catch(console.error);
```

Run with:
```bash
bun run test-sdk.ts
```

### CLI manual checks

```bash
# Help should work
bun run merlin --help

# Headless mode
bun run merlin --headless "echo test"

# TUI mode (interactive)
bun run merlin
# Then: open autocomplete, verify file suggestions are from current directory
```

---

## Troubleshooting quick hits

### TypeScript Errors

**Missing generated models:**
```bash
cd packages/ai
bun run generate-models
```

**Import path errors after rename:**
- Check all `@marvin-agents/*` imports are changed to `@merlin-agents/*`
- Check `file:../` paths in package.json dependencies

### Runtime Errors

**Codex instructions fail to cache:**
- Check `~/.merlin/cache` exists and is writable
- Check network connectivity to GitHub

**LSP diagnostics not appearing:**
- Ensure `wrapToolsWithLspDiagnostics` wraps `write` and `edit` tools
- Check that wrapping order is: hooks first, then LSP

**Session not saving:**
- Check `~/.config/merlin/sessions/` exists
- Check file permissions

### Build Errors

**Solid plugin error:**
- Must use `bun run build`, not `bun build --compile` directly
- Check `@opentui/solid/bun-plugin` is installed

**Binary output wrong location:**
- Default is `~/commands/merlin`
- Override with: `bun run build /path/to/output`

---

## Beyond the basics (optional enhancements)

1. **Add tests for cwd-bound tools** - Create temp directories, verify paths resolve correctly
2. **Add explicit cwd support to HookRunner** - For embedding hooks in SDK later
3. **Add SDK example package** - Demonstrate embedding in a separate repo
4. **Add config validation** - TypeBox schemas for config.json
5. **Add telemetry opt-in** - For usage analytics

---

## Quick reference

### Commands you will use

```bash
# Install dependencies
bun install

# Typecheck everything  
bun run typecheck

# Run all tests
bun run test

# Run CLI in dev mode
bun run merlin --help
bun run merlin --headless "echo test"

# Build binary
cd apps/coding-agent && bun run build
```

### Files you will touch most

1. `packages/base-tools/src/tools/path-utils.ts` - CWD resolution
2. `packages/base-tools/src/tools/read.ts` - Read tool factory
3. `packages/base-tools/src/tools/write.ts` - Write tool factory  
4. `packages/base-tools/src/tools/edit.ts` - Edit tool factory
5. `packages/base-tools/src/tools/bash.ts` - Bash tool factory
6. `packages/sdk/src/config.ts` - Config loading
7. `packages/sdk/src/merlin-agent.ts` - Agent factory
8. `apps/coding-agent/src/index.ts` - CLI entrypoint
9. `apps/coding-agent/src/headless.ts` - Headless mode
10. `apps/coding-agent/src/tui-app.tsx` - TUI mode
11. `apps/coding-agent/package.json` - Package config
12. `apps/coding-agent/scripts/build.ts` - Build script
13. `packages/agent/src/codex-auth-cli.ts` - Token storage

### Useful references in the old repo

- `apps/coding-agent/src/config.ts` - Config parsing and AGENTS.md merge
- `apps/coding-agent/src/index.ts` - CLI usage text and help output
- `apps/coding-agent/src/tui-app.tsx` - Full wiring path
- `packages/base-tools/src/index.ts` - Tool export shape
- `packages/agent/src/transports/CodexTransport.ts` - Transport wiring
- `packages/open-tui/src/context/theme.tsx` - Built-in theme name and defaults

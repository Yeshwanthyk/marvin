# Marvin LSP-in-the-loop (TS/Go/Rust/Python via basedpyright) — Implementation Plan

## Overview
Add low-latency semantic diagnostics into Marvin’s inner loop by wrapping `write`/`edit` tool results with LSP diagnostics (bounded, severity-first). Auto-install language servers into `~/.config/marvin/lsp/` (configDir) for a small, opinionated set of languages: TypeScript/JavaScript, Python (basedpyright), Go, Rust.

## Current State
Marvin’s agent loop is tool-driven; tools return `ToolResultMessage`. **Tool result `details` is stripped before being sent to the LLM**, so any diagnostics must be appended to tool result `content`.

### Key Discoveries
- Tool composition points:
  - Headless: tools built/wrapped at `apps/coding-agent/src/headless.ts:109`.
  - TUI: tools built/wrapped at `apps/coding-agent/src/tui-app.tsx:93`.
- Hook wrapper can mutate tool behavior after execution (`tool.execute.after`): `apps/coding-agent/src/hooks/tool-wrapper.ts:13`.
- LLM context drops tool `details`:
  - `packages/ai/src/agent/agent-loop.ts:164` strips `ToolResultMessage.details`.
- Built-in file mutators don’t run diagnostics:
  - `packages/base-tools/src/tools/write.ts:12` just writes and returns success.
  - `packages/base-tools/src/tools/edit.ts:118` edits and returns `details.diff` for UI, but no static checking.

## Desired End State
1. On successful `write`/`edit`:
   - If the target path is within `cwd` and extension is supported, Marvin appends bounded diagnostics to the tool output.
   - Example output (only when non-empty):
     ```
     This file has errors, please fix
     <file_diagnostics>
     ERROR [12:5] Type 'number' is not assignable to type 'string'.
     ...
     </file_diagnostics>
     ```
2. Supported servers are auto-installed (best-effort):
   - TS/JS: `typescript-language-server` + `typescript`
   - Python: `basedpyright` (spawn `basedpyright-langserver --stdio`)
   - Go: `gopls` via `go install ...@latest`
   - Rust: `rust-analyzer` via `rustup component add ...` (fallback: skip)
3. Failures are non-fatal:
   - Writes/edits still succeed.
   - LSP install/spawn/timeout errors do **not** throw; they result in no diagnostics and optionally a single-line note.
4. Diagnostics are bounded to avoid context rot:
   - Prefer severity `ERROR` then `WARN`; drop `INFO/HINT`.
   - Default caps: max 20 per file, max 5 other files, max 60 total lines.

### Verification (end state)
- Automated:
  ```bash
  bun run typecheck
  bun run test
  ```
- Manual:
  1) Introduce a type error in a `.ts` file.
  2) Prompt Marvin to `write`/`edit` that file.
  3) Confirm tool output includes `<file_diagnostics>` and is bounded.

## Out of Scope
- Linter LSPs (eslint/biome/ruff-lsp), format-on-save, per-edit linting.
- Symbol/hover tooling.
- LSP for paths outside `cwd`.
- Supporting languages beyond the 4 above.

## Error Handling Strategy
- **Install failures:** swallow; mark server broken with cooldown; don’t retry in a tight loop.
- **Spawn/initialize failures:** swallow; mark broken.
- **Diagnostics timeout:** treat as empty.
- **Abort:** if tool aborts, abort LSP wait quickly.

## Implementation Approach

### Why tool-wrapping (not base-tools changes)
- Keeps `packages/base-tools` deterministic.
- Wrapper ordering is controllable: run hooks first, then compute diagnostics from final disk state.
- Matches opencode’s architecture: tools provide LSP feedback.

### Wrapper ordering (important)
Diagnostics should reflect final disk state (including `tool.execute.after` hooks). Therefore:

```ts
const tools = wrapToolsWithLspDiagnostics(
  wrapToolsWithHooks(allTools, hookRunner),
  lspManager,
  { cwd }
)
```

---

## Phase 1: Add `@marvin-agents/lsp` workspace package

### Prerequisites
- [ ] Repo builds clean

### Changes

#### 1. New workspace package
**File**: `packages/lsp/package.json` (new)

**Add**:
```json
{
  "name": "@marvin-agents/lsp",
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
    "vscode-jsonrpc": "^9.0.0",
    "vscode-languageserver-types": "^3.17.5"
  }
}
```

#### 2. TypeScript config
**File**: `packages/lsp/tsconfig.json` (new)

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
  "exclude": ["dist", "node_modules", "tests"]
}
```

#### 3. Public entrypoint
**File**: `packages/lsp/src/index.ts` (new)

**Add**:
```ts
export { createLspManager } from "./manager.js"
export { wrapToolsWithLspDiagnostics } from "./tool-wrapper.js"
export type { LspManager, LspManagerOptions, LspDiagnosticCaps } from "./types.js"
```

#### 4. Root typecheck includes new package
**File**: `package.json`
**Lines**: 6

**Before**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

**After**:
```json
"typecheck": "tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/agent/tsconfig.json && tsc --noEmit -p packages/open-tui/tsconfig.json && tsc --noEmit -p packages/base-tools/tsconfig.json && tsc --noEmit -p packages/lsp/tsconfig.json && tsc --noEmit -p apps/coding-agent/tsconfig.json",
```

#### 5. App depends on LSP package
**File**: `apps/coding-agent/package.json`
**Lines**: 13-24

**Before**:
```json
"dependencies": {
  "@marvin-agents/agent-core": "file:../../packages/agent",
  "@marvin-agents/ai": "file:../../packages/ai",
  "@marvin-agents/base-tools": "file:../../packages/base-tools",
  "@marvin-agents/open-tui": "file:../../packages/open-tui",
  "@opentui/core": "0.1.62",
  "@opentui/solid": "0.1.62",
  "chalk": "^5.6.2",
  "cli-highlight": "^2.1.11",
  "diff": "^8.0.2",
  "solid-js": "1.9.9"
},
```

**After**:
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
},
```

### Success Criteria
- [ ] `bun run typecheck` compiles `packages/lsp`

### Rollback
```bash
git checkout HEAD -- package.json apps/coding-agent/package.json
rm -rf packages/lsp
```

---

## Phase 2: Implement LSP core (registry, install, client, manager)

### Prerequisites
- [ ] Phase 1 complete
- [ ] `bun install` succeeds

### Changes

#### 1. Core types
**File**: `packages/lsp/src/types.ts` (new)

**Add**:
```ts
import type { Diagnostic } from "vscode-languageserver-types"

export type LspServerId = "typescript" | "basedpyright" | "gopls" | "rust-analyzer"

export type LspDiagnosticCaps = {
  maxDiagnosticsPerFile: number
  maxProjectFiles: number
  maxTotalLines: number
}

export type LspManagerOptions = {
  cwd: string
  configDir: string
  enabled: boolean
  autoInstall: boolean
  caps?: Partial<LspDiagnosticCaps>
}

export interface LspManager {
  touchFile(filePath: string, opts: { waitForDiagnostics: boolean; signal?: AbortSignal }): Promise<void>
  diagnostics(): Promise<Record<string, Diagnostic[]>>
  shutdown(): Promise<void>
}

export type LspSpawnSpec = {
  serverId: LspServerId
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  initializationOptions?: Record<string, unknown>
}
```

#### 2. Path helpers
**File**: `packages/lsp/src/path.ts` (new)

**Add**:
```ts
import path from "node:path"
import { access } from "node:fs/promises"

export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function findUp(startDir: string, stopDir: string, targets: string[]): Promise<string | undefined> {
  let dir = path.resolve(startDir)
  const stop = path.resolve(stopDir)

  while (true) {
    for (const t of targets) {
      const candidate = path.join(dir, t)
      if (await fileExists(candidate)) return candidate
    }

    if (dir === stop) return undefined
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export function isWithinDir(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return !rel.startsWith("..") && !path.isAbsolute(rel)
}
```

#### 3. Registry (extensions, languageIds, root markers)
**File**: `packages/lsp/src/registry.ts` (new)

**Add**:
```ts
import path from "node:path"
import type { LspServerId } from "./types.js"
import { findUp } from "./path.js"

export const LANGUAGE_ID_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
}

export type LspServerDefinition = {
  id: LspServerId
  extensions: string[]
  rootMarkers: string[]
  priority: number
  detectRoot: (filePath: string, cwd: string) => Promise<string | undefined>
}

export async function detectRootByMarkers(filePath: string, cwd: string, markers: string[]): Promise<string> {
  const start = path.dirname(filePath)
  const hit = await findUp(start, cwd, markers)
  return hit ? path.dirname(hit) : cwd
}

export const SERVERS: LspServerDefinition[] = [
  {
    id: "typescript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    rootMarkers: [
      "package.json",
      "tsconfig.json",
      "jsconfig.json",
      "bun.lockb",
      "bun.lock",
      "pnpm-lock.yaml",
      "yarn.lock",
      "package-lock.json",
    ],
    priority: 10,
    detectRoot: (filePath, cwd) => detectRootByMarkers(filePath, cwd, [
      "package.json",
      "tsconfig.json",
      "jsconfig.json",
      "bun.lockb",
      "bun.lock",
      "pnpm-lock.yaml",
      "yarn.lock",
      "package-lock.json",
    ]),
  },
  {
    id: "basedpyright",
    extensions: [".py", ".pyi"],
    rootMarkers: [
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "Pipfile",
      "basedpyrightconfig.json",
      "pyrightconfig.json",
    ],
    priority: 10,
    detectRoot: (filePath, cwd) => detectRootByMarkers(filePath, cwd, [
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "Pipfile",
      "basedpyrightconfig.json",
      "pyrightconfig.json",
    ]),
  },
  {
    id: "gopls",
    extensions: [".go"],
    rootMarkers: ["go.work", "go.mod", "go.sum"],
    priority: 10,
    detectRoot: async (filePath, cwd) => {
      const start = path.dirname(filePath)
      const work = await findUp(start, cwd, ["go.work"])
      if (work) return path.dirname(work)
      const mod = await findUp(start, cwd, ["go.mod", "go.sum"])
      return mod ? path.dirname(mod) : cwd
    },
  },
  {
    id: "rust-analyzer",
    extensions: [".rs"],
    rootMarkers: ["Cargo.toml", "Cargo.lock"],
    priority: 10,
    detectRoot: (filePath, cwd) => detectRootByMarkers(filePath, cwd, ["Cargo.toml", "Cargo.lock"]),
  },
]

export function serversForFile(filePath: string): LspServerDefinition[] {
  const ext = path.extname(filePath)
  return SERVERS
    .filter((s) => s.extensions.includes(ext))
    .sort((a, b) => b.priority - a.priority)
}

export function languageIdForFile(filePath: string): string {
  const ext = path.extname(filePath)
  return LANGUAGE_ID_BY_EXT[ext] ?? "plaintext"
}
```

#### 4. Auto-install + spawn specs
**File**: `packages/lsp/src/install.ts` (new)

**Add**:
```ts
import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { fileExists } from "./path.js"
import type { LspServerId, LspSpawnSpec } from "./types.js"

type RunResult = { code: number; stdout: string; stderr: string }

async function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env, shell: false })
    let stdout = ""
    let stderr = ""

    const kill = () => {
      try { proc.kill("SIGTERM") } catch {}
      setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 5000)
    }

    if (signal) {
      if (signal.aborted) kill()
      else signal.addEventListener("abort", kill, { once: true })
    }

    proc.stdout?.on("data", (d) => { stdout += d.toString() })
    proc.stderr?.on("data", (d) => { stderr += d.toString() })

    proc.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", kill)
      resolve({ code: code ?? 1, stdout, stderr })
    })

    proc.on("error", () => {
      if (signal) signal.removeEventListener("abort", kill)
      resolve({ code: 1, stdout, stderr })
    })
  })
}

async function ensureDir(p: string) {
  await mkdir(p, { recursive: true })
}

async function which(cmd: string): Promise<string | undefined> {
  const pathEnv = process.env["PATH"] ?? ""
  const parts = pathEnv.split(path.delimiter).filter(Boolean)
  const exts = process.platform === "win32"
    ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""]

  for (const dir of parts) {
    for (const ext of exts) {
      const candidate = path.join(dir, process.platform === "win32" ? cmd + ext : cmd)
      if (await fileExists(candidate)) return candidate
    }
  }

  return undefined
}

async function resolvePackageBin(nodeDir: string, packageName: string, binName: string): Promise<string | undefined> {
  const pkgPath = path.join(nodeDir, "node_modules", packageName, "package.json")
  if (!(await fileExists(pkgPath))) return undefined
  const raw = JSON.parse(await readFile(pkgPath, "utf8")) as any
  const bin = raw.bin
  const rel = typeof bin === "string" ? bin : bin?.[binName]
  if (!rel) return undefined
  return path.join(nodeDir, "node_modules", packageName, rel)
}

async function ensureNodeDeps(nodeDir: string, signal?: AbortSignal): Promise<void> {
  await ensureDir(nodeDir)

  const pkgJsonPath = path.join(nodeDir, "package.json")
  const pkgJson = {
    private: true,
    name: "marvin-lsp",
    version: "0.0.0",
    dependencies: {
      typescript: "^5.8.0",
      "typescript-language-server": "^4.4.0",
      basedpyright: "^1.23.0"
    }
  }

  await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf8")

  const nodeModules = path.join(nodeDir, "node_modules")
  if (await fileExists(nodeModules)) return

  const bun = process.execPath
  const res = await run(bun, ["install"], nodeDir, { ...process.env, BUN_BE_BUN: "1" }, signal)
  if (res.code !== 0) throw new Error(`bun install failed: ${res.stderr || res.stdout}`)
}

function detectPythonPath(root: string): Promise<string | undefined> {
  // Best-effort: prefer VIRTUAL_ENV, then .venv, then venv
  const candidates = [
    process.env["VIRTUAL_ENV"],
    path.join(root, ".venv"),
    path.join(root, "venv"),
  ].filter(Boolean) as string[]

  const isWin = process.platform === "win32"

  return (async () => {
    for (const venv of candidates) {
      const python = isWin ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python")
      if (await fileExists(python)) return python
    }
    return undefined
  })()
}

export async function ensureSpawnSpec(serverId: LspServerId, opts: { configDir: string; root: string; signal?: AbortSignal }): Promise<LspSpawnSpec | undefined> {
  const binDir = path.join(opts.configDir, "lsp", "bin")
  const nodeDir = path.join(opts.configDir, "lsp", "node")

  await ensureDir(binDir)

  switch (serverId) {
    case "typescript": {
      await ensureNodeDeps(nodeDir, opts.signal)
      const bin = await resolvePackageBin(nodeDir, "typescript-language-server", "typescript-language-server")
      const tsserver = path.join(nodeDir, "node_modules", "typescript", "lib", "tsserver.js")
      if (!bin || !(await fileExists(tsserver))) return undefined

      return {
        serverId,
        command: process.execPath,
        args: [bin, "--stdio"],
        env: { ...process.env, BUN_BE_BUN: "1" },
        initializationOptions: { tsserver: { path: tsserver } },
      }
    }

    case "basedpyright": {
      await ensureNodeDeps(nodeDir, opts.signal)
      const bin = await resolvePackageBin(nodeDir, "basedpyright", "basedpyright-langserver")
      if (!bin) return undefined

      const pythonPath = await detectPythonPath(opts.root)

      return {
        serverId,
        command: process.execPath,
        args: [bin, "--stdio"],
        env: { ...process.env, BUN_BE_BUN: "1" },
        initializationOptions: pythonPath ? { pythonPath } : {},
      }
    }

    case "gopls": {
      const goplsInBin = path.join(binDir, process.platform === "win32" ? "gopls.exe" : "gopls")
      const fromBin = await fileExists(goplsInBin)
      const fromPath = fromBin ? goplsInBin : await which("gopls")

      let bin = fromPath
      if (!bin) {
        const go = await which("go")
        if (!go) return undefined
        const res = await run(go, ["install", "golang.org/x/tools/gopls@latest"], opts.root, { ...process.env, GOBIN: binDir }, opts.signal)
        if (res.code !== 0) return undefined
        if (!(await fileExists(goplsInBin))) return undefined
        bin = goplsInBin
      }

      return { serverId, command: bin, args: [], env: { ...process.env } }
    }

    case "rust-analyzer": {
      const ra = await which("rust-analyzer")
      if (ra) return { serverId, command: ra, args: [], env: { ...process.env } }

      const rustup = await which("rustup")
      if (!rustup) return undefined

      // Try stable component name, then preview name
      const env = { ...process.env }
      const ok1 = await run(rustup, ["component", "add", "rust-analyzer"], opts.root, env, opts.signal)
      if (ok1.code !== 0) {
        await run(rustup, ["component", "add", "rust-analyzer-preview"], opts.root, env, opts.signal)
      }

      const ra2 = await which("rust-analyzer")
      if (!ra2) return undefined
      return { serverId, command: ra2, args: [], env }
    }
  }
}
```

Notes:
- Use a local `which()` helper (no Bun globals) so `packages/lsp` typechecks under `types: ["node"]`.

#### 5. Minimal LSP client
**File**: `packages/lsp/src/client.ts` (new)

**Add**:
```ts
import path from "node:path"
import { readFile } from "node:fs/promises"
import { EventEmitter } from "node:events"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { Diagnostic } from "vscode-languageserver-types"

const DIAGNOSTICS_DEBOUNCE_MS = 150

export class LspClient {
  static async create(input: {
    serverId: string
    root: string
    proc: ChildProcessWithoutNullStreams
    initializationOptions?: Record<string, unknown>
  }): Promise<LspClient> {
    const client = new LspClient(input.serverId, input.root, input.proc, input.initializationOptions)
    await client.initialize()
    return client
  }

  private connection = createMessageConnection(
    new StreamMessageReader(this.proc.stdout as any),
    new StreamMessageWriter(this.proc.stdin as any),
  )

  private diagnosticsByPath = new Map<string, Diagnostic[]>()
  private versionsByPath = new Map<string, number>()
  private events = new EventEmitter()

  private constructor(
    public readonly serverId: string,
    public readonly root: string,
    private readonly proc: ChildProcessWithoutNullStreams,
    private readonly initializationOptions?: Record<string, unknown>
  ) {
    this.connection.onNotification("textDocument/publishDiagnostics", (params: any) => {
      const filePath = fileURLToPath(params.uri)
      this.diagnosticsByPath.set(filePath, params.diagnostics ?? [])
      this.events.emit("diagnostics", { filePath })
    })

    this.connection.onRequest("window/workDoneProgress/create", async () => null)
    this.connection.onRequest("workspace/configuration", async () => [this.initializationOptions ?? {}])
    this.connection.onRequest("workspace/workspaceFolders", async () => [
      { name: "workspace", uri: pathToFileURL(this.root).href },
    ])

    this.connection.listen()
  }

  private async initialize() {
    await this.connection.sendRequest("initialize", {
      rootUri: pathToFileURL(this.root).href,
      processId: this.proc.pid,
      workspaceFolders: [{ name: "workspace", uri: pathToFileURL(this.root).href }],
      initializationOptions: this.initializationOptions ?? {},
      capabilities: {
        workspace: { configuration: true },
        textDocument: {
          synchronization: { didOpen: true, didChange: true },
          publishDiagnostics: { versionSupport: true },
        },
      },
    })

    await this.connection.sendNotification("initialized", {})

    if (this.initializationOptions) {
      await this.connection.sendNotification("workspace/didChangeConfiguration", { settings: this.initializationOptions })
    }
  }

  get diagnostics(): Map<string, Diagnostic[]> {
    return this.diagnosticsByPath
  }

  async openOrChangeFile(filePath: string, languageId: string) {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(this.root, filePath)
    const text = await readFile(abs, "utf8")

    const current = this.versionsByPath.get(abs)
    if (current != null) {
      const next = current + 1
      this.versionsByPath.set(abs, next)
      await this.connection.sendNotification("textDocument/didChange", {
        textDocument: { uri: pathToFileURL(abs).href, version: next },
        contentChanges: [{ text }],
      })
      return
    }

    this.diagnosticsByPath.delete(abs)
    this.versionsByPath.set(abs, 0)

    await this.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri: pathToFileURL(abs).href, languageId, version: 0, text },
    })
  }

  async waitForDiagnostics(filePath: string, timeoutMs = 3000): Promise<void> {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(this.root, filePath)

    return await new Promise<void>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      let debounce: ReturnType<typeof setTimeout> | undefined

      const onDiag = (e: { filePath: string }) => {
        if (e.filePath !== abs) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          cleanup()
          resolve()
        }, DIAGNOSTICS_DEBOUNCE_MS)
      }

      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        if (debounce) clearTimeout(debounce)
        this.events.removeListener("diagnostics", onDiag)
      }

      this.events.on("diagnostics", onDiag)
      timeout = setTimeout(() => {
        cleanup()
        resolve()
      }, timeoutMs)
    })
  }

  async shutdown(): Promise<void> {
    try {
      this.connection.end()
      this.connection.dispose()
    } catch {}

    try {
      this.proc.kill()
    } catch {}
  }
}
```

#### 6. LSP manager
**File**: `packages/lsp/src/manager.ts` (new)

**Add**:
```ts
import { spawn } from "node:child_process"
import path from "node:path"
import type { Diagnostic } from "vscode-languageserver-types"
import type { LspManager, LspManagerOptions, LspSpawnSpec } from "./types.js"
import { serversForFile, languageIdForFile } from "./registry.js"
import { isWithinDir } from "./path.js"
import { ensureSpawnSpec } from "./install.js"
import { LspClient } from "./client.js"

const BROKEN_COOLDOWN_MS = 60_000

export function createLspManager(options: LspManagerOptions): LspManager {
  const cwd = path.resolve(options.cwd)
  const configDir = options.configDir
  const enabled = options.enabled
  const autoInstall = options.autoInstall

  const clients = new Map<string, LspClient>()
  const spawning = new Map<string, Promise<LspClient | undefined>>()
  const brokenUntil = new Map<string, number>()

  const keyFor = (serverId: string, root: string) => `${serverId}::${root}`

  const isBroken = (key: string) => {
    const until = brokenUntil.get(key)
    if (!until) return false
    return Date.now() < until
  }

  async function getClientFor(spec: LspSpawnSpec, root: string): Promise<LspClient | undefined> {
    const key = keyFor(spec.serverId, root)
    if (isBroken(key)) return undefined

    const existing = clients.get(key)
    if (existing) return existing

    const inflight = spawning.get(key)
    if (inflight) return inflight

    const task = (async () => {
      try {
        const proc = spawn(spec.command, spec.args, {
          cwd: root,
          env: spec.env ?? process.env,
          stdio: ["pipe", "pipe", "pipe"],
        })

        const client = await LspClient.create({
          serverId: spec.serverId,
          root,
          proc,
          initializationOptions: spec.initializationOptions,
        })

        clients.set(key, client)
        return client
      } catch {
        brokenUntil.set(key, Date.now() + BROKEN_COOLDOWN_MS)
        return undefined
      } finally {
        spawning.delete(key)
      }
    })()

    spawning.set(key, task)
    return task
  }

  async function touchFile(filePath: string, opts: { waitForDiagnostics: boolean; signal?: AbortSignal }): Promise<void> {
    if (!enabled) return

    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
    if (!isWithinDir(cwd, abs)) return

    const defs = serversForFile(abs)
    if (defs.length === 0) return

    const languageId = languageIdForFile(abs)

    // For now: allow multiple servers per file type (future-proof). With current registry it’s 1.
    await Promise.all(defs.map(async (def) => {
      const root = await def.detectRoot(abs, cwd)
      const key = keyFor(def.id, root)
      if (isBroken(key)) return

      let spec: LspSpawnSpec | undefined
      if (autoInstall) {
        spec = await ensureSpawnSpec(def.id, { configDir, root, signal: opts.signal }).catch(() => undefined)
      } else {
        spec = await ensureSpawnSpec(def.id, { configDir, root, signal: opts.signal }).catch(() => undefined)
      }
      if (!spec) {
        brokenUntil.set(key, Date.now() + BROKEN_COOLDOWN_MS)
        return
      }

      const client = await getClientFor(spec, root)
      if (!client) return

      await client.openOrChangeFile(abs, languageId)

      if (opts.waitForDiagnostics) {
        await client.waitForDiagnostics(abs)
      }
    }))
  }

  async function diagnostics(): Promise<Record<string, Diagnostic[]>> {
    const out: Record<string, Diagnostic[]> = {}
    for (const client of clients.values()) {
      for (const [filePath, ds] of client.diagnostics.entries()) {
        const arr = out[filePath] ?? []
        arr.push(...ds)
        out[filePath] = arr
      }
    }
    return out
  }

  async function shutdown(): Promise<void> {
    const all = [...clients.values()]
    clients.clear()
    await Promise.all(all.map((c) => c.shutdown().catch(() => {})))
  }

  // Ensure cleanup on exit
  const exitHandler = () => { void shutdown() }
  process.once("exit", exitHandler)
  process.once("SIGINT", exitHandler)
  process.once("SIGTERM", exitHandler)

  return { touchFile, diagnostics, shutdown }
}
```

### Edge Cases to Handle
- [ ] File outside `cwd` → skip diagnostics
- [ ] Broken server → cooldown avoids respawn loops
- [ ] Multiple tool calls quickly → singleflight prevents repeated spawns

### Success Criteria
- [ ] `packages/lsp` compiles
- [ ] Manager can spawn fake client and collect diagnostics (see tests)

### Rollback
```bash
git checkout HEAD -- packages/lsp
```

---

## Phase 3: Diagnostic summarization + tool wrapper

### Prerequisites
- [ ] Phase 2 compiles

### Changes

#### 1. Summarizer
**File**: `packages/lsp/src/diagnostics.ts` (new)

**Add**:
```ts
import type { Diagnostic } from "vscode-languageserver-types"
import type { LspDiagnosticCaps } from "./types.js"

const DEFAULT_CAPS: LspDiagnosticCaps = {
  maxDiagnosticsPerFile: 20,
  maxProjectFiles: 5,
  maxTotalLines: 60,
}

function severityLabel(sev: number | undefined): "ERROR" | "WARN" | "INFO" | "HINT" {
  switch (sev) {
    case 1: return "ERROR"
    case 2: return "WARN"
    case 3: return "INFO"
    case 4: return "HINT"
    default: return "ERROR"
  }
}

export function prettyDiagnostic(d: Diagnostic): string {
  const sev = severityLabel(d.severity)
  const line = (d.range?.start?.line ?? 0) + 1
  const col = (d.range?.start?.character ?? 0) + 1
  return `${sev} [${line}:${col}] ${d.message}`
}

export function summarizeDiagnostics(input: {
  diagnosticsByFile: Record<string, Diagnostic[]>
  filePath: string
  caps?: Partial<LspDiagnosticCaps>
}): { fileText?: string; projectText?: string } {
  const caps: LspDiagnosticCaps = { ...DEFAULT_CAPS, ...(input.caps ?? {}) }

  const byFile = input.diagnosticsByFile
  const target = byFile[input.filePath] ?? []

  const prioritize = (d: Diagnostic) => d.severity ?? 4
  const filter = (ds: Diagnostic[]) => ds
    .filter((d) => d.severity === 1 || d.severity === 2)
    .sort((a, b) => prioritize(a) - prioritize(b))

  const targetFiltered = filter(target)

  let linesBudget = caps.maxTotalLines

  let fileText: string | undefined
  if (targetFiltered.length > 0 && linesBudget > 0) {
    const limited = targetFiltered.slice(0, Math.min(caps.maxDiagnosticsPerFile, linesBudget))
    linesBudget -= limited.length
    fileText = [
      "\nThis file has errors, please fix",
      "<file_diagnostics>",
      ...limited.map(prettyDiagnostic),
      "</file_diagnostics>",
      "",
    ].join("\n")
  }

  // Project spillover (bounded)
  const otherFiles = Object.entries(byFile)
    .filter(([p, ds]) => p !== input.filePath && ds.length > 0)
    .slice(0, caps.maxProjectFiles)

  const projectBlocks: string[] = []
  for (const [p, ds] of otherFiles) {
    if (linesBudget <= 0) break
    const filtered = filter(ds)
    if (filtered.length === 0) continue
    const limited = filtered.slice(0, Math.min(caps.maxDiagnosticsPerFile, linesBudget))
    linesBudget -= limited.length

    projectBlocks.push(
      "<project_diagnostics>",
      p,
      ...limited.map(prettyDiagnostic),
      "</project_diagnostics>",
      "",
    )
  }

  const projectText = projectBlocks.length ? "\n" + projectBlocks.join("\n") : undefined

  return { fileText, projectText }
}
```

#### 2. Tool wrapper
**File**: `packages/lsp/src/tool-wrapper.ts` (new)

**Add**:
```ts
import type { AgentTool, AgentToolResult } from "@marvin-agents/ai"
import path from "node:path"
import type { LspManager, LspDiagnosticCaps } from "./types.js"
import { summarizeDiagnostics } from "./diagnostics.js"

export function wrapToolsWithLspDiagnostics(
  tools: AgentTool<any, any>[],
  lsp: LspManager,
  opts: { cwd: string; caps?: Partial<LspDiagnosticCaps> }
): AgentTool<any, any>[] {
  return tools.map((tool) => {
    if (tool.name !== "write" && tool.name !== "edit") return tool

    return {
      ...tool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const result = await tool.execute(toolCallId, params, signal, onUpdate)

        const rawPath = (params as any)?.path
        if (typeof rawPath !== "string") return result

        const absPath = path.resolve(opts.cwd, rawPath)

        await lsp.touchFile(absPath, { waitForDiagnostics: true, signal }).catch(() => {})
        const diagnosticsByFile = await lsp.diagnostics().catch(() => ({}))

        const summary = summarizeDiagnostics({ diagnosticsByFile, filePath: absPath, caps: opts.caps })
        const extra = [summary.fileText, summary.projectText].filter(Boolean).join("\n")

        if (!extra) return result

        return {
          content: [...result.content, { type: "text", text: extra }],
          details: result.details,
        } satisfies AgentToolResult<any>
      },
    }
  })
}
```

### Edge Cases to Handle
- [ ] Preserve `edit` tool `details.diff` exactly (UI relies on it)
- [ ] Never emit huge diagnostics blocks

### Rollback
```bash
git checkout HEAD -- packages/lsp/src/diagnostics.ts packages/lsp/src/tool-wrapper.ts
```

---

## Phase 4: Wire into Marvin (TUI + headless)

### Prerequisites
- [ ] `@marvin-agents/lsp` compiles

### Changes

#### 1. Config: expose LSP toggle
**File**: `apps/coding-agent/src/config.ts`

**Before** (`apps/coding-agent/src/config.ts:60`):
```ts
export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
}
```

**After**:
```ts
export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
  lsp: { enabled: boolean; autoInstall: boolean };
}
```

Add parsing in `loadAppConfig()` (after reading `rawObj`):
```ts
const lspRaw = (rawObj as any).lsp;
const lsp =
  lspRaw === false
    ? { enabled: false, autoInstall: false }
    : {
        enabled: typeof lspRaw?.enabled === "boolean" ? lspRaw.enabled : true,
        autoInstall: typeof lspRaw?.autoInstall === "boolean" ? lspRaw.autoInstall : true,
      };
```

And include in returned object:
```ts
return {
  provider,
  modelId: model.id,
  model,
  thinking,
  systemPrompt,
  agentsConfig,
  configDir,
  configPath,
  lsp,
};
```

#### 2. Headless wiring
**File**: `apps/coding-agent/src/headless.ts`

**Before** (`apps/coding-agent/src/headless.ts:109`):
```ts
// Combine built-in and custom tools, then wrap with hooks for interception
const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)];
const tools = wrapToolsWithHooks(allTools, hookRunner);
```

**After**:
```ts
import { createLspManager, wrapToolsWithLspDiagnostics } from "@marvin-agents/lsp";

// ...

const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)];
const lsp = createLspManager({
  cwd,
  configDir: loaded.configDir,
  enabled: loaded.lsp.enabled,
  autoInstall: loaded.lsp.autoInstall,
});
const tools = wrapToolsWithLspDiagnostics(wrapToolsWithHooks(allTools, hookRunner), lsp, { cwd });
```

Also add `finally { await lsp.shutdown().catch(() => {}) }` around `agent.prompt(...)`.

#### 3. TUI wiring
**File**: `apps/coding-agent/src/tui-app.tsx`

**Before** (`apps/coding-agent/src/tui-app.tsx:93`):
```ts
// Combine built-in and custom tools, then wrap with hooks for interception
const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)]
const tools = wrapToolsWithHooks(allTools, hookRunner)
```

**After**:
```ts
import { createLspManager, wrapToolsWithLspDiagnostics } from "@marvin-agents/lsp"

// ...

const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)]
const lsp = createLspManager({
  cwd,
  configDir: loaded.configDir,
  enabled: loaded.lsp.enabled,
  autoInstall: loaded.lsp.autoInstall,
})
const tools = wrapToolsWithLspDiagnostics(wrapToolsWithHooks(allTools, hookRunner), lsp, { cwd })
```

### Success Criteria
- [ ] Both headless + TUI append diagnostics after `write`/`edit`

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/config.ts apps/coding-agent/src/headless.ts apps/coding-agent/src/tui-app.tsx
```

---

## Phase 5: Tests

### Prerequisites
- [ ] Core code compiles

### Unit tests
**File**: `packages/lsp/tests/diagnostics.test.ts` (new)
- Tests severity filtering + caps.

**File**: `packages/lsp/tests/tool-wrapper.test.ts` (new)
- Wrap fake `write` tool and stub `LspManager` returning diagnostics.
- Assert appended `content` contains `<file_diagnostics>`.

### Config tests
**File**: `apps/coding-agent/tests/config.test.ts`

**Add**:
- A test for `{ lsp: false }` → `loaded.lsp.enabled === false`.

### Rollback
```bash
git checkout HEAD -- packages/lsp/tests apps/coding-agent/tests/config.test.ts
```

---

## Manual Testing Checklist
1. [ ] TS: create type error; run `write`; confirm `<file_diagnostics>`.
2. [ ] Python: create type error; run `write`; confirm `<file_diagnostics>`.
3. [ ] Disable LSP in config; confirm no diagnostics appended.

## Anti-Patterns to Avoid
- Do not emit diagnostics only in `ToolResultMessage.details` (model never sees it).
- Do not run diagnostics in agent loop; keep tool-boundary.
- Do not surface unbounded project diagnostics (context rot).

## References
- opencode LSP manager: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/lsp/index.ts`
- opencode LSP client: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/lsp/client.ts`
- opencode write tool LSP integration: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/tool/write.ts`
- Marvin tool wrapper: `apps/coding-agent/src/hooks/tool-wrapper.ts`
- Marvin agent loop details strip: `packages/ai/src/agent/agent-loop.ts`

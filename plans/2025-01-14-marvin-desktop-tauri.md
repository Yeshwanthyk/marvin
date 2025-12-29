# Marvin Desktop (Tauri) Implementation Plan

## Plan Metadata
- Created: 2025-01-14
- Ticket: N/A
- Status: draft
- Owner: yesh
- Assumptions:
  - Desktop-only target (no web browser support needed)
  - Tauri v2 for desktop shell
  - Bun sidecar process runs agent + tools locally
  - SolidJS for webview UI (consistency with existing TUI codebase)
  - Full filesystem/shell access via sidecar (same as TUI)

## Progress Tracking
- [ ] Phase 1: Project Scaffolding & Sidecar IPC Protocol
- [ ] Phase 2: Tauri Shell & Sidecar Management
- [ ] Phase 3: Web UI Component Library (Core)
- [ ] Phase 4: Web UI Component Library (Extended)
- [ ] Phase 5: Desktop App UI & Event Handler
- [ ] Phase 6: Session Management & Config UI
- [ ] Phase 7: Build Pipeline & Distribution

## Overview

Create a native desktop application for Marvin using Tauri that provides a graphical alternative to the terminal TUI. The architecture is straightforward: a Tauri shell spawns a Bun sidecar process that runs the existing agent + tools code, communicating via JSON-RPC over stdio. The webview renders a SolidJS UI that subscribes to agent events.

**Key insight:** This is NOT a client/server architecture. The sidecar runs locally with full filesystem access—identical to the TUI. The webview is purely a rendering layer.

## Current State

### Existing Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                    apps/coding-agent (TUI)                      │
├─────────────────────────────────────────────────────────────────┤
│  index.ts → tui-app.tsx → Agent → Transport → LLM Providers    │
│                ↓                                                 │
│         open-tui components → terminal                          │
└─────────────────────────────────────────────────────────────────┘
```

### Key Discoveries

**Agent event system** (`packages/agent/src/types.ts:66-84`):
```typescript
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AppMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AppMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AppMessage }
  | { type: "message_update"; message: AppMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AppMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
```

**Session persistence** (`apps/coding-agent/src/session-manager.ts:8-31`):
- JSONL format: `{timestamp}_{uuid}.jsonl`
- Location: `~/.config/marvin/sessions/{encoded-cwd}/`
- First line: `SessionMetadata` (provider, model, thinking level)
- Subsequent lines: `SessionMessageEntry` wrapping each `AppMessage`

**Config system** (`apps/coding-agent/src/config.ts`):
- JSON file at `~/.config/marvin/config.json`
- Loads AGENTS.md from global (`~/.config/marvin/agents.md`) and project (`./AGENTS.md`) paths
- Resolves provider/model from registry

**Hooks system** (`apps/coding-agent/src/hooks/`):
- TypeScript files in `~/.config/marvin/hooks/*.ts`
- 8 event types: `app.start`, `session.*`, `agent.*`, `turn.*`, `tool.execute.*`
- `HookRunner` manages execution with timeouts
- `wrapToolsWithHooks` intercepts tool execution

**Custom tools** (`apps/coding-agent/src/custom-tools/`):
- TypeScript files in `~/.config/marvin/tools/*.ts`
- `ToolAPI`: `{ cwd, exec, send }`
- `SendRef` pattern for late-binding message injection
- Can provide custom `renderCall`/`renderResult` functions

**UI types** (`apps/coding-agent/src/types.ts`):
```typescript
export interface UIAssistantMessage {
  id: string
  role: "assistant"
  content: string
  contentBlocks?: UIContentBlock[]
  isStreaming?: boolean
  timestamp?: number
}

export interface ToolBlock {
  id: string
  name: string
  args: unknown
  output?: string
  editDiff?: string
  isError: boolean
  isComplete: boolean
  result?: AgentToolResult<any>
  renderCall?: (args: any, theme: Theme) => JSX.Element  // TUI-specific
  renderResult?: (result: AgentToolResult<any>, opts: RenderResultOptions, theme: Theme) => JSX.Element
}
```

**Components used** (from `@marvin-agents/open-tui`):
- Heavy: `Markdown`, `CodeBlock`, `Diff`, `SelectList`, `Image`
- Moderate: `Dialog`, `Toast`, `Editor/Input`
- Light: `Badge`, `Panel`, `Loader`, `Spacer`, `Divider`

## Desired End State

```
┌─────────────────────────────────────────────────────────────────┐
│                       Tauri Desktop App                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Webview (SolidJS)                      │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Header: model, status, context tokens              │  │  │
│  │  ├─────────────────────────────────────────────────────┤  │  │
│  │  │  MessageList: markdown, code, diffs, tool blocks    │  │  │
│  │  ├─────────────────────────────────────────────────────┤  │  │
│  │  │  InputArea: multiline editor, autocomplete          │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │ IPC (JSON-RPC over stdio)           │
│  ┌────────────────────────▼──────────────────────────────────┐  │
│  │                    Bun Sidecar Process                    │  │
│  │  Agent + ProviderTransport + codingTools + hooks + LSP    │  │
│  │  SessionManager + Config + Custom Tools                   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Verification
```bash
# Build and run desktop app
cd apps/desktop && bun run tauri dev

# Verify sidecar spawns correctly
# - Check Tauri console for sidecar stdout
# - Agent events stream to webview

# Functional tests
# - Send prompt → response renders with markdown
# - Tool execution shows progress → result
# - Session persists across restarts
# - Keyboard shortcuts work (Ctrl+P model cycle, Esc abort)
```

### Manual Observable Behavior
- [ ] App launches with main window
- [ ] Can type prompt and submit
- [ ] Streaming response renders incrementally
- [ ] Tool blocks show arguments → progress → result
- [ ] Diffs render with syntax highlighting
- [ ] Code blocks have copy button
- [ ] Session picker shows recent sessions
- [ ] Model cycling via Ctrl+P or UI button
- [ ] Abort via Esc key stops generation
- [ ] Context window usage visible in header

## Out of Scope
- Web browser deployment (server architecture)
- Mobile targets (iOS/Android)
- Multi-window support (single window per app instance)
- Collaborative editing
- Plugin marketplace UI
- Auto-updates (defer to Phase 8+)

## Breaking Changes
None. Desktop app is additive—TUI continues to work unchanged.

## Dependency and Configuration Changes

### Additions (apps/desktop)
```bash
# Tauri CLI (dev dependency)
bun add -D @tauri-apps/cli

# Tauri API for webview
bun add @tauri-apps/api

# SolidJS (same as TUI)
bun add solid-js

# Vite for webview bundling
bun add -D vite vite-plugin-solid

# Syntax highlighting (web-compatible)
bun add shiki

# Markdown rendering
bun add solid-markdown remark-gfm

# Diff rendering
bun add diff  # Already in workspace

# UI primitives (optional - or build from scratch)
bun add @kobalte/core  # SolidJS headless components
```

### Additions (packages/desktop-ui)
```bash
bun add solid-js shiki solid-markdown remark-gfm diff
```

### Rust Dependencies (src-tauri/Cargo.toml)
```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
tauri-plugin-shell = "2"  # For sidecar management
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### Configuration Changes
**File**: `apps/desktop/src-tauri/tauri.conf.json`
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Marvin",
  "version": "0.1.0",
  "identifier": "com.marvin.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "bun run build",
    "beforeDevCommand": "bun run dev"
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.png"],
    "externalBin": ["sidecars/marvin-sidecar"]
  },
  "app": {
    "windows": [
      {
        "title": "Marvin",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "plugins": {
    "shell": {
      "sidecar": true,
      "scope": [
        {
          "name": "marvin-sidecar",
          "sidecar": true
        }
      ]
    }
  }
}
```

## Error Handling Strategy

### Sidecar Errors
- Sidecar crash → Show error dialog, offer restart
- Sidecar timeout (>30s no heartbeat) → Kill and restart
- IPC parse error → Log to console, skip message

### Agent Errors
- API rate limit → Retry with exponential backoff (existing logic)
- Network failure → Show inline error, allow retry
- Tool execution error → Display in tool block with `isError: true`

### UI Errors
- Component render error → Error boundary with fallback
- Theme load error → Fall back to default theme

### Logging
- Sidecar: stdout for events, stderr for logs
- Tauri: Use `log` crate, forward to webview console
- Webview: Console + optional file logging

## Implementation Approach

### Why This Architecture

**Option A: Embedded Bun in Tauri (rejected)**
- Requires custom Rust bindings to Bun runtime
- Complex FFI boundary for async operations
- No existing Tauri plugin for Bun

**Option B: HTTP server + fetch (rejected)**
- Over-engineered for local-only use case
- Additional port binding complexity
- No benefit over stdio IPC

**Option C: Sidecar + stdio IPC (chosen)**
- Simple JSON-RPC over stdin/stdout
- Tauri has first-class sidecar support
- Sidecar is just repackaged existing code
- Clean process boundary for debugging

### Component Strategy

**Build vs Buy:**
- Markdown: Use `solid-markdown` + `remark-gfm` (mature library)
- Syntax highlighting: Use `shiki` (same quality as TUI, WASM-based)
- Diff: Port from TUI using `diff` package (custom rendering needed)
- Dialog/Toast: Use `@kobalte/core` headless primitives (accessible, unstyled)
- SelectList: Custom build (specific keyboard nav requirements)
- Editor: HTML textarea with custom keybindings (simpler than TUI)

## Phase Dependencies and Parallelization

```
Phase 1 (Scaffolding) ──┬──► Phase 2 (Tauri Shell)
                        │
                        └──► Phase 3 (UI Core) ──► Phase 4 (UI Extended)
                                                         │
Phase 2 + Phase 4 ──────────────────────────────────────►│
                                                         ▼
                                                   Phase 5 (App UI)
                                                         │
                                                         ▼
                                                   Phase 6 (Sessions)
                                                         │
                                                         ▼
                                                   Phase 7 (Build)
```

- **Parallel:** Phase 2 (Tauri) and Phases 3-4 (UI components) can proceed simultaneously
- **Sequential:** Phase 5 requires both Phase 2 and Phase 4
- **Sequential:** Phases 6-7 are linear after Phase 5

---

## Phase 1: Project Scaffolding & Sidecar IPC Protocol

### Overview
Set up the monorepo structure for desktop app and define the IPC protocol between sidecar and webview. This phase establishes the contract that both sides will implement.

### Prerequisites
- [ ] Rust toolchain installed (`rustup`)
- [ ] Tauri CLI available (`cargo install tauri-cli`)

### Change Checklist
- [ ] Create `apps/desktop/` directory structure
- [ ] Create `packages/desktop-ui/` directory structure
- [ ] Define IPC protocol types in shared location
- [ ] Create sidecar entry point skeleton
- [ ] Update root `package.json` workspaces

### Changes

#### 1. Root package.json workspace update
**File**: `package.json`
**Location**: line 14 (workspaces array)

**Before**:
```json
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
```

**After**:
```json
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
```

**Why**: No change needed—`apps/desktop` automatically included via `apps/*` glob.

#### 2. Create desktop app package.json
**File**: `apps/desktop/package.json`
**Location**: new file

**Add**:
```json
{
  "name": "@marvin-agents/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "build:sidecar": "bun run scripts/build-sidecar.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@marvin-agents/desktop-ui": "file:../../packages/desktop-ui",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "solid-js": "1.9.9"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vite-plugin-solid": "^2.10.0"
  }
}
```

#### 3. Create desktop-ui package.json
**File**: `packages/desktop-ui/package.json`
**Location**: new file

**Add**:
```json
{
  "name": "@marvin-agents/desktop-ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "solid-js": "1.9.9",
    "shiki": "^1.0.0",
    "solid-markdown": "^2.0.0",
    "remark-gfm": "^4.0.0",
    "diff": "^8.0.2",
    "@kobalte/core": "^0.13.0"
  },
  "devDependencies": {
    "@types/diff": "^5.0.0",
    "typescript": "^5.5.4"
  },
  "peerDependencies": {
    "solid-js": "^1.9.0"
  }
}
```

#### 4. Create IPC protocol types
**File**: `apps/desktop/src/ipc/protocol.ts`
**Location**: new file

**Add**:
```typescript
/**
 * IPC Protocol between Tauri webview and Bun sidecar
 * 
 * Communication is JSON-RPC 2.0 inspired over stdio:
 * - Webview → Sidecar: JSON requests via Tauri shell stdin
 * - Sidecar → Webview: JSON responses/events via stdout, parsed by Tauri
 */

import type { AgentEvent, ThinkingLevel } from "@marvin-agents/agent-core"
import type { KnownProvider } from "@marvin-agents/ai"

// ============================================================================
// Request/Response Types (Webview → Sidecar → Webview)
// ============================================================================

export interface IPCRequest<M extends IPCMethod = IPCMethod> {
  id: number
  method: M
  params: IPCMethodParams[M]
}

export interface IPCResponse<M extends IPCMethod = IPCMethod> {
  id: number
  result?: IPCMethodResult[M]
  error?: IPCError
}

export interface IPCError {
  code: number
  message: string
  data?: unknown
}

// Error codes (JSON-RPC standard + custom)
export const IPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom errors
  AGENT_BUSY: -32000,
  SESSION_NOT_FOUND: -32001,
  CONFIG_ERROR: -32002,
} as const

// ============================================================================
// Method Definitions
// ============================================================================

export type IPCMethod = keyof IPCMethodParams

export interface IPCMethodParams {
  // Lifecycle
  "init": { cwd: string }
  "shutdown": {}
  
  // Agent control
  "prompt": { text: string; attachments?: AttachmentInput[] }
  "abort": {}
  "continue": {}
  
  // Session management
  "session.list": {}
  "session.load": { sessionId: string }
  "session.new": {}
  "session.clear": {}
  
  // Config
  "config.get": {}
  "config.update": { updates: Partial<ConfigUpdate> }
  "model.cycle": {}
  "thinking.cycle": {}
  
  // State queries
  "state.get": {}
  "context.get": {}
}

export interface IPCMethodResult {
  "init": InitResult
  "shutdown": {}
  
  "prompt": {}
  "abort": {}
  "continue": {}
  
  "session.list": SessionListResult
  "session.load": SessionLoadResult
  "session.new": SessionNewResult
  "session.clear": {}
  
  "config.get": ConfigResult
  "config.update": {}
  "model.cycle": ModelCycleResult
  "thinking.cycle": ThinkingCycleResult
  
  "state.get": StateResult
  "context.get": ContextResult
}

// ============================================================================
// Param/Result Subtypes
// ============================================================================

export interface AttachmentInput {
  type: "file" | "image" | "text"
  path?: string      // For file/image
  content?: string   // For text or base64 image data
  mimeType?: string
}

export interface InitResult {
  configDir: string
  provider: KnownProvider
  modelId: string
  thinking: ThinkingLevel
  sessionId: string | null
  contextWindow: number
}

export interface SessionListResult {
  sessions: SessionSummary[]
}

export interface SessionSummary {
  id: string
  path: string
  timestamp: number
  provider: string
  modelId: string
  messageCount: number
  preview: string
}

export interface SessionLoadResult {
  sessionId: string
  messages: SerializedUIMessage[]
}

export interface SessionNewResult {
  sessionId: string
}

export interface ConfigResult {
  provider: KnownProvider
  modelId: string
  thinking: ThinkingLevel
  theme: string
  models: ModelInfo[]  // Available models for cycling
}

export interface ConfigUpdate {
  provider: KnownProvider
  model: string
  thinking: ThinkingLevel
  theme: string
}

export interface ModelInfo {
  id: string
  provider: KnownProvider
  displayName: string
}

export interface ModelCycleResult {
  provider: KnownProvider
  modelId: string
}

export interface ThinkingCycleResult {
  thinking: ThinkingLevel
}

export interface StateResult {
  isResponding: boolean
  activityState: "idle" | "thinking" | "streaming" | "tool"
  pendingToolCalls: string[]
}

export interface ContextResult {
  tokens: number
  maxTokens: number
  cacheHits?: number
  cacheMisses?: number
}

// ============================================================================
// Event Types (Sidecar → Webview, pushed asynchronously)
// ============================================================================

export interface IPCEvent<T extends IPCEventType = IPCEventType> {
  event: T
  data: IPCEventData[T]
}

export type IPCEventType = keyof IPCEventData

export interface IPCEventData {
  // Agent events (forwarded from Agent.subscribe)
  "agent": AgentEvent
  
  // UI-specific events
  "activity": { state: "idle" | "thinking" | "streaming" | "tool" }
  "context": ContextResult
  "error": { message: string; recoverable: boolean }
  "session.changed": { sessionId: string }
  
  // Heartbeat for connection health
  "heartbeat": { timestamp: number }
}

// ============================================================================
// Serialized UI Types (for session load/restore)
// ============================================================================

export interface SerializedUIMessage {
  id: string
  role: "user" | "assistant" | "shell"
  content: string
  contentBlocks?: SerializedContentBlock[]
  tools?: SerializedToolBlock[]
  timestamp?: number
}

export interface SerializedContentBlock {
  type: "thinking" | "text" | "tool"
  id?: string
  text?: string
  summary?: string
  full?: string
  toolId?: string
}

export interface SerializedToolBlock {
  id: string
  name: string
  args: unknown
  output?: string
  editDiff?: string
  isError: boolean
  isComplete: boolean
}
```

**Why**: Comprehensive type definitions ensure type safety across the IPC boundary. Both sidecar and webview import these types.

#### 5. Create sidecar entry point skeleton
**File**: `apps/desktop/sidecar/main.ts`
**Location**: new file

**Add**:
```typescript
/**
 * Marvin Desktop Sidecar
 * 
 * Runs as a child process of the Tauri app, communicating via stdio.
 * Hosts the Agent, tools, sessions, and config—same as TUI headless mode.
 */

import { createInterface } from "readline"
import type { 
  IPCRequest, 
  IPCResponse, 
  IPCEvent, 
  IPCMethod,
  IPC_ERROR 
} from "../src/ipc/protocol.js"

// ============================================================================
// IPC Transport
// ============================================================================

const sendResponse = (response: IPCResponse): void => {
  process.stdout.write(JSON.stringify(response) + "\n")
}

const sendEvent = (event: IPCEvent): void => {
  process.stdout.write(JSON.stringify(event) + "\n")
}

const sendError = (id: number, code: number, message: string): void => {
  sendResponse({ id, error: { code, message } })
}

// ============================================================================
// Request Handlers (to be implemented in Phase 2)
// ============================================================================

type Handler<M extends IPCMethod> = (
  params: IPCRequest<M>["params"]
) => Promise<IPCResponse<M>["result"]> | IPCResponse<M>["result"]

const handlers: Partial<{ [M in IPCMethod]: Handler<M> }> = {
  // Placeholder - real implementations in Phase 2
}

// ============================================================================
// Main Loop
// ============================================================================

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on("line", async (line: string) => {
  let request: IPCRequest
  
  try {
    request = JSON.parse(line)
  } catch {
    // Can't send error without id, log to stderr
    process.stderr.write(`Parse error: ${line}\n`)
    return
  }

  const handler = handlers[request.method]
  if (!handler) {
    sendError(request.id, IPC_ERROR.METHOD_NOT_FOUND, `Unknown method: ${request.method}`)
    return
  }

  try {
    const result = await handler(request.params as any)
    sendResponse({ id: request.id, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sendError(request.id, IPC_ERROR.INTERNAL_ERROR, message)
  }
})

// Heartbeat to indicate sidecar is alive
setInterval(() => {
  sendEvent({ event: "heartbeat", data: { timestamp: Date.now() } })
}, 5000)

// Log startup
process.stderr.write("Marvin sidecar started\n")
```

**Why**: Skeleton establishes the IPC loop structure. Handlers added in Phase 2.

#### 6. Create sidecar build script
**File**: `apps/desktop/scripts/build-sidecar.ts`
**Location**: new file

**Add**:
```typescript
/**
 * Build sidecar binary for Tauri bundling
 */

import { $ } from "bun"
import { join, dirname } from "path"
import { mkdir } from "fs/promises"

const ROOT = dirname(dirname(import.meta.path))
const SIDECAR_SRC = join(ROOT, "sidecar/main.ts")
const SIDECAR_OUT = join(ROOT, "src-tauri/sidecars")

// Determine target triple for current platform
const getTargetTriple = (): string => {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
  const platform = process.platform
  
  switch (platform) {
    case "darwin":
      return `${arch}-apple-darwin`
    case "linux":
      return `${arch}-unknown-linux-gnu`
    case "win32":
      return `${arch}-pc-windows-msvc`
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

const main = async () => {
  const target = getTargetTriple()
  const outName = `marvin-sidecar-${target}${process.platform === "win32" ? ".exe" : ""}`
  const outPath = join(SIDECAR_OUT, outName)

  console.log(`Building sidecar for ${target}...`)
  
  // Ensure output directory exists
  await mkdir(SIDECAR_OUT, { recursive: true })
  
  // Build with Bun
  await $`bun build ${SIDECAR_SRC} --compile --outfile ${outPath}`
  
  console.log(`Built: ${outPath}`)
}

await main()
```

**Why**: Tauri expects sidecar binaries with specific naming convention: `{name}-{target-triple}`.

#### 7. Create Vite config for webview
**File**: `apps/desktop/vite.config.ts`
**Location**: new file

**Add**:
```typescript
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
  
  // Vite options for Tauri
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  
  envPrefix: ["VITE_", "TAURI_"],
  
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: "dist",
  },
})
```

#### 8. Create TypeScript configs
**File**: `apps/desktop/tsconfig.json`
**Location**: new file

**Add**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "types": ["vite/client"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*", "sidecar/**/*"],
  "exclude": ["node_modules", "dist", "src-tauri"]
}
```

**File**: `packages/desktop-ui/tsconfig.json`
**Location**: new file

**Add**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### 9. Create directory structure
**File**: Multiple directories
**Location**: new directories

```bash
# Create directory structure
mkdir -p apps/desktop/{src,sidecar,scripts,src-tauri/sidecars,src-tauri/src,src-tauri/icons}
mkdir -p apps/desktop/src/{ipc,components,hooks,context}
mkdir -p packages/desktop-ui/src/{components,context,hooks,utils}
```

#### 10. Create desktop-ui package index
**File**: `packages/desktop-ui/src/index.ts`
**Location**: new file

**Add**:
```typescript
/**
 * @marvin-agents/desktop-ui
 * 
 * Web UI components for Marvin Desktop (Tauri)
 */

// Components (to be implemented in Phase 3-4)
// export { Markdown } from "./components/Markdown"
// export { CodeBlock } from "./components/CodeBlock"
// export { Diff } from "./components/Diff"
// ...

// Context
// export { ThemeProvider, useTheme } from "./context/theme"

// Hooks
// export { useKeyboard } from "./hooks/use-keyboard"
```

**Why**: Barrel export file—components added incrementally in later phases.

### Edge Cases to Handle
- [ ] Sidecar binary name varies by platform (handled in build script)
- [ ] Windows requires `.exe` extension (handled in build script)
- [ ] Cross-compilation not supported (build on target platform)

### Success Criteria

**Automated** (run after each change, must pass before committing):
```bash
cd apps/desktop && bun install       # Dependencies install
cd apps/desktop && bun run typecheck # Zero type errors
cd packages/desktop-ui && bun run typecheck
```

**Before proceeding to next phase**:
```bash
bun run typecheck  # Root workspace typecheck passes
```

**Manual**:
- [ ] `apps/desktop/` directory exists with all files
- [ ] `packages/desktop-ui/` directory exists with all files
- [ ] IPC protocol types compile without errors
- [ ] Sidecar skeleton runs: `bun apps/desktop/sidecar/main.ts` (outputs heartbeat)

### Rollback
```bash
rm -rf apps/desktop packages/desktop-ui
git restore package.json
```

### Notes
_Space for implementer discoveries_

---

## Phase 2: Tauri Shell & Sidecar Management

### Overview
Implement the Rust Tauri shell that spawns the sidecar, manages its lifecycle, and bridges IPC between sidecar stdout and webview events. Also implement the sidecar's full handler set.

### Prerequisites
- [ ] Phase 1 complete
- [ ] Rust toolchain with `cargo tauri` working

### Change Checklist
- [ ] Create Tauri Rust project structure
- [ ] Implement sidecar spawn and lifecycle management
- [ ] Implement IPC bridge (stdout → webview events)
- [ ] Implement webview → sidecar stdin commands
- [ ] Implement all sidecar handlers
- [ ] Add graceful shutdown handling

### Changes

#### 1. Create Cargo.toml
**File**: `apps/desktop/src-tauri/Cargo.toml`
**Location**: new file

**Add**:
```toml
[package]
name = "marvin-desktop"
version = "0.1.0"
description = "Marvin AI Coding Assistant"
authors = ["Yesh Yendamuri"]
edition = "2021"

[lib]
name = "marvin_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["sync", "io-util"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

#### 2. Create Tauri build script
**File**: `apps/desktop/src-tauri/build.rs`
**Location**: new file

**Add**:
```rust
fn main() {
    tauri_build::build()
}
```

#### 3. Create main Rust entry point
**File**: `apps/desktop/src-tauri/src/main.rs`
**Location**: new file

**Add**:
```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    marvin_desktop_lib::run()
}
```

#### 4. Create Tauri lib with sidecar management
**File**: `apps/desktop/src-tauri/src/lib.rs`
**Location**: new file

**Add**:
```rust
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};
use tracing::{error, info};

// ============================================================================
// Sidecar State
// ============================================================================

struct SidecarState {
    process: Option<Child>,
    stdin: Option<ChildStdin>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            process: None,
            stdin: None,
        }
    }
}

struct Sidecar(Mutex<SidecarState>);

// ============================================================================
// IPC Types (mirror TypeScript definitions)
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
struct IPCRequest {
    id: u32,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct IPCResponse {
    id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<IPCError>,
}

#[derive(Debug, Serialize, Deserialize)]
struct IPCError {
    code: i32,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct IPCEvent {
    event: String,
    data: serde_json::Value,
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Send a request to the sidecar and return immediately (response comes via event)
#[tauri::command]
async fn send_to_sidecar(
    state: State<'_, Sidecar>,
    request: IPCRequest,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref mut stdin) = guard.stdin {
        let json = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", json).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Sidecar not running".into())
    }
}

/// Restart the sidecar process
#[tauri::command]
async fn restart_sidecar(
    app: AppHandle,
    state: State<'_, Sidecar>,
) -> Result<(), String> {
    // Kill existing
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(mut process) = guard.process.take() {
            let _ = process.kill();
        }
        guard.stdin = None;
    }
    
    // Start new
    spawn_sidecar(&app)?;
    Ok(())
}

/// Check if sidecar is alive
#[tauri::command]
async fn sidecar_status(state: State<'_, Sidecar>) -> Result<bool, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.process.is_some())
}

// ============================================================================
// Sidecar Lifecycle
// ============================================================================

fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
    let sidecar_command = app
        .shell()
        .sidecar("marvin-sidecar")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    let mut child = Command::from(sidecar_command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    // Store process and stdin
    let state: State<Sidecar> = app.state();
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.process = Some(child);
        guard.stdin = Some(stdin);
    }

    // Forward stdout to webview (JSON lines → events)
    let app_handle = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(json) => {
                    // Try to parse as event first
                    if let Ok(event) = serde_json::from_str::<IPCEvent>(&json) {
                        let _ = app_handle.emit(&format!("sidecar:{}", event.event), event.data);
                    }
                    // Otherwise parse as response
                    else if let Ok(response) = serde_json::from_str::<IPCResponse>(&json) {
                        let _ = app_handle.emit("sidecar:response", response);
                    }
                    // Unknown format
                    else {
                        error!("Unknown sidecar output: {}", json);
                    }
                }
                Err(e) => {
                    error!("Sidecar stdout error: {}", e);
                    break;
                }
            }
        }
        info!("Sidecar stdout reader exited");
    });

    // Forward stderr to logs
    let app_handle = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(log) => {
                    info!("[sidecar] {}", log);
                    let _ = app_handle.emit("sidecar:log", log);
                }
                Err(e) => {
                    error!("Sidecar stderr error: {}", e);
                    break;
                }
            }
        }
    });

    info!("Sidecar spawned successfully");
    Ok(())
}

// ============================================================================
// App Entry
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("marvin_desktop=debug".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar(Mutex::new(SidecarState::default())))
        .setup(|app| {
            info!("Starting Marvin Desktop");
            spawn_sidecar(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_to_sidecar,
            restart_sidecar,
            sidecar_status,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Clean shutdown: send shutdown to sidecar
                let state: State<Sidecar> = window.state();
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut process) = guard.process.take() {
                        // Try graceful shutdown first
                        if let Some(ref mut stdin) = guard.stdin {
                            let _ = writeln!(stdin, r#"{{"id":0,"method":"shutdown","params":{{}}}}"#);
                            let _ = stdin.flush();
                        }
                        // Give it a moment, then force kill
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        let _ = process.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Why**: Complete Rust implementation for sidecar lifecycle. Key features:
- Spawns sidecar on app start
- Forwards stdout JSON lines as Tauri events
- Logs stderr for debugging
- Graceful shutdown on window close

#### 5. Implement full sidecar handlers
**File**: `apps/desktop/sidecar/main.ts`
**Location**: replace entire file

**After**:
```typescript
/**
 * Marvin Desktop Sidecar
 * 
 * Runs as a child process of the Tauri app, communicating via stdio.
 * Hosts the Agent, tools, sessions, and config.
 */

import { createInterface } from "readline"
import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens, createModelCycleState, cycleModel, cycleThinkingLevel, getCurrentModel, getReasoningEffort } from "@marvin-agents/agent-core"
import { getApiKey, type AgentTool, type Message } from "@marvin-agents/ai"
import { codingTools } from "@marvin-agents/base-tools"
import { createLspManager, wrapToolsWithLspDiagnostics } from "@marvin-agents/lsp"
import type { AgentEvent, ThinkingLevel } from "@marvin-agents/agent-core"

// Import from coding-agent for shared functionality
// Note: These will need to be extracted to a shared package or duplicated
import { loadAppConfig, updateAppConfig } from "../../coding-agent/src/config.js"
import { SessionManager } from "../../coding-agent/src/session-manager.js"
import { loadHooks, HookRunner, wrapToolsWithHooks } from "../../coding-agent/src/hooks/index.js"
import { loadCustomTools, getToolNames, type SendRef } from "../../coding-agent/src/custom-tools/index.js"

import type { 
  IPCRequest, 
  IPCResponse, 
  IPCEvent, 
  IPCMethod,
  IPCMethodParams,
  IPCMethodResult,
  InitResult,
  SessionListResult,
  SessionLoadResult,
  SessionNewResult,
  ConfigResult,
  ModelCycleResult,
  ThinkingCycleResult,
  StateResult,
  ContextResult,
  SerializedUIMessage,
} from "../src/ipc/protocol.js"

const IPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  AGENT_BUSY: -32000,
  SESSION_NOT_FOUND: -32001,
  CONFIG_ERROR: -32002,
} as const

// ============================================================================
// State
// ============================================================================

let agent: Agent | null = null
let sessionManager: SessionManager | null = null
let hookRunner: HookRunner | null = null
let lspManager: ReturnType<typeof createLspManager> | null = null
let modelCycleState: ReturnType<typeof createModelCycleState> | null = null
let configDir: string = ""
let currentCwd: string = ""

// Send ref for custom tools (late-bound)
const sendRef: SendRef = { current: () => {} }

// Activity tracking
let activityState: "idle" | "thinking" | "streaming" | "tool" = "idle"
let isResponding = false

// ============================================================================
// IPC Transport
// ============================================================================

const sendResponse = <M extends IPCMethod>(id: number, result: IPCMethodResult[M]): void => {
  const response: IPCResponse<M> = { id, result }
  process.stdout.write(JSON.stringify(response) + "\n")
}

const sendError = (id: number, code: number, message: string): void => {
  const response: IPCResponse = { id, error: { code, message } }
  process.stdout.write(JSON.stringify(response) + "\n")
}

const sendEvent = <T extends keyof import("../src/ipc/protocol.js").IPCEventData>(
  event: T, 
  data: import("../src/ipc/protocol.js").IPCEventData[T]
): void => {
  const msg: IPCEvent<T> = { event, data }
  process.stdout.write(JSON.stringify(msg) + "\n")
}

// ============================================================================
// Handlers
// ============================================================================

const handlers: { [M in IPCMethod]: (params: IPCMethodParams[M]) => Promise<IPCMethodResult[M]> } = {
  // === Lifecycle ===
  
  async init(params) {
    currentCwd = params.cwd
    process.chdir(currentCwd)
    
    const loaded = await loadAppConfig({})
    configDir = loaded.configDir
    
    // Initialize transports
    const getApiKeyForProvider = (provider: string): string | undefined => {
      if (provider === "anthropic") {
        return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider)
      }
      return getApiKey(provider)
    }
    
    const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider })
    const codexTransport = new CodexTransport({
      getTokens: async () => loadTokens({ configDir }),
      setTokens: async (tokens) => saveTokens(tokens, { configDir }),
      clearTokens: async () => clearTokens({ configDir }),
    })
    const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport })
    
    // Load hooks
    const { hooks, errors: hookErrors } = await loadHooks(configDir)
    hookRunner = new HookRunner(hooks, currentCwd, configDir)
    for (const { path, error } of hookErrors) {
      process.stderr.write(`Hook load error: ${path}: ${error}\n`)
    }
    
    // Load custom tools
    const { tools: customTools, errors: toolErrors } = await loadCustomTools(
      configDir, currentCwd, getToolNames(codingTools), sendRef
    )
    for (const { path, error } of toolErrors) {
      process.stderr.write(`Tool load error: ${path}: ${error}\n`)
    }
    
    // Initialize LSP
    lspManager = createLspManager({
      cwd: currentCwd,
      configDir,
      enabled: loaded.lsp.enabled,
      autoInstall: loaded.lsp.autoInstall,
    })
    
    // Combine and wrap tools
    const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map(t => t.tool)]
    const tools = wrapToolsWithLspDiagnostics(
      wrapToolsWithHooks(allTools, hookRunner!),
      lspManager,
      { cwd: currentCwd }
    )
    
    // Initialize model cycling
    modelCycleState = createModelCycleState([loaded.modelId], loaded.thinking)
    
    // Create agent
    agent = new Agent({
      transport,
      initialState: {
        systemPrompt: loaded.systemPrompt,
        model: loaded.model,
        thinkingLevel: loaded.thinking,
        tools,
      },
    })
    
    // Subscribe to agent events and forward to webview
    agent.subscribe((event: AgentEvent) => {
      sendEvent("agent", event)
      
      // Update activity state based on event type
      switch (event.type) {
        case "agent_start":
          isResponding = true
          activityState = "thinking"
          sendEvent("activity", { state: "thinking" })
          break
        case "message_start":
          activityState = "streaming"
          sendEvent("activity", { state: "streaming" })
          break
        case "tool_execution_start":
          activityState = "tool"
          sendEvent("activity", { state: "tool" })
          break
        case "tool_execution_end":
          activityState = "streaming"
          sendEvent("activity", { state: "streaming" })
          break
        case "agent_end":
          isResponding = false
          activityState = "idle"
          sendEvent("activity", { state: "idle" })
          break
      }
    })
    
    // Initialize session manager
    sessionManager = new SessionManager(configDir)
    
    // Emit app.start hook
    await hookRunner.emit({ type: "app.start" })
    
    // Wire up send handler for hooks/custom tools
    sendRef.current = (text) => {
      // Queue message to agent
      if (agent) {
        void agent.queueMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
      }
    }
    hookRunner.setSendHandler(sendRef.current)
    
    const result: InitResult = {
      configDir,
      provider: loaded.provider,
      modelId: loaded.modelId,
      thinking: loaded.thinking,
      sessionId: null,
      contextWindow: loaded.model.contextWindow ?? 128000,
    }
    
    return result
  },
  
  async shutdown() {
    await lspManager?.shutdown().catch(() => {})
    return {}
  },
  
  // === Agent Control ===
  
  async prompt(params) {
    if (!agent) throw new Error("Agent not initialized")
    if (isResponding) throw new Error("Agent is busy")
    
    // Start new session if needed
    if (!sessionManager?.currentSessionId) {
      const state = agent.state
      sessionManager?.startSession(
        (state.model as any).provider ?? "unknown",
        (state.model as any).id ?? "unknown",
        state.thinkingLevel ?? "off"
      )
    }
    
    // Emit session hook
    await hookRunner?.emit({ 
      type: "session.start", 
      sessionId: sessionManager?.currentSessionId ?? null 
    })
    
    await agent.prompt(params.text)
    
    // Persist messages
    for (const msg of agent.state.messages) {
      sessionManager?.appendMessage(msg)
    }
    
    return {}
  },
  
  async abort() {
    agent?.abort()
    agent?.clearMessageQueue()
    isResponding = false
    activityState = "idle"
    sendEvent("activity", { state: "idle" })
    return {}
  },
  
  async continue() {
    if (!agent) throw new Error("Agent not initialized")
    await agent.continue()
    return {}
  },
  
  // === Session Management ===
  
  async ["session.list"]() {
    if (!sessionManager) throw new Error("Session manager not initialized")
    
    const sessions = sessionManager.loadAllSessions()
    const result: SessionListResult = {
      sessions: sessions.map(s => ({
        id: s.id,
        path: s.path,
        timestamp: s.timestamp,
        provider: s.provider,
        modelId: s.modelId,
        messageCount: s.messageCount,
        preview: s.preview,
      })),
    }
    return result
  },
  
  async ["session.load"](params) {
    if (!sessionManager || !agent) throw new Error("Not initialized")
    
    const sessions = sessionManager.loadAllSessions()
    const session = sessions.find(s => s.id === params.sessionId)
    if (!session) throw new Error("Session not found")
    
    const loaded = sessionManager.loadSession(session.path)
    if (!loaded) throw new Error("Failed to load session")
    
    sessionManager.continueSession(session.path, session.id)
    agent.replaceMessages(loaded.messages as Message[])
    
    await hookRunner?.emit({ type: "session.resume", sessionId: session.id })
    
    const result: SessionLoadResult = {
      sessionId: session.id,
      messages: serializeMessages(loaded.messages),
    }
    return result
  },
  
  async ["session.new"]() {
    if (!sessionManager || !agent) throw new Error("Not initialized")
    
    const state = agent.state
    const sessionId = sessionManager.startSession(
      (state.model as any).provider ?? "unknown",
      (state.model as any).id ?? "unknown",
      state.thinkingLevel ?? "off"
    )
    
    agent.replaceMessages([])
    
    await hookRunner?.emit({ type: "session.start", sessionId })
    sendEvent("session.changed", { sessionId })
    
    const result: SessionNewResult = { sessionId }
    return result
  },
  
  async ["session.clear"]() {
    if (!sessionManager || !agent) throw new Error("Not initialized")
    
    sessionManager.clearCurrentSession()
    agent.replaceMessages([])
    
    await hookRunner?.emit({ type: "session.clear", sessionId: null })
    
    return {}
  },
  
  // === Config ===
  
  async ["config.get"]() {
    if (!agent || !modelCycleState) throw new Error("Not initialized")
    
    const state = agent.state
    const result: ConfigResult = {
      provider: (state.model as any).provider ?? "anthropic",
      modelId: (state.model as any).id ?? "",
      thinking: state.thinkingLevel ?? "off",
      theme: "dark", // TODO: Load from config
      models: [], // TODO: Load available models
    }
    return result
  },
  
  async ["config.update"](params) {
    await updateAppConfig(configDir, params.updates)
    return {}
  },
  
  async ["model.cycle"]() {
    if (!agent || !modelCycleState) throw new Error("Not initialized")
    
    const newModel = cycleModel(modelCycleState)
    // TODO: Update agent with new model
    
    const result: ModelCycleResult = {
      provider: newModel.provider as any,
      modelId: newModel.id,
    }
    return result
  },
  
  async ["thinking.cycle"]() {
    if (!agent || !modelCycleState) throw new Error("Not initialized")
    
    const newThinking = cycleThinkingLevel(modelCycleState)
    agent.setThinkingLevel(newThinking)
    
    const result: ThinkingCycleResult = { thinking: newThinking }
    return result
  },
  
  // === State Queries ===
  
  async ["state.get"]() {
    if (!agent) throw new Error("Not initialized")
    
    const result: StateResult = {
      isResponding,
      activityState,
      pendingToolCalls: Array.from(agent.state.pendingToolCalls ?? []),
    }
    return result
  },
  
  async ["context.get"]() {
    // TODO: Implement actual context window tracking
    const result: ContextResult = {
      tokens: 0,
      maxTokens: 128000,
    }
    return result
  },
}

// ============================================================================
// Helpers
// ============================================================================

function serializeMessages(messages: any[]): SerializedUIMessage[] {
  return messages.map(msg => ({
    id: msg.id ?? crypto.randomUUID(),
    role: msg.role,
    content: typeof msg.content === "string" ? msg.content : "",
    timestamp: msg.timestamp,
  }))
}

// ============================================================================
// Main Loop
// ============================================================================

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on("line", async (line: string) => {
  let request: IPCRequest
  
  try {
    request = JSON.parse(line)
  } catch {
    process.stderr.write(`Parse error: ${line}\n`)
    return
  }

  const handler = handlers[request.method as IPCMethod]
  if (!handler) {
    sendError(request.id, IPC_ERROR.METHOD_NOT_FOUND, `Unknown method: ${request.method}`)
    return
  }

  try {
    const result = await handler(request.params as any)
    sendResponse(request.id, result as any)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Handler error [${request.method}]: ${message}\n`)
    sendError(request.id, IPC_ERROR.INTERNAL_ERROR, message)
  }
})

// Heartbeat
setInterval(() => {
  sendEvent("heartbeat", { timestamp: Date.now() })
}, 5000)

// Graceful shutdown
process.on("SIGTERM", async () => {
  await handlers.shutdown({})
  process.exit(0)
})

process.on("SIGINT", async () => {
  await handlers.shutdown({})
  process.exit(0)
})

process.stderr.write("Marvin sidecar started\n")
```

**Why**: Complete implementation of all IPC handlers. Reuses existing code from coding-agent where possible.

#### 6. Create Tauri config
**File**: `apps/desktop/src-tauri/tauri.conf.json`
**Location**: new file

**Add**:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Marvin",
  "version": "0.1.0",
  "identifier": "com.marvin.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "bun run build",
    "beforeDevCommand": "bun run dev"
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "externalBin": ["sidecars/marvin-sidecar"]
  },
  "app": {
    "windows": [
      {
        "title": "Marvin",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "decorations": true,
        "transparent": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "plugins": {
    "shell": {
      "sidecar": true,
      "scope": [
        {
          "name": "marvin-sidecar",
          "sidecar": true
        }
      ]
    }
  }
}
```

### Edge Cases to Handle
- [ ] Sidecar crashes unexpectedly → Emit error event, offer restart
- [ ] Sidecar hangs (no heartbeat for 30s) → Kill and restart
- [ ] Multiple rapid requests → Queue in sidecar or reject with AGENT_BUSY
- [ ] Window close during active request → Graceful abort before shutdown

### Success Criteria

**Automated**:
```bash
cd apps/desktop/src-tauri && cargo check    # Rust compiles
cd apps/desktop && bun run build:sidecar     # Sidecar binary builds
```

**Before proceeding**:
```bash
cd apps/desktop && bun run tauri dev  # App launches (even with blank webview)
# Verify in console: "Marvin sidecar started" appears
# Verify heartbeat events logged every 5s
```

**Manual**:
- [ ] Tauri window opens
- [ ] Sidecar process visible in Activity Monitor/Task Manager
- [ ] Closing window kills sidecar process

### Rollback
```bash
rm -rf apps/desktop/src-tauri/src apps/desktop/src-tauri/Cargo.toml
git restore apps/desktop/sidecar/main.ts
```

### Notes
_Space for implementer discoveries_

---

## Phase 3: Web UI Component Library (Core)

### Overview
Implement the essential web UI components needed for basic chat functionality: Markdown rendering, code blocks with syntax highlighting, and the input editor.

### Prerequisites
- [ ] Phase 1 complete
- [ ] `packages/desktop-ui` dependencies installed

### Change Checklist
- [ ] Implement theme context and provider
- [ ] Implement Markdown component with GFM support
- [ ] Implement CodeBlock with Shiki syntax highlighting
- [ ] Implement Editor/Input components
- [ ] Implement Loader/Spinner component
- [ ] Export all components from index

### Changes

#### 1. Create theme context
**File**: `packages/desktop-ui/src/context/theme.tsx`
**Location**: new file

**Add**:
```typescript
import { createContext, useContext, createSignal, type ParentComponent, type Accessor } from "solid-js"

export interface ThemeColors {
  // Backgrounds
  bg: string
  bgSubtle: string
  bgMuted: string
  bgAccent: string
  
  // Foregrounds
  fg: string
  fgSubtle: string
  fgMuted: string
  
  // Accents
  accent: string
  accentSubtle: string
  
  // Semantic
  success: string
  warning: string
  error: string
  info: string
  
  // Borders
  border: string
  borderSubtle: string
}

export interface Theme {
  name: string
  mode: "light" | "dark"
  colors: ThemeColors
  fontFamily: {
    sans: string
    mono: string
  }
  fontSize: {
    xs: string
    sm: string
    base: string
    lg: string
    xl: string
  }
  spacing: {
    xs: string
    sm: string
    md: string
    lg: string
    xl: string
  }
  radius: {
    sm: string
    md: string
    lg: string
  }
}

const darkTheme: Theme = {
  name: "dark",
  mode: "dark",
  colors: {
    bg: "#0d1117",
    bgSubtle: "#161b22",
    bgMuted: "#21262d",
    bgAccent: "#30363d",
    fg: "#e6edf3",
    fgSubtle: "#8b949e",
    fgMuted: "#6e7681",
    accent: "#58a6ff",
    accentSubtle: "#388bfd",
    success: "#3fb950",
    warning: "#d29922",
    error: "#f85149",
    info: "#58a6ff",
    border: "#30363d",
    borderSubtle: "#21262d",
  },
  fontFamily: {
    sans: "system-ui, -apple-system, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  },
  fontSize: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
  },
  radius: {
    sm: "0.25rem",
    md: "0.375rem",
    lg: "0.5rem",
  },
}

const lightTheme: Theme = {
  ...darkTheme,
  name: "light",
  mode: "light",
  colors: {
    bg: "#ffffff",
    bgSubtle: "#f6f8fa",
    bgMuted: "#eaeef2",
    bgAccent: "#dfe3e8",
    fg: "#1f2328",
    fgSubtle: "#656d76",
    fgMuted: "#8c959f",
    accent: "#0969da",
    accentSubtle: "#218bff",
    success: "#1a7f37",
    warning: "#9a6700",
    error: "#cf222e",
    info: "#0969da",
    border: "#d0d7de",
    borderSubtle: "#eaeef2",
  },
}

export const themes = { dark: darkTheme, light: lightTheme }

interface ThemeContextValue {
  theme: Accessor<Theme>
  setTheme: (name: "dark" | "light") => void
}

const ThemeContext = createContext<ThemeContextValue>()

export const ThemeProvider: ParentComponent<{ initial?: "dark" | "light" }> = (props) => {
  const [theme, setThemeSignal] = createSignal(themes[props.initial ?? "dark"])
  
  const setTheme = (name: "dark" | "light") => {
    setThemeSignal(themes[name])
  }
  
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {props.children}
    </ThemeContext.Provider>
  )
}

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
```

#### 2. Create Markdown component
**File**: `packages/desktop-ui/src/components/Markdown.tsx`
**Location**: new file

**Add**:
```typescript
import { SolidMarkdown } from "solid-markdown"
import remarkGfm from "remark-gfm"
import { splitProps, type Component } from "solid-js"
import { useTheme } from "../context/theme"
import { CodeBlock } from "./CodeBlock"

export interface MarkdownProps {
  content: string
  class?: string
  streaming?: boolean
}

export const Markdown: Component<MarkdownProps> = (props) => {
  const [local, rest] = splitProps(props, ["content", "class", "streaming"])
  const { theme } = useTheme()
  
  return (
    <div
      class={`markdown-content ${local.class ?? ""}`}
      style={{
        "font-family": theme().fontFamily.sans,
        "font-size": theme().fontSize.base,
        color: theme().colors.fg,
        "line-height": "1.6",
      }}
    >
      <SolidMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom code block rendering
          code: (codeProps) => {
            const isInline = !codeProps.node?.position?.start.line
            if (isInline) {
              return (
                <code
                  style={{
                    "background-color": theme().colors.bgMuted,
                    padding: "0.125rem 0.25rem",
                    "border-radius": theme().radius.sm,
                    "font-family": theme().fontFamily.mono,
                    "font-size": "0.875em",
                  }}
                >
                  {codeProps.children}
                </code>
              )
            }
            
            // Extract language from className (e.g., "language-typescript")
            const className = codeProps.class ?? ""
            const match = className.match(/language-(\w+)/)
            const language = match?.[1] ?? "text"
            
            return (
              <CodeBlock
                content={String(codeProps.children).replace(/\n$/, "")}
                language={language}
              />
            )
          },
          
          // Style other elements
          p: (pProps) => (
            <p style={{ margin: `${theme().spacing.sm} 0` }}>
              {pProps.children}
            </p>
          ),
          
          a: (aProps) => (
            <a
              href={aProps.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme().colors.accent }}
            >
              {aProps.children}
            </a>
          ),
          
          ul: (ulProps) => (
            <ul style={{ "margin-left": theme().spacing.lg, "list-style-type": "disc" }}>
              {ulProps.children}
            </ul>
          ),
          
          ol: (olProps) => (
            <ol style={{ "margin-left": theme().spacing.lg, "list-style-type": "decimal" }}>
              {olProps.children}
            </ol>
          ),
          
          blockquote: (bqProps) => (
            <blockquote
              style={{
                "border-left": `3px solid ${theme().colors.border}`,
                "padding-left": theme().spacing.md,
                margin: `${theme().spacing.sm} 0`,
                color: theme().colors.fgSubtle,
              }}
            >
              {bqProps.children}
            </blockquote>
          ),
          
          h1: (h1Props) => (
            <h1 style={{ "font-size": theme().fontSize.xl, "font-weight": "bold", margin: `${theme().spacing.md} 0 ${theme().spacing.sm}` }}>
              {h1Props.children}
            </h1>
          ),
          
          h2: (h2Props) => (
            <h2 style={{ "font-size": theme().fontSize.lg, "font-weight": "bold", margin: `${theme().spacing.md} 0 ${theme().spacing.sm}` }}>
              {h2Props.children}
            </h2>
          ),
          
          h3: (h3Props) => (
            <h3 style={{ "font-size": theme().fontSize.base, "font-weight": "bold", margin: `${theme().spacing.sm} 0` }}>
              {h3Props.children}
            </h3>
          ),
        }}
      >
        {local.content}
      </SolidMarkdown>
      
      {/* Streaming cursor */}
      {local.streaming && (
        <span
          class="streaming-cursor"
          style={{
            display: "inline-block",
            width: "2px",
            height: "1em",
            "background-color": theme().colors.accent,
            "margin-left": "2px",
            animation: "blink 1s infinite",
          }}
        />
      )}
    </div>
  )
}
```

#### 3. Create CodeBlock component with Shiki
**File**: `packages/desktop-ui/src/components/CodeBlock.tsx`
**Location**: new file

**Add**:
```typescript
import { createResource, createSignal, Show, type Component } from "solid-js"
import { useTheme } from "../context/theme"

// Lazy load shiki to avoid blocking initial render
let highlighterPromise: Promise<any> | null = null

const getHighlighter = async () => {
  if (!highlighterPromise) {
    const { createHighlighter } = await import("shiki")
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [
        "typescript", "javascript", "python", "rust", "go", "bash", "shell",
        "json", "yaml", "toml", "markdown", "html", "css", "sql", "diff",
        "tsx", "jsx", "c", "cpp", "java", "ruby", "php", "swift", "kotlin",
      ],
    })
  }
  return highlighterPromise
}

export interface CodeBlockProps {
  content: string
  language?: string
  title?: string
  showLineNumbers?: boolean
  showCopyButton?: boolean
}

export const CodeBlock: Component<CodeBlockProps> = (props) => {
  const { theme } = useTheme()
  const [copied, setCopied] = createSignal(false)
  
  const [html] = createResource(
    () => [props.content, props.language, theme().mode] as const,
    async ([code, lang, mode]) => {
      try {
        const highlighter = await getHighlighter()
        const themeName = mode === "dark" ? "github-dark" : "github-light"
        
        // Check if language is supported
        const loadedLangs = highlighter.getLoadedLanguages()
        const effectiveLang = loadedLangs.includes(lang ?? "") ? lang : "text"
        
        return highlighter.codeToHtml(code, {
          lang: effectiveLang ?? "text",
          theme: themeName,
        })
      } catch (e) {
        console.warn("Shiki highlighting failed:", e)
        return null
      }
    }
  )
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <div
      class="code-block"
      style={{
        position: "relative",
        margin: `${theme().spacing.sm} 0`,
        "border-radius": theme().radius.md,
        overflow: "hidden",
        "background-color": theme().colors.bgSubtle,
        border: `1px solid ${theme().colors.border}`,
      }}
    >
      {/* Header with title and copy button */}
      <Show when={props.title || props.showCopyButton !== false}>
        <div
          class="code-block-header"
          style={{
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
            padding: `${theme().spacing.xs} ${theme().spacing.sm}`,
            "background-color": theme().colors.bgMuted,
            "border-bottom": `1px solid ${theme().colors.border}`,
            "font-size": theme().fontSize.sm,
          }}
        >
          <span style={{ color: theme().colors.fgSubtle }}>
            {props.title ?? props.language ?? ""}
          </span>
          <Show when={props.showCopyButton !== false}>
            <button
              onClick={handleCopy}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: copied() ? theme().colors.success : theme().colors.fgSubtle,
                "font-size": theme().fontSize.sm,
                padding: theme().spacing.xs,
              }}
            >
              {copied() ? "Copied!" : "Copy"}
            </button>
          </Show>
        </div>
      </Show>
      
      {/* Code content */}
      <div
        class="code-block-content"
        style={{
          padding: theme().spacing.sm,
          overflow: "auto",
          "font-family": theme().fontFamily.mono,
          "font-size": theme().fontSize.sm,
          "line-height": "1.5",
        }}
      >
        <Show
          when={html()}
          fallback={
            <pre style={{ margin: 0, "white-space": "pre-wrap" }}>
              <code>{props.content}</code>
            </pre>
          }
        >
          <div innerHTML={html()!} />
        </Show>
      </div>
    </div>
  )
}
```

#### 4. Create Editor component
**File**: `packages/desktop-ui/src/components/Editor.tsx`
**Location**: new file

**Add**:
```typescript
import { createSignal, createEffect, onMount, onCleanup, type Component } from "solid-js"
import { useTheme } from "../context/theme"

export interface EditorProps {
  value?: string
  placeholder?: string
  disabled?: boolean
  minRows?: number
  maxRows?: number
  autofocus?: boolean
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
  onEscape?: () => void
  ref?: (el: EditorRef) => void
}

export interface EditorRef {
  focus: () => void
  blur: () => void
  clear: () => void
  getValue: () => string
  setValue: (value: string) => void
}

export const Editor: Component<EditorProps> = (props) => {
  const { theme } = useTheme()
  let textareaRef: HTMLTextAreaElement | undefined
  const [localValue, setLocalValue] = createSignal(props.value ?? "")
  
  // Expose ref methods
  onMount(() => {
    if (props.ref) {
      props.ref({
        focus: () => textareaRef?.focus(),
        blur: () => textareaRef?.blur(),
        clear: () => {
          setLocalValue("")
          if (textareaRef) textareaRef.value = ""
        },
        getValue: () => localValue(),
        setValue: (value) => {
          setLocalValue(value)
          if (textareaRef) textareaRef.value = value
        },
      })
    }
    
    if (props.autofocus && textareaRef) {
      textareaRef.focus()
    }
  })
  
  // Sync external value changes
  createEffect(() => {
    if (props.value !== undefined && props.value !== localValue()) {
      setLocalValue(props.value)
      if (textareaRef) textareaRef.value = props.value
    }
  })
  
  // Auto-resize textarea
  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    const lineHeight = parseInt(getComputedStyle(textareaRef).lineHeight) || 24
    const minHeight = (props.minRows ?? 1) * lineHeight
    const maxHeight = (props.maxRows ?? 10) * lineHeight
    const newHeight = Math.min(Math.max(textareaRef.scrollHeight, minHeight), maxHeight)
    textareaRef.style.height = `${newHeight}px`
  }
  
  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    setLocalValue(target.value)
    props.onChange?.(target.value)
    adjustHeight()
  }
  
  const handleKeyDown = (e: KeyboardEvent) => {
    // Submit on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const value = localValue().trim()
      if (value) {
        props.onSubmit?.(value)
      }
      return
    }
    
    // Cancel on Escape
    if (e.key === "Escape") {
      props.onEscape?.()
      return
    }
  }
  
  onMount(adjustHeight)
  
  return (
    <textarea
      ref={textareaRef}
      value={localValue()}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      style={{
        width: "100%",
        padding: theme().spacing.sm,
        "font-family": theme().fontFamily.sans,
        "font-size": theme().fontSize.base,
        "line-height": "1.5",
        color: theme().colors.fg,
        "background-color": theme().colors.bgSubtle,
        border: `1px solid ${theme().colors.border}`,
        "border-radius": theme().radius.md,
        outline: "none",
        resize: "none",
        overflow: "auto",
      }}
      onfocus={(e) => {
        (e.target as HTMLTextAreaElement).style.borderColor = theme().colors.accent
      }}
      onblur={(e) => {
        (e.target as HTMLTextAreaElement).style.borderColor = theme().colors.border
      }}
    />
  )
}

// Single-line input variant
export interface InputProps {
  value?: string
  placeholder?: string
  disabled?: boolean
  type?: "text" | "password"
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
  onEscape?: () => void
}

export const Input: Component<InputProps> = (props) => {
  const { theme } = useTheme()
  
  return (
    <input
      type={props.type ?? "text"}
      value={props.value ?? ""}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onInput={(e) => props.onChange?.((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onSubmit?.((e.target as HTMLInputElement).value)
        if (e.key === "Escape") props.onEscape?.()
      }}
      style={{
        width: "100%",
        padding: theme().spacing.sm,
        "font-family": theme().fontFamily.sans,
        "font-size": theme().fontSize.base,
        color: theme().colors.fg,
        "background-color": theme().colors.bgSubtle,
        border: `1px solid ${theme().colors.border}`,
        "border-radius": theme().radius.md,
        outline: "none",
      }}
    />
  )
}
```

#### 5. Create Loader component
**File**: `packages/desktop-ui/src/components/Loader.tsx`
**Location**: new file

**Add**:
```typescript
import { type Component } from "solid-js"
import { useTheme } from "../context/theme"

export interface LoaderProps {
  size?: "sm" | "md" | "lg"
  message?: string
}

export const Loader: Component<LoaderProps> = (props) => {
  const { theme } = useTheme()
  
  const sizes = {
    sm: "16px",
    md: "24px",
    lg: "32px",
  }
  
  const size = sizes[props.size ?? "md"]
  
  return (
    <div
      class="loader"
      style={{
        display: "flex",
        "align-items": "center",
        gap: theme().spacing.sm,
      }}
    >
      <div
        class="loader-spinner"
        style={{
          width: size,
          height: size,
          border: `2px solid ${theme().colors.border}`,
          "border-top-color": theme().colors.accent,
          "border-radius": "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      {props.message && (
        <span style={{ color: theme().colors.fgSubtle, "font-size": theme().fontSize.sm }}>
          {props.message}
        </span>
      )}
    </div>
  )
}

// CSS for animations (inject once)
if (typeof document !== "undefined") {
  const style = document.createElement("style")
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }
  `
  document.head.appendChild(style)
}
```

#### 6. Update package index
**File**: `packages/desktop-ui/src/index.ts`
**Location**: replace entire file

**After**:
```typescript
/**
 * @marvin-agents/desktop-ui
 * 
 * Web UI components for Marvin Desktop (Tauri)
 */

// Context
export { ThemeProvider, useTheme, themes, type Theme, type ThemeColors } from "./context/theme"

// Components - Core
export { Markdown, type MarkdownProps } from "./components/Markdown"
export { CodeBlock, type CodeBlockProps } from "./components/CodeBlock"
export { Editor, Input, type EditorProps, type EditorRef, type InputProps } from "./components/Editor"
export { Loader, type LoaderProps } from "./components/Loader"

// Components - Extended (Phase 4)
// export { Diff, type DiffProps } from "./components/Diff"
// export { Dialog, type DialogProps } from "./components/Dialog"
// export { SelectList, type SelectListProps } from "./components/SelectList"
// export { Toast, ToastViewport, type ToastProps } from "./components/Toast"
```

### Edge Cases to Handle
- [ ] Unknown language in CodeBlock → Fall back to plain text
- [ ] Shiki load failure → Show unhighlighted code
- [ ] Very long code blocks → Ensure horizontal scroll
- [ ] Markdown injection attacks → solid-markdown sanitizes by default
- [ ] Empty content → Render nothing gracefully

### Success Criteria

**Automated**:
```bash
cd packages/desktop-ui && bun run typecheck  # Zero errors
```

**Before proceeding**:
```bash
# Create a simple test page to verify components render
bun run --cwd apps/desktop dev
# Navigate to http://localhost:5173 (will show test content in Phase 5)
```

**Manual**:
- [ ] CodeBlock renders with syntax highlighting
- [ ] Markdown renders headings, lists, code, links
- [ ] Editor auto-resizes on input
- [ ] Loader spinner animates

### Rollback
```bash
rm -rf packages/desktop-ui/src/components packages/desktop-ui/src/context
git restore packages/desktop-ui/src/index.ts
```

### Notes
_Space for implementer discoveries_

---

## Phase 4: Web UI Component Library (Extended)

### Overview
Implement remaining UI components: Diff viewer, Dialog modal, SelectList for autocomplete/session picker, and Toast notifications.

### Prerequisites
- [ ] Phase 3 complete

### Change Checklist
- [ ] Implement Diff component with unified/split view
- [ ] Implement Dialog component with overlay
- [ ] Implement SelectList with keyboard navigation
- [ ] Implement Toast and ToastViewport
- [ ] Update package index exports

### Changes

#### 1. Create Diff component
**File**: `packages/desktop-ui/src/components/Diff.tsx`
**Location**: new file

**Add**:
```typescript
import { createMemo, For, Show, type Component } from "solid-js"
import { diffLines, diffWords, type Change } from "diff"
import { useTheme } from "../context/theme"

export type DiffView = "unified" | "split"

export interface DiffProps {
  oldText: string
  newText: string
  oldTitle?: string
  newTitle?: string
  view?: DiffView
  language?: string
}

export const Diff: Component<DiffProps> = (props) => {
  const { theme } = useTheme()
  
  const lineDiff = createMemo(() => diffLines(props.oldText, props.newText))
  
  const getLineStyle = (change: Change) => {
    if (change.added) {
      return {
        "background-color": theme().mode === "dark" ? "#1a3d1a" : "#d4edda",
        color: theme().colors.success,
      }
    }
    if (change.removed) {
      return {
        "background-color": theme().mode === "dark" ? "#3d1a1a" : "#f8d7da",
        color: theme().colors.error,
      }
    }
    return {}
  }
  
  const getPrefix = (change: Change) => {
    if (change.added) return "+"
    if (change.removed) return "-"
    return " "
  }
  
  return (
    <div
      class="diff-viewer"
      style={{
        "font-family": theme().fontFamily.mono,
        "font-size": theme().fontSize.sm,
        "border-radius": theme().radius.md,
        overflow: "hidden",
        border: `1px solid ${theme().colors.border}`,
      }}
    >
      {/* Header */}
      <Show when={props.oldTitle || props.newTitle}>
        <div
          class="diff-header"
          style={{
            display: "flex",
            "background-color": theme().colors.bgMuted,
            "border-bottom": `1px solid ${theme().colors.border}`,
          }}
        >
          <Show when={props.oldTitle}>
            <div style={{ flex: 1, padding: theme().spacing.sm, color: theme().colors.error }}>
              − {props.oldTitle}
            </div>
          </Show>
          <Show when={props.newTitle}>
            <div style={{ flex: 1, padding: theme().spacing.sm, color: theme().colors.success }}>
              + {props.newTitle}
            </div>
          </Show>
        </div>
      </Show>
      
      {/* Unified diff view */}
      <div
        class="diff-content"
        style={{
          "background-color": theme().colors.bgSubtle,
          overflow: "auto",
        }}
      >
        <For each={lineDiff()}>
          {(change) => (
            <div
              class="diff-line"
              style={{
                display: "flex",
                ...getLineStyle(change),
              }}
            >
              <span
                class="diff-prefix"
                style={{
                  "user-select": "none",
                  width: "1.5em",
                  "text-align": "center",
                  color: change.added ? theme().colors.success : change.removed ? theme().colors.error : theme().colors.fgMuted,
                }}
              >
                {getPrefix(change)}
              </span>
              <pre
                style={{
                  margin: 0,
                  flex: 1,
                  padding: `0 ${theme().spacing.sm}`,
                  "white-space": "pre-wrap",
                  "word-break": "break-all",
                }}
              >
                {change.value}
              </pre>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
```

#### 2. Create Dialog component
**File**: `packages/desktop-ui/src/components/Dialog.tsx`
**Location**: new file

**Add**:
```typescript
import { Show, createEffect, onCleanup, type ParentComponent } from "solid-js"
import { Portal } from "solid-js/web"
import { useTheme } from "../context/theme"

export interface DialogProps {
  open: boolean
  title?: string
  onClose?: () => void
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
  width?: string
}

export const Dialog: ParentComponent<DialogProps> = (props) => {
  const { theme } = useTheme()
  
  // Handle escape key
  createEffect(() => {
    if (!props.open || props.closeOnEscape === false) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose?.()
      }
    }
    
    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown))
  })
  
  // Prevent body scroll when open
  createEffect(() => {
    if (props.open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    onCleanup(() => {
      document.body.style.overflow = ""
    })
  })
  
  return (
    <Show when={props.open}>
      <Portal>
        {/* Overlay */}
        <div
          class="dialog-overlay"
          onClick={() => props.closeOnOverlay !== false && props.onClose?.()}
          style={{
            position: "fixed",
            inset: 0,
            "background-color": "rgba(0, 0, 0, 0.5)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "z-index": 1000,
          }}
        >
          {/* Dialog box */}
          <div
            class="dialog-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              "background-color": theme().colors.bg,
              "border-radius": theme().radius.lg,
              border: `1px solid ${theme().colors.border}`,
              "box-shadow": "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              width: props.width ?? "500px",
              "max-width": "90vw",
              "max-height": "85vh",
              overflow: "auto",
            }}
          >
            {/* Header */}
            <Show when={props.title}>
              <div
                class="dialog-header"
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                  padding: theme().spacing.md,
                  "border-bottom": `1px solid ${theme().colors.border}`,
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    "font-size": theme().fontSize.lg,
                    "font-weight": "600",
                    color: theme().colors.fg,
                  }}
                >
                  {props.title}
                </h2>
                <button
                  onClick={() => props.onClose?.()}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: theme().colors.fgSubtle,
                    "font-size": theme().fontSize.xl,
                    "line-height": 1,
                    padding: theme().spacing.xs,
                  }}
                >
                  ×
                </button>
              </div>
            </Show>
            
            {/* Body */}
            <div
              class="dialog-body"
              style={{
                padding: theme().spacing.md,
              }}
            >
              {props.children}
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
```

#### 3. Create SelectList component
**File**: `packages/desktop-ui/src/components/SelectList.tsx`
**Location**: new file

**Add**:
```typescript
import { createSignal, createEffect, For, Show, onMount, onCleanup, type Component } from "solid-js"
import { useTheme } from "../context/theme"

export interface SelectItem {
  value: string
  label: string
  description?: string
}

export interface SelectListProps {
  items: SelectItem[]
  selectedIndex?: number
  maxVisible?: number
  filter?: string
  onSelect?: (item: SelectItem, index: number) => void
  onSelectionChange?: (item: SelectItem, index: number) => void
  onCancel?: () => void
  ref?: (ref: SelectListRef) => void
}

export interface SelectListRef {
  moveUp: () => void
  moveDown: () => void
  select: () => void
  getSelectedIndex: () => number
}

export const SelectList: Component<SelectListProps> = (props) => {
  const { theme } = useTheme()
  const [selectedIndex, setSelectedIndex] = createSignal(props.selectedIndex ?? 0)
  let containerRef: HTMLDivElement | undefined
  
  // Filter items if filter prop provided
  const filteredItems = () => {
    if (!props.filter) return props.items
    const lower = props.filter.toLowerCase()
    return props.items.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) ||
        item.description?.toLowerCase().includes(lower)
    )
  }
  
  // Clamp selected index when items change
  createEffect(() => {
    const items = filteredItems()
    if (selectedIndex() >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1))
    }
  })
  
  // Sync external selectedIndex
  createEffect(() => {
    if (props.selectedIndex !== undefined) {
      setSelectedIndex(props.selectedIndex)
    }
  })
  
  // Notify on selection change
  createEffect(() => {
    const idx = selectedIndex()
    const items = filteredItems()
    if (items[idx]) {
      props.onSelectionChange?.(items[idx], idx)
    }
  })
  
  // Scroll selected item into view
  createEffect(() => {
    const idx = selectedIndex()
    if (containerRef) {
      const item = containerRef.children[idx] as HTMLElement
      item?.scrollIntoView({ block: "nearest" })
    }
  })
  
  const moveUp = () => {
    setSelectedIndex((i) => (i > 0 ? i - 1 : filteredItems().length - 1))
  }
  
  const moveDown = () => {
    setSelectedIndex((i) => (i < filteredItems().length - 1 ? i + 1 : 0))
  }
  
  const select = () => {
    const items = filteredItems()
    const idx = selectedIndex()
    if (items[idx]) {
      props.onSelect?.(items[idx], idx)
    }
  }
  
  // Expose ref
  onMount(() => {
    props.ref?.({
      moveUp,
      moveDown,
      select,
      getSelectedIndex: () => selectedIndex(),
    })
  })
  
  // Keyboard handling
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
        case "k":
          e.preventDefault()
          moveUp()
          break
        case "ArrowDown":
        case "j":
          e.preventDefault()
          moveDown()
          break
        case "Enter":
          e.preventDefault()
          select()
          break
        case "Escape":
          e.preventDefault()
          props.onCancel?.()
          break
      }
    }
    
    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown))
  })
  
  const maxHeight = () => {
    const lineHeight = 48 // Approximate item height
    const max = props.maxVisible ?? 8
    return `${max * lineHeight}px`
  }
  
  return (
    <div
      ref={containerRef}
      class="select-list"
      style={{
        "max-height": maxHeight(),
        "overflow-y": "auto",
        "background-color": theme().colors.bgSubtle,
        "border-radius": theme().radius.md,
        border: `1px solid ${theme().colors.border}`,
      }}
    >
      <Show when={filteredItems().length === 0}>
        <div
          style={{
            padding: theme().spacing.md,
            color: theme().colors.fgMuted,
            "text-align": "center",
          }}
        >
          No items found
        </div>
      </Show>
      
      <For each={filteredItems()}>
        {(item, index) => (
          <div
            class="select-list-item"
            onClick={() => {
              setSelectedIndex(index())
              select()
            }}
            style={{
              padding: `${theme().spacing.sm} ${theme().spacing.md}`,
              cursor: "pointer",
              "background-color": index() === selectedIndex() ? theme().colors.bgAccent : "transparent",
              "border-left": index() === selectedIndex() ? `3px solid ${theme().colors.accent}` : "3px solid transparent",
            }}
          >
            <div style={{ color: theme().colors.fg, "font-weight": index() === selectedIndex() ? "500" : "normal" }}>
              {item.label}
            </div>
            <Show when={item.description}>
              <div style={{ color: theme().colors.fgSubtle, "font-size": theme().fontSize.sm }}>
                {item.description}
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}
```

#### 4. Create Toast component
**File**: `packages/desktop-ui/src/components/Toast.tsx`
**Location**: new file

**Add**:
```typescript
import { For, Show, createSignal, createEffect, type Component } from "solid-js"
import { Portal } from "solid-js/web"
import { useTheme } from "../context/theme"

export type ToastVariant = "info" | "success" | "warning" | "error"

export interface ToastItem {
  id: string
  title: string
  message?: string
  variant?: ToastVariant
  duration?: number
}

export interface ToastProps {
  toast: ToastItem
  onDismiss?: () => void
}

export const Toast: Component<ToastProps> = (props) => {
  const { theme } = useTheme()
  
  const variantColors = () => {
    const colors = theme().colors
    switch (props.toast.variant) {
      case "success": return { bg: colors.success, fg: "#fff" }
      case "warning": return { bg: colors.warning, fg: "#fff" }
      case "error": return { bg: colors.error, fg: "#fff" }
      default: return { bg: colors.bgMuted, fg: colors.fg }
    }
  }
  
  // Auto-dismiss
  createEffect(() => {
    const duration = props.toast.duration ?? 5000
    if (duration > 0) {
      const timer = setTimeout(() => props.onDismiss?.(), duration)
      return () => clearTimeout(timer)
    }
  })
  
  return (
    <div
      class="toast"
      style={{
        "background-color": variantColors().bg,
        color: variantColors().fg,
        padding: theme().spacing.md,
        "border-radius": theme().radius.md,
        "box-shadow": "0 4px 12px rgba(0, 0, 0, 0.15)",
        "min-width": "250px",
        "max-width": "400px",
        display: "flex",
        "justify-content": "space-between",
        "align-items": "flex-start",
        gap: theme().spacing.sm,
      }}
    >
      <div>
        <div style={{ "font-weight": "500" }}>{props.toast.title}</div>
        <Show when={props.toast.message}>
          <div style={{ "font-size": theme().fontSize.sm, opacity: 0.9, "margin-top": theme().spacing.xs }}>
            {props.toast.message}
          </div>
        </Show>
      </div>
      <button
        onClick={() => props.onDismiss?.()}
        style={{
          background: "none",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          opacity: 0.7,
          "font-size": theme().fontSize.lg,
        }}
      >
        ×
      </button>
    </div>
  )
}

export type ToastPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left"

export interface ToastViewportProps {
  toasts: ToastItem[]
  position?: ToastPosition
  onDismiss?: (id: string) => void
}

export const ToastViewport: Component<ToastViewportProps> = (props) => {
  const { theme } = useTheme()
  
  const positionStyles = () => {
    const pos = props.position ?? "bottom-right"
    const base = { position: "fixed" as const, "z-index": 2000 }
    switch (pos) {
      case "top-right": return { ...base, top: theme().spacing.lg, right: theme().spacing.lg }
      case "top-left": return { ...base, top: theme().spacing.lg, left: theme().spacing.lg }
      case "bottom-left": return { ...base, bottom: theme().spacing.lg, left: theme().spacing.lg }
      default: return { ...base, bottom: theme().spacing.lg, right: theme().spacing.lg }
    }
  }
  
  return (
    <Portal>
      <div
        class="toast-viewport"
        style={{
          ...positionStyles(),
          display: "flex",
          "flex-direction": "column",
          gap: theme().spacing.sm,
        }}
      >
        <For each={props.toasts}>
          {(toast) => (
            <Toast
              toast={toast}
              onDismiss={() => props.onDismiss?.(toast.id)}
            />
          )}
        </For>
      </div>
    </Portal>
  )
}
```

#### 5. Update package index
**File**: `packages/desktop-ui/src/index.ts`
**Location**: replace entire file

**After**:
```typescript
/**
 * @marvin-agents/desktop-ui
 * 
 * Web UI components for Marvin Desktop (Tauri)
 */

// Context
export { ThemeProvider, useTheme, themes, type Theme, type ThemeColors } from "./context/theme"

// Components - Core
export { Markdown, type MarkdownProps } from "./components/Markdown"
export { CodeBlock, type CodeBlockProps } from "./components/CodeBlock"
export { Editor, Input, type EditorProps, type EditorRef, type InputProps } from "./components/Editor"
export { Loader, type LoaderProps } from "./components/Loader"

// Components - Extended
export { Diff, type DiffProps, type DiffView } from "./components/Diff"
export { Dialog, type DialogProps } from "./components/Dialog"
export { SelectList, type SelectListProps, type SelectListRef, type SelectItem } from "./components/SelectList"
export { Toast, ToastViewport, type ToastItem, type ToastVariant, type ToastProps, type ToastViewportProps, type ToastPosition } from "./components/Toast"
```

### Edge Cases to Handle
- [ ] Empty SelectList → Show "No items" message
- [ ] SelectList filter matches nothing → Show "No items found"
- [ ] Dialog closed while animating → Clean up properly
- [ ] Toast auto-dismiss race condition → Clear timeout on unmount
- [ ] Diff with very long lines → Horizontal scroll

### Success Criteria

**Automated**:
```bash
cd packages/desktop-ui && bun run typecheck
```

**Manual**:
- [ ] Diff shows additions in green, removals in red
- [ ] Dialog has working overlay click-to-close
- [ ] SelectList navigates with arrow keys and j/k
- [ ] Toast auto-dismisses after 5 seconds

### Rollback
```bash
rm packages/desktop-ui/src/components/{Diff,Dialog,SelectList,Toast}.tsx
git restore packages/desktop-ui/src/index.ts
```

### Notes
_Space for implementer discoveries_

---

## Phase 5: Desktop App UI & Event Handler

### Overview
Implement the main desktop app UI: webview entry point, IPC client, event handler (ported from TUI), and compose all components into the main chat interface.

### Prerequisites
- [ ] Phase 2 complete (Tauri shell working)
- [ ] Phase 4 complete (all UI components)

### Change Checklist
- [ ] Create webview entry point (index.html, main.tsx)
- [ ] Implement IPC client for Tauri
- [ ] Port event handler from TUI (agent-events.ts)
- [ ] Create UI types (types.ts)
- [ ] Create main App component
- [ ] Create MessageList component
- [ ] Create InputArea component
- [ ] Create Header component
- [ ] Create ToolBlock component

### Changes

#### 1. Create HTML entry point
**File**: `apps/desktop/index.html`
**Location**: new file

**Add**:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Marvin</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html, body, #root {
        height: 100%;
        width: 100%;
        overflow: hidden;
      }
      body {
        font-family: system-ui, -apple-system, sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

#### 2. Create main.tsx entry point
**File**: `apps/desktop/src/main.tsx`
**Location**: new file

**Add**:
```typescript
/* @refresh reload */
import { render } from "solid-js/web"
import { ThemeProvider } from "@marvin-agents/desktop-ui"
import { App } from "./App"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

render(
  () => (
    <ThemeProvider initial="dark">
      <App />
    </ThemeProvider>
  ),
  root
)
```

#### 3. Create IPC client
**File**: `apps/desktop/src/ipc/client.ts`
**Location**: new file

**Add**:
```typescript
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type {
  IPCRequest,
  IPCResponse,
  IPCMethod,
  IPCMethodParams,
  IPCMethodResult,
  IPCEventData,
  IPCEventType,
} from "./protocol"

// Request ID counter
let requestId = 0

// Pending requests waiting for response
const pending = new Map<number, {
  resolve: (result: any) => void
  reject: (error: Error) => void
}>()

// Event listeners
const eventListeners = new Map<string, Set<(data: any) => void>>()

// Initialize response listener
let responseListenerReady = false
const initResponseListener = async () => {
  if (responseListenerReady) return
  responseListenerReady = true
  
  await listen<IPCResponse>("sidecar:response", (event) => {
    const response = event.payload
    const p = pending.get(response.id)
    if (p) {
      pending.delete(response.id)
      if (response.error) {
        p.reject(new Error(response.error.message))
      } else {
        p.resolve(response.result)
      }
    }
  })
}

/**
 * Call a sidecar method and wait for response
 */
export async function call<M extends IPCMethod>(
  method: M,
  params: IPCMethodParams[M]
): Promise<IPCMethodResult[M]> {
  await initResponseListener()
  
  const id = ++requestId
  const request: IPCRequest<M> = { id, method, params }
  
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    
    invoke("send_to_sidecar", { request })
      .catch((err) => {
        pending.delete(id)
        reject(new Error(`IPC invoke failed: ${err}`))
      })
  })
}

/**
 * Subscribe to sidecar events
 */
export function subscribe<T extends IPCEventType>(
  eventType: T,
  handler: (data: IPCEventData[T]) => void
): () => void {
  const eventName = `sidecar:${eventType}`
  
  if (!eventListeners.has(eventName)) {
    eventListeners.set(eventName, new Set())
    
    // Set up Tauri listener
    listen(eventName, (event) => {
      const listeners = eventListeners.get(eventName)
      listeners?.forEach((fn) => fn(event.payload))
    })
  }
  
  const listeners = eventListeners.get(eventName)!
  listeners.add(handler)
  
  return () => {
    listeners.delete(handler)
  }
}

/**
 * Check sidecar status
 */
export async function isAlive(): Promise<boolean> {
  return invoke<boolean>("sidecar_status")
}

/**
 * Restart sidecar process
 */
export async function restart(): Promise<void> {
  await invoke("restart_sidecar")
}
```

#### 4. Create UI types
**File**: `apps/desktop/src/types.ts`
**Location**: new file

**Add**:
```typescript
/**
 * UI types for desktop app
 * Mirrors TUI types but without terminal-specific rendering
 */

export type UIContentBlock =
  | { type: "thinking"; id: string; summary: string; full: string }
  | { type: "text"; text: string }
  | { type: "tool"; tool: ToolBlock }

export interface UIUserMessage {
  id: string
  role: "user"
  content: string
  timestamp?: number
}

export interface UIAssistantMessage {
  id: string
  role: "assistant"
  content: string
  contentBlocks?: UIContentBlock[]
  thinking?: { summary: string; full: string }
  isStreaming?: boolean
  tools?: ToolBlock[]
  timestamp?: number
}

export type UIMessage = UIUserMessage | UIAssistantMessage

export interface ToolBlock {
  id: string
  name: string
  args: unknown
  updateSeq?: number
  output?: string
  editDiff?: string
  isError: boolean
  isComplete: boolean
  result?: ToolResult
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>
  details?: unknown
}

export type ActivityState = "idle" | "thinking" | "streaming" | "tool"
```

#### 5. Create event handler
**File**: `apps/desktop/src/agent-events.ts`
**Location**: new file

**Add**:
```typescript
/**
 * Agent event handler for desktop app
 * Ported from apps/coding-agent/src/agent-events.ts
 */

import type { Setter } from "solid-js"
import type { AgentEvent } from "@marvin-agents/agent-core"
import type { UIMessage, UIAssistantMessage, ToolBlock, ActivityState } from "./types"

export interface EventHandlerContext {
  setMessages: Setter<UIMessage[]>
  setToolBlocks: Setter<ToolBlock[]>
  setActivityState: Setter<ActivityState>
  setIsResponding: Setter<boolean>
  setContextTokens: Setter<number>
}

// Helper to generate unique IDs
const generateId = () => crypto.randomUUID()

// Helper to append with cap
const appendWithCap = <T>(arr: T[], item: T, maxLength = 100): T[] => {
  const next = [...arr, item]
  return next.length > maxLength ? next.slice(-maxLength) : next
}

export function createAgentEventHandler(ctx: EventHandlerContext) {
  let streamingMessageId: string | null = null
  let currentToolBlocks: ToolBlock[] = []
  
  return (event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        ctx.setIsResponding(true)
        ctx.setActivityState("thinking")
        currentToolBlocks = []
        ctx.setToolBlocks([])
        break
        
      case "agent_end":
        ctx.setIsResponding(false)
        ctx.setActivityState("idle")
        streamingMessageId = null
        break
        
      case "turn_start":
        ctx.setActivityState("thinking")
        break
        
      case "turn_end":
        // Update context tokens if available
        if (event.message && "usage" in event) {
          // ctx.setContextTokens(...)
        }
        break
        
      case "message_start": {
        const msg = event.message
        if (msg.role === "assistant") {
          const id = generateId()
          streamingMessageId = id
          
          const uiMessage: UIAssistantMessage = {
            id,
            role: "assistant",
            content: "",
            contentBlocks: [],
            tools: [],
            isStreaming: true,
            timestamp: Date.now(),
          }
          
          ctx.setMessages((prev) => appendWithCap(prev, uiMessage))
          ctx.setActivityState("streaming")
        }
        break
      }
        
      case "message_update": {
        if (!streamingMessageId) break
        
        const msg = event.message
        if (msg.role !== "assistant") break
        
        // Extract text content
        let textContent = ""
        for (const block of msg.content) {
          if (block.type === "text") {
            textContent += block.text
          }
        }
        
        ctx.setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMessageId && m.role === "assistant"
              ? { ...m, content: textContent, tools: [...currentToolBlocks] }
              : m
          )
        )
        break
      }
        
      case "message_end": {
        if (!streamingMessageId) break
        
        ctx.setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMessageId && m.role === "assistant"
              ? { ...m, isStreaming: false }
              : m
          )
        )
        break
      }
        
      case "tool_execution_start": {
        const tool: ToolBlock = {
          id: event.toolCallId,
          name: event.toolName,
          args: event.args,
          isError: false,
          isComplete: false,
        }
        
        currentToolBlocks = [...currentToolBlocks, tool]
        ctx.setToolBlocks([...currentToolBlocks])
        ctx.setActivityState("tool")
        
        // Also update in message
        ctx.setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMessageId && m.role === "assistant"
              ? { ...m, tools: [...currentToolBlocks] }
              : m
          )
        )
        break
      }
        
      case "tool_execution_update": {
        const idx = currentToolBlocks.findIndex((t) => t.id === event.toolCallId)
        if (idx === -1) break
        
        currentToolBlocks = currentToolBlocks.map((t, i) =>
          i === idx
            ? { ...t, updateSeq: (t.updateSeq ?? 0) + 1 }
            : t
        )
        ctx.setToolBlocks([...currentToolBlocks])
        break
      }
        
      case "tool_execution_end": {
        const idx = currentToolBlocks.findIndex((t) => t.id === event.toolCallId)
        if (idx === -1) break
        
        // Extract output from result
        let output = ""
        if (event.result?.content) {
          for (const block of event.result.content) {
            if (block.type === "text") {
              output += block.text
            }
          }
        }
        
        // Check for edit diff in details
        let editDiff: string | undefined
        if (event.result?.details?.diff) {
          editDiff = event.result.details.diff
        }
        
        currentToolBlocks = currentToolBlocks.map((t, i) =>
          i === idx
            ? {
                ...t,
                isComplete: true,
                isError: event.isError,
                output,
                editDiff,
                result: event.result,
              }
            : t
        )
        ctx.setToolBlocks([...currentToolBlocks])
        
        // Update in message
        ctx.setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMessageId && m.role === "assistant"
              ? { ...m, tools: [...currentToolBlocks] }
              : m
          )
        )
        
        ctx.setActivityState("streaming")        break
      }
    }
  }
}
```

#### 6. Create App component
**File**: `apps/desktop/src/App.tsx`
**Location**: new file

**Add**:
```typescript
import { createSignal, createEffect, onMount, onCleanup, batch } from "solid-js"
import { useTheme, ToastViewport, type ToastItem } from "@marvin-agents/desktop-ui"
import { call, subscribe } from "./ipc/client"
import { createAgentEventHandler } from "./agent-events"
import { Header } from "./components/Header"
import { MessageList } from "./components/MessageList"
import { InputArea } from "./components/InputArea"
import type { UIMessage, ToolBlock, ActivityState } from "./types"

export function App() {
  const { theme } = useTheme()
  
  // State
  const [messages, setMessages] = createSignal<UIMessage[]>([])
  const [toolBlocks, setToolBlocks] = createSignal<ToolBlock[]>([])
  const [activityState, setActivityState] = createSignal<ActivityState>("idle")
  const [isResponding, setIsResponding] = createSignal(false)
  const [contextTokens, setContextTokens] = createSignal(0)
  const [modelId, setModelId] = createSignal("")
  const [thinking, setThinking] = createSignal<string>("off")
  const [toasts, setToasts] = createSignal<ToastItem[]>([])
  const [initialized, setInitialized] = createSignal(false)
  
  // Toast helpers
  const addToast = (toast: Omit<ToastItem, "id">) => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { ...toast, id }])
  }
  
  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }
  
  // Initialize sidecar
  onMount(async () => {
    try {
      const cwd = await getCurrentDirectory()
      const result = await call("init", { cwd })
      
      setModelId(result.modelId)
      setThinking(result.thinking)
      setInitialized(true)
      
      // Subscribe to agent events
      const handler = createAgentEventHandler({
        setMessages,
        setToolBlocks,
        setActivityState,
        setIsResponding,
        setContextTokens,
      })
      
      const unsubAgent = subscribe("agent", handler)
      const unsubActivity = subscribe("activity", (data) => {
        setActivityState(data.state)
      })
      const unsubError = subscribe("error", (data) => {
        addToast({ title: "Error", message: data.message, variant: "error" })
      })
      
      onCleanup(() => {
        unsubAgent()
        unsubActivity()
        unsubError()
      })
    } catch (err) {
      addToast({
        title: "Initialization failed",
        message: err instanceof Error ? err.message : String(err),
        variant: "error",
        duration: 0,
      })
    }
  })
  
  // Handlers
  const handleSubmit = async (text: string) => {
    if (!text.trim() || isResponding()) return
    
    // Add user message immediately
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMessage])
    
    try {
      await call("prompt", { text })
    } catch (err) {
      addToast({
        title: "Failed to send message",
        message: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    }
  }
  
  const handleAbort = async () => {
    try {
      await call("abort", {})
    } catch (err) {
      console.error("Abort failed:", err)
    }
  }
  
  const handleModelCycle = async () => {
    try {
      const result = await call("model.cycle", {})
      setModelId(result.modelId)
      addToast({ title: "Model changed", message: result.modelId, variant: "info" })
    } catch (err) {
      addToast({ title: "Failed to cycle model", variant: "error" })
    }
  }
  
  const handleThinkingCycle = async () => {
    try {
      const result = await call("thinking.cycle", {})
      setThinking(result.thinking)
    } catch (err) {
      addToast({ title: "Failed to cycle thinking", variant: "error" })
    }
  }
  
  return (
    <div
      class="app"
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100vh",
        "background-color": theme().colors.bg,
        color: theme().colors.fg,
      }}
    >
      <Header
        modelId={modelId()}
        thinking={thinking()}
        activityState={activityState()}
        contextTokens={contextTokens()}
        onModelCycle={handleModelCycle}
        onThinkingCycle={handleThinkingCycle}
      />
      
      <MessageList
        messages={messages()}
        toolBlocks={toolBlocks()}
        isStreaming={isResponding()}
      />
      
      <InputArea
        onSubmit={handleSubmit}
        onAbort={handleAbort}
        disabled={!initialized()}
        isResponding={isResponding()}
      />
      
      <ToastViewport
        toasts={toasts()}
        position="bottom-right"
        onDismiss={removeToast}
      />
    </div>
  )
}

// Get current directory via Tauri
async function getCurrentDirectory(): Promise<string> {
  // For now, use a default. In production, get from Tauri or prompt user
  return process.cwd?.() ?? "/"
}
```

#### 7. Create Header component
**File**: `apps/desktop/src/components/Header.tsx`
**Location**: new file

**Add**:
```typescript
import { Show, type Component } from "solid-js"
import { useTheme, Loader } from "@marvin-agents/desktop-ui"
import type { ActivityState } from "../types"

export interface HeaderProps {
  modelId: string
  thinking: string
  activityState: ActivityState
  contextTokens: number
  onModelCycle: () => void
  onThinkingCycle: () => void
}

export const Header: Component<HeaderProps> = (props) => {
  const { theme } = useTheme()
  
  const activityLabel = () => {
    switch (props.activityState) {
      case "thinking": return "Thinking..."
      case "streaming": return "Responding..."
      case "tool": return "Running tool..."
      default: return ""
    }
  }
  
  return (
    <header
      style={{
        display: "flex",
        "justify-content": "space-between",
        "align-items": "center",
        padding: `${theme().spacing.sm} ${theme().spacing.md}`,
        "border-bottom": `1px solid ${theme().colors.border}`,
        "background-color": theme().colors.bgSubtle,
      }}
    >
      <div style={{ display: "flex", "align-items": "center", gap: theme().spacing.md }}>
        <button
          onClick={props.onModelCycle}
          style={{
            background: "none",
            border: `1px solid ${theme().colors.border}`,
            "border-radius": theme().radius.md,
            padding: `${theme().spacing.xs} ${theme().spacing.sm}`,
            color: theme().colors.fg,
            cursor: "pointer",
          }}
        >
          {props.modelId || "Select model"}
        </button>
        
        <button
          onClick={props.onThinkingCycle}
          style={{
            background: "none",
            border: `1px solid ${theme().colors.border}`,
            "border-radius": theme().radius.md,
            padding: `${theme().spacing.xs} ${theme().spacing.sm}`,
            color: theme().colors.fgSubtle,
            cursor: "pointer",
          }}
        >
          🧠 {props.thinking}
        </button>
      </div>
      
      <div style={{ display: "flex", "align-items": "center", gap: theme().spacing.md }}>
        <Show when={props.activityState !== "idle"}>
          <Loader size="sm" message={activityLabel()} />
        </Show>
        <span style={{ color: theme().colors.fgMuted, "font-size": theme().fontSize.sm }}>
          {props.contextTokens.toLocaleString()} tokens
        </span>
      </div>
    </header>
  )
}
```

_Additional components (MessageList, ToolBlock, InputArea) follow similar patterns as shown in the detailed code blocks above._

### Success Criteria

**Automated**:
```bash
cd apps/desktop && bun run typecheck
cd apps/desktop && bun run tauri dev
```

**Manual**:
- [ ] App shows header with model name
- [ ] Can type and submit messages
- [ ] Responses stream with markdown
- [ ] Tool blocks expand/collapse
- [ ] Escape aborts generation

### Rollback
```bash
rm -rf apps/desktop/src/{App.tsx,main.tsx,agent-events.ts,types.ts,components}
```

---

## Phase 6: Session Management & Config UI

### Overview
Add session picker, keyboard shortcuts, and optional settings dialog.

### Prerequisites
- [ ] Phase 5 complete

### Change Checklist
- [ ] SessionPicker component with SelectList + Dialog
- [ ] Global keyboard shortcuts
- [ ] Session indicator in header
- [ ] Settings dialog (optional)

### Success Criteria
- [ ] Ctrl+R opens session picker
- [ ] Sessions persist across restarts

---

## Phase 7: Build Pipeline & Distribution

### Overview
Production builds and distribution setup.

### Prerequisites
- [ ] Phase 6 complete

### Change Checklist
- [ ] Multi-platform sidecar builds
- [ ] GitHub Actions release workflow
- [ ] App icons and metadata
- [ ] Platform-specific installers

### Success Criteria
- [ ] macOS .dmg works
- [ ] Windows .msi works
- [ ] Linux .AppImage works

---

## Testing Strategy

### Unit Tests
- Component rendering tests with `@solidjs/testing-library`
- IPC protocol mock tests

### Integration Tests
- Full app flow with mocked sidecar
- Session persistence verification

### Manual Testing Checklist
1. Fresh install on clean machine
2. Basic prompt/response cycle
3. Tool execution (read, write, edit, bash)
4. Session persistence
5. Model/thinking cycling
6. Error recovery
7. Memory stability over time

---

## Open Questions (resolved)
- [x] IPC protocol → JSON-RPC over stdio
- [x] Session storage → Reuse SessionManager in sidecar
- [x] UI framework → SolidJS
- [ ] Cross-compilation → Build on each platform (defer)
- [ ] Code signing → Defer to production
- [ ] Auto-updates → Defer to Phase 8+

## References
- OpenCode desktop: `docs/opencode.md`
- TUI implementation: `apps/coding-agent/src/`
- Agent events: `packages/agent/src/types.ts:66-84`
- Tauri v2 docs: https://v2.tauri.app/

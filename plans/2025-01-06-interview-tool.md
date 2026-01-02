# Interview Tool Implementation Plan

## Plan Metadata
- Created: 2025-01-06
- Status: in-progress
- Owner: yesh
- Assumptions:
  - pi-interview-tool at `/tmp/pi-interview-tool` is the reference implementation
  - Bun runtime handles TypeScript and serves HTTP natively
  - Custom tools run in TUI mode by default (headless mode is explicit opt-in)

## Progress Tracking
- [x] Phase 1: Remove existing ask_user_question tool
- [x] Phase 2: Extend custom tool loader for directory-based tools
- [ ] Phase 3: Add `hasUI` to ToolAPI
- [ ] Phase 4: Create interview tool (port from pi-interview-tool)

## Overview
Replace the incomplete `ask_user_question` terminal dialog tool with a browser-based `interview` tool that opens a web form for gathering user responses. This provides a superior UX for complex multi-question flows with support for text input, single/multi-select, and image upload.

## Current State
- `ask_user_question` tool exists but is **not wired up** to the TUI
- Tool defined at `apps/coding-agent/src/tools/ask-user-question.ts`
- Dialog component at `apps/coding-agent/src/components/AskUserQuestionDialog.tsx`
- Reference in rendering at `apps/coding-agent/src/tui-open-rendering.tsx:229-232`
- Custom tool loader only supports flat `~/.config/marvin/tools/*.ts` files
- `ToolAPI` lacks `hasUI` flag to detect headless mode

### Key Discoveries
- **Loader constraint** (`apps/coding-agent/src/custom-tools/loader.ts:149-160`):
  ```typescript
  function discoverToolsInDir(dir: string): string[] {
    // Only finds *.ts files, not subdirectories
    const entries = readdirSync(dir, { withFileTypes: true })
    return entries
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith(".ts"))
      .map((e) => join(dir, e.name))
  }
  ```

- **ToolAPI interface** (`apps/coding-agent/src/custom-tools/types.ts:55-65`):
  ```typescript
  export interface ToolAPI {
    cwd: string
    exec: (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>
    send: (text: string) => void
    // Missing: hasUI boolean
  }
  ```

- **Adapter tracking** (`apps/coding-agent/src/runtime/factory.ts:18`):
  ```typescript
  export type AdapterKind = "tui" | "headless" | "acp"
  ```
  The adapter is passed to `createRuntime()` but not exposed to custom tools.

- **pi-interview-tool flow**: HTTP server on random port → browser opens → user fills form → POST submit → return responses

## Desired End State
- `ask_user_question` tool removed entirely
- Custom tool loader supports `tools/<name>/index.ts` directory pattern
- `ToolAPI` exposes `hasUI: boolean` based on adapter
- Interview tool at `~/.config/marvin/tools/interview/` with:
  - Browser-based form UI
  - Question types: single, multi, text, image
  - Image upload via file picker, drag-drop, paste, or path
  - Keyboard navigation (←→ questions, ↑↓ options, ⌘+Enter submit)
  - Session timeout with countdown
  - Auto-save to localStorage

### Verification
```bash
# Phase 1: Tool removed
rg "ask_user_question|AskUserQuestion" apps/coding-agent/src  # Should return nothing

# Phase 2: Loader supports directories
ls ~/.config/marvin/tools/interview/index.ts  # Should exist and be discovered

# Phase 3: hasUI available
# Test by adding console.log in a custom tool

# Phase 4: Interview tool works
marvin  # Then have agent call interview()
```

**Manual verification:**
- [ ] Agent can invoke `interview({ questions: "path/to/questions.json" })`
- [ ] Browser opens with form
- [ ] All question types work (single, multi, text, image)
- [ ] Submit returns structured responses to agent
- [ ] Cancel/timeout handled gracefully
- [ ] Headless mode returns error (not opens browser)

## Out of Scope
- Theme toggle hotkey in interview form (use dark theme only)
- Multiple built-in themes (just default dark)
- Per-question attachments on non-image questions (v2)
- localStorage persistence across sessions (nice-to-have, not critical)

## Breaking Changes
- `ask_user_question` tool removed - any agent prompts using it will fail
- No migration needed (tool wasn't functional)

## Dependency and Configuration Changes

### Additions
None - uses Node.js built-in `http` module

### Removals
None

### Configuration Changes
None

## Error Handling Strategy
- **Headless mode**: Return error immediately with message "Interview tool requires interactive mode"
- **Questions file not found**: Throw with path in message
- **Invalid questions JSON**: Throw with validation error details
- **Browser open fails**: Throw with platform-specific guidance
- **Server start fails**: Throw with port binding error
- **Timeout**: Return `{ status: "timeout", responses: [] }`
- **User cancel**: Return `{ status: "cancelled", responses: [] }`
- **Image validation fails**: Return field-level error in form, don't crash

## Implementation Approach
Port pi-interview-tool's architecture to marvin's custom tool system:
1. HTTP server serves form assets from tool directory
2. Browser opens via `exec("open", [url])` (macOS) or `exec("xdg-open", [url])` (Linux)
3. Form JavaScript handles UX (keyboard nav, image upload, auto-save)
4. POST /submit returns responses, POST /cancel handles abort
5. Tool waits on Promise that resolves when server receives submit/cancel/timeout

**Why this approach:**
- Browser UI handles complex forms better than terminal
- Image paste/drag-drop is natural in browser
- Users can take time without blocking terminal
- Proven UX from pi-interview-tool

**Alternatives rejected:**
- Terminal-only dialog: Too limited for images and complex flows
- Electron app: Too heavy, unnecessary dependency
- External web service: Security/privacy concerns, requires network

## Phase Dependencies and Parallelization
- Dependencies: Phase 2→3→4 are sequential (each builds on previous)
- Phase 1 can run in parallel with Phase 2
- Not parallelizable further (changes are interdependent)

---

## Phase 1: Remove existing ask_user_question tool

### Overview
Delete the incomplete ask_user_question implementation to avoid confusion and conflicts with the new interview tool.

### Prerequisites
- [ ] Confirm tool is not wired up (no functional loss)

### Change Checklist
- [ ] Delete `apps/coding-agent/src/tools/ask-user-question.ts`
- [ ] Delete `apps/coding-agent/src/components/AskUserQuestionDialog.tsx`
- [ ] Remove case from `tui-open-rendering.tsx`

### Changes

#### 1. Delete tool file
**File**: `apps/coding-agent/src/tools/ask-user-question.ts`
**Action**: Delete entire file

#### 2. Delete dialog component
**File**: `apps/coding-agent/src/components/AskUserQuestionDialog.tsx`
**Action**: Delete entire file

#### 3. Remove rendering case
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`
**Location**: lines 229-232

**Before**:
```typescript
		case "ask_user_question": {
			const count = Array.isArray(args?.questions) ? args.questions.length : 0
			return count ? `${count} question${count > 1 ? "s" : ""}` : ""
		}
```

**After**:
```typescript
		// ask_user_question removed - use interview custom tool
```

**Why**: Clean removal, comment documents the change for anyone looking at history

### Edge Cases to Handle
- None - straightforward deletion

### Success Criteria

**Automated**:
```bash
bun run typecheck          # Zero type errors
bun run test               # All tests pass
```

**Manual**:
- [ ] `rg "ask_user_question|AskUserQuestion" apps/coding-agent/src` returns no results

### Rollback
```bash
git restore -- apps/coding-agent/src/tools/ask-user-question.ts \
  apps/coding-agent/src/components/AskUserQuestionDialog.tsx \
  apps/coding-agent/src/tui-open-rendering.tsx
```

### Notes
[Space for implementer]

---

## Phase 2: Extend custom tool loader for directory-based tools

### Overview
Modify the tool discovery to also find `tools/<name>/index.ts` patterns, enabling tools with multiple files and assets.

### Prerequisites
- [ ] Phase 1 complete (or can proceed in parallel)

### Change Checklist
- [ ] Update `discoverToolsInDir()` to find directory-based tools
- [ ] Update module docstring

### Changes

#### 1. Update discoverToolsInDir function
**File**: `apps/coding-agent/src/custom-tools/loader.ts`
**Location**: lines 149-163

**Before**:
```typescript
/**
 * Discover tool files from a directory.
 * Returns all .ts files in the directory (non-recursive).
 */
function discoverToolsInDir(dir: string): string[] {
	if (!existsSync(dir)) {
		return []
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true })
		return entries
			.filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith(".ts"))
			.map((e) => join(dir, e.name))
	} catch {
		return []
	}
}
```

**After**:
```typescript
/**
 * Discover tool files from a directory.
 * Finds both:
 *   - tools/*.ts (single-file tools)
 *   - tools/<name>/index.ts (directory-based tools with assets)
 */
function discoverToolsInDir(dir: string): string[] {
	if (!existsSync(dir)) {
		return []
	}

	const paths: string[] = []

	try {
		const entries = readdirSync(dir, { withFileTypes: true })

		for (const entry of entries) {
			if (entry.isFile() || entry.isSymbolicLink()) {
				// Single-file tool: tools/name.ts
				if (entry.name.endsWith(".ts")) {
					paths.push(join(dir, entry.name))
				}
			} else if (entry.isDirectory()) {
				// Directory-based tool: tools/name/index.ts
				const indexPath = join(dir, entry.name, "index.ts")
				if (existsSync(indexPath)) {
					paths.push(indexPath)
				}
			}
		}
	} catch {
		// Ignore read errors
	}

	return paths
}
```

**Why**: Enables tools like `interview/` with multiple files while maintaining backward compatibility with single-file tools like `subagent.ts`

#### 2. Update module docstring
**File**: `apps/coding-agent/src/custom-tools/loader.ts`
**Location**: lines 1-6

**Before**:
```typescript
/**
 * Custom tool loader - discovers and loads TypeScript tool modules.
 *
 * Tools are loaded from ~/.config/marvin/tools/*.ts (non-recursive).
 * Uses Bun's native import() which handles TypeScript directly.
 */
```

**After**:
```typescript
/**
 * Custom tool loader - discovers and loads TypeScript tool modules.
 *
 * Tools are loaded from:
 *   - ~/.config/marvin/tools/*.ts (single-file tools)
 *   - ~/.config/marvin/tools/<name>/index.ts (directory-based tools)
 *
 * Uses Bun's native import() which handles TypeScript directly.
 */
```

### Edge Cases to Handle
- [ ] Directory exists but no index.ts: Skip silently (existing behavior for non-.ts files)
- [ ] Symlinked directory: Follow symlink, check for index.ts
- [ ] Empty directory: Skip silently

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Manual**:
```bash
# Create test directory tool
mkdir -p ~/.config/marvin/tools/test-dir
echo 'export default () => ({ name: "test_dir", description: "test", parameters: {}, execute: async () => ({ content: [{ type: "text", text: "ok" }] }) })' > ~/.config/marvin/tools/test-dir/index.ts

# Start marvin and verify tool loads
marvin --help  # Should not error

# Cleanup
rm -rf ~/.config/marvin/tools/test-dir
```

### Rollback
```bash
git restore -- apps/coding-agent/src/custom-tools/loader.ts
```

### Notes
[Space for implementer]

---

## Phase 3: Add `hasUI` to ToolAPI

### Overview
Expose the adapter kind to custom tools so they can detect headless mode and fail gracefully instead of trying to open a browser.

### Prerequisites
- [ ] Phase 2 complete

### Change Checklist
- [ ] Add `hasUI` to ToolAPI interface
- [ ] Pass adapter to loadExtensibility
- [ ] Pass adapter to loadCustomTools
- [ ] Construct ToolAPI with hasUI

### Changes

#### 1. Update ToolAPI interface
**File**: `apps/coding-agent/src/custom-tools/types.ts`
**Location**: lines 52-66

**Before**:
```typescript
/**
 * API provided to custom tool factories.
 */
export interface ToolAPI {
	/** Current working directory */
	cwd: string
	/** Execute a command */
	exec: (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>
	/** Send a message to the agent (queued as user input) */
	send: (text: string) => void
}
```

**After**:
```typescript
/**
 * API provided to custom tool factories.
 */
export interface ToolAPI {
	/** Current working directory */
	cwd: string
	/** Whether running in interactive mode (TUI). False for headless/ACP modes. */
	hasUI: boolean
	/** Execute a command */
	exec: (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>
	/** Send a message to the agent (queued as user input) */
	send: (text: string) => void
}
```

#### 2. Update ExtensibilityLoadOptions
**File**: `apps/coding-agent/src/runtime/extensibility/index.ts`
**Location**: lines 6-12

**Before**:
```typescript
export interface ExtensibilityLoadOptions {
	configDir: string
	cwd: string
	sendRef: SendRef
	builtinTools: AgentTool<any, any>[]
}
```

**After**:
```typescript
export interface ExtensibilityLoadOptions {
	configDir: string
	cwd: string
	sendRef: SendRef
	builtinTools: AgentTool<any, any>[]
	/** Whether running in interactive mode (TUI) */
	hasUI: boolean
}
```

#### 3. Pass hasUI to loadCustomTools
**File**: `apps/coding-agent/src/runtime/extensibility/index.ts`
**Location**: lines 22-27

**Before**:
```typescript
	const { tools: customTools, issues: toolIssues } = await loadCustomTools(
		options.configDir,
		options.cwd,
		getToolNames(options.builtinTools),
		options.sendRef,
	)
```

**After**:
```typescript
	const { tools: customTools, issues: toolIssues } = await loadCustomTools(
		options.configDir,
		options.cwd,
		getToolNames(options.builtinTools),
		options.sendRef,
		options.hasUI,
	)
```

#### 4. Update loadCustomTools signature
**File**: `apps/coding-agent/src/custom-tools/loader.ts`
**Location**: lines 165-175

**Before**:
```typescript
export async function loadCustomTools(
	configDir: string,
	cwd: string,
	builtInToolNames: string[],
	sendRef: SendRef,
): Promise<CustomToolsLoadResult> {
	const tools: LoadedCustomTool[] = []
	const issues: ValidationIssue[] = []
	const seenNames = new Set<string>(builtInToolNames)

	// Shared API object - all tools get the same instance
	const api: ToolAPI = {
		cwd,
		exec: (command: string, args: string[], options?: ExecOptions) => execCommand(command, args, cwd, options),
		send: (text: string) => sendRef.current(text),
	}
```

**After**:
```typescript
export async function loadCustomTools(
	configDir: string,
	cwd: string,
	builtInToolNames: string[],
	sendRef: SendRef,
	hasUI: boolean,
): Promise<CustomToolsLoadResult> {
	const tools: LoadedCustomTool[] = []
	const issues: ValidationIssue[] = []
	const seenNames = new Set<string>(builtInToolNames)

	// Shared API object - all tools get the same instance
	const api: ToolAPI = {
		cwd,
		hasUI,
		exec: (command: string, args: string[], options?: ExecOptions) => execCommand(command, args, cwd, options),
		send: (text: string) => sendRef.current(text),
	}
```

#### 5. Update factory.ts to pass hasUI
**File**: `apps/coding-agent/src/runtime/factory.ts`
**Location**: lines 117-122

**Before**:
```typescript
	const extensibility = await loadExtensibility({
		configDir: loaded.configDir,
		cwd,
		sendRef,
		builtinTools: codingTools,
	})
```

**After**:
```typescript
	const extensibility = await loadExtensibility({
		configDir: loaded.configDir,
		cwd,
		sendRef,
		builtinTools: codingTools,
		hasUI: adapter === "tui",
	})
```

### Edge Cases to Handle
- [ ] ACP mode: hasUI = false (correct, no browser)
- [ ] Headless mode: hasUI = false (correct, no browser)
- [ ] TUI mode: hasUI = true (correct, can open browser)

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Manual**:
```bash
# Create test tool that checks hasUI
cat > ~/.config/marvin/tools/test-hasui.ts << 'EOF'
import type { ToolAPI } from "@marvin-agents/marvin";
export default (api: ToolAPI) => ({
  name: "test_hasui",
  description: "Test hasUI flag",
  parameters: {},
  execute: async () => ({
    content: [{ type: "text", text: `hasUI: ${api.hasUI}` }]
  })
});
EOF

# Test in TUI mode - should show hasUI: true
marvin
# > /test_hasui

# Test in headless mode - should show hasUI: false
echo "call test_hasui" | marvin --headless

# Cleanup
rm ~/.config/marvin/tools/test-hasui.ts
```

### Rollback
```bash
git restore -- apps/coding-agent/src/custom-tools/types.ts \
  apps/coding-agent/src/custom-tools/loader.ts \
  apps/coding-agent/src/runtime/extensibility/index.ts \
  apps/coding-agent/src/runtime/factory.ts
```

### Notes
[Space for implementer]

---

## Phase 4: Create interview tool

### Overview
Port pi-interview-tool to marvin's custom tool system at `~/.config/marvin/tools/interview/`.

### Prerequisites
- [ ] Phase 2 complete (directory-based tools work)
- [ ] Phase 3 complete (hasUI available)
- [ ] pi-interview-tool cloned to `/tmp/pi-interview-tool`

### Change Checklist
- [ ] Create `~/.config/marvin/tools/interview/` directory
- [ ] Create `index.ts` - tool factory and browser opening
- [ ] Create `server.ts` - HTTP server logic
- [ ] Create `schema.ts` - question validation
- [ ] Create `form/index.html` - form template
- [ ] Create `form/styles.css` - styling
- [ ] Create `form/script.js` - form logic
- [ ] Create example questions file

### Changes

#### 1. Create tool directory structure
```bash
mkdir -p ~/.config/marvin/tools/interview/form
```

#### 2. Create schema.ts
**File**: `~/.config/marvin/tools/interview/schema.ts`
**Action**: Create new file

```typescript
/**
 * Question schema validation for interview tool.
 * Ported from pi-interview-tool with minimal changes.
 */

export interface Question {
	id: string
	type: "single" | "multi" | "text" | "image"
	question: string
	options?: string[]
	recommended?: string | string[]
	context?: string
}

export interface QuestionsFile {
	title?: string
	description?: string
	questions: Question[]
}

function validateBasicStructure(data: unknown): QuestionsFile {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid questions file: must be an object")
	}

	const obj = data as Record<string, unknown>

	if (obj.title !== undefined && typeof obj.title !== "string") {
		throw new Error("Invalid questions file: title must be a string")
	}

	if (obj.description !== undefined && typeof obj.description !== "string") {
		throw new Error("Invalid questions file: description must be a string")
	}

	if (!Array.isArray(obj.questions) || obj.questions.length === 0) {
		throw new Error("Invalid questions file: questions must be a non-empty array")
	}

	const validTypes = ["single", "multi", "text", "image"]
	for (let i = 0; i < obj.questions.length; i++) {
		const q = obj.questions[i] as Record<string, unknown>
		if (!q || typeof q !== "object") {
			throw new Error(`Invalid question at index ${i}: must be an object`)
		}
		if (typeof q.id !== "string") {
			throw new Error(`Invalid question at index ${i}: id must be a string`)
		}
		if (typeof q.type !== "string" || !validTypes.includes(q.type)) {
			throw new Error(`Question "${q.id}": type must be one of: ${validTypes.join(", ")}`)
		}
		if (typeof q.question !== "string") {
			throw new Error(`Question "${q.id}": question text must be a string`)
		}
		if (q.options !== undefined) {
			if (!Array.isArray(q.options) || q.options.length === 0 || q.options.some((o: unknown) => typeof o !== "string")) {
				throw new Error(`Question "${q.id}": options must be a non-empty array of strings`)
			}
		}
		if (q.context !== undefined && typeof q.context !== "string") {
			throw new Error(`Question "${q.id}": context must be a string`)
		}
	}

	return obj as unknown as QuestionsFile
}

export function validateQuestions(data: unknown): QuestionsFile {
	const parsed = validateBasicStructure(data)

	const ids = new Set<string>()
	for (const q of parsed.questions) {
		if (ids.has(q.id)) {
			throw new Error(`Duplicate question id: "${q.id}"`)
		}
		ids.add(q.id)
	}

	for (const q of parsed.questions) {
		if (q.type === "single" || q.type === "multi") {
			if (!q.options || q.options.length === 0) {
				throw new Error(`Question "${q.id}": options required for type "${q.type}"`)
			}
		} else if (q.type === "text" || q.type === "image") {
			if (q.options) {
				throw new Error(`Question "${q.id}": options not allowed for type "${q.type}"`)
			}
		}

		if (q.recommended !== undefined) {
			if (q.type === "text" || q.type === "image") {
				throw new Error(`Question "${q.id}": recommended not allowed for type "${q.type}"`)
			}

			if (q.type === "single") {
				if (typeof q.recommended !== "string") {
					throw new Error(`Question "${q.id}": recommended must be string for single-select`)
				}
				if (!q.options?.includes(q.recommended)) {
					throw new Error(`Question "${q.id}": recommended "${q.recommended}" not in options`)
				}
			}

			if (q.type === "multi") {
				const recs = Array.isArray(q.recommended) ? q.recommended : [q.recommended]
				for (const rec of recs) {
					if (!q.options?.includes(rec)) {
						throw new Error(`Question "${q.id}": recommended "${rec}" not in options`)
					}
				}
			}
		}
	}

	return parsed
}
```

**Why**: Validates question format before starting server, provides clear error messages

#### 3. Create server.ts
**File**: `~/.config/marvin/tools/interview/server.ts`
**Action**: Create new file (ported from pi-interview-tool/server.ts)

```typescript
/**
 * HTTP server for interview form.
 * Ported from pi-interview-tool with adaptations for marvin's ToolAPI.
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { Question, QuestionsFile } from "./schema.js"

export interface ResponseItem {
	id: string
	value: string | string[]
	attachments?: string[]
}

export interface InterviewServerOptions {
	questions: QuestionsFile
	sessionToken: string
	sessionId: string
	timeout: number
	verbose?: boolean
}

export interface InterviewServerCallbacks {
	onSubmit: (responses: ResponseItem[]) => void
	onCancel: () => void
}

export interface InterviewServerHandle {
	server: http.Server
	url: string
	close: () => void
}

const MAX_BODY_SIZE = 15 * 1024 * 1024
const MAX_IMAGES = 12
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

const FORM_DIR = join(dirname(fileURLToPath(import.meta.url)), "form")
const TEMPLATE = readFileSync(join(FORM_DIR, "index.html"), "utf-8")
const STYLES = readFileSync(join(FORM_DIR, "styles.css"), "utf-8")
const SCRIPT = readFileSync(join(FORM_DIR, "script.js"), "utf-8")

class BodyTooLargeError extends Error {
	statusCode = 413
}

function log(verbose: boolean | undefined, message: string) {
	if (verbose) {
		process.stderr.write(`[interview] ${message}\n`)
	}
}

function safeInlineJSON(data: unknown): string {
	return JSON.stringify(data)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
}

function sendText(res: ServerResponse, status: number, text: string) {
	res.writeHead(status, {
		"Content-Type": "text/plain; charset=utf-8",
		"Cache-Control": "no-store",
	})
	res.end(text)
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
	})
	res.end(JSON.stringify(payload))
}

async function parseJSONBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let body = ""
		let size = 0

		req.on("data", (chunk: Buffer) => {
			size += chunk.length
			if (size > MAX_BODY_SIZE) {
				req.destroy()
				reject(new BodyTooLargeError("Request body too large"))
				return
			}
			body += chunk.toString()
		})

		req.on("end", () => {
			try {
				resolve(JSON.parse(body))
			} catch {
				reject(new Error("Invalid JSON"))
			}
		})

		req.on("error", reject)
	})
}

async function handleImageUpload(
	image: { id: string; filename: string; mimeType: string; data: string },
	sessionId: string
): Promise<string> {
	if (!ALLOWED_TYPES.includes(image.mimeType)) {
		throw new Error(`Invalid image type: ${image.mimeType}`)
	}

	const buffer = Buffer.from(image.data, "base64")
	if (buffer.length > MAX_IMAGE_SIZE) {
		throw new Error("Image exceeds 5MB limit")
	}

	const sanitized = image.filename.replace(/[^a-zA-Z0-9._-]/g, "_")
	const basename = sanitized.split(/[/\\]/).pop() || `image_${randomUUID()}`
	const extMap: Record<string, string> = {
		"image/png": ".png",
		"image/jpeg": ".jpg",
		"image/gif": ".gif",
		"image/webp": ".webp",
	}
	const ext = extMap[image.mimeType] ?? ""
	const filename = basename.includes(".") ? basename : `${basename}${ext}`

	const tempDir = join(tmpdir(), `marvin-interview-${sessionId}`)
	await mkdir(tempDir, { recursive: true })

	const filepath = join(tempDir, filename)
	await writeFile(filepath, buffer)

	return filepath
}

function validateTokenQuery(url: URL, expectedToken: string, res: ServerResponse): boolean {
	const token = url.searchParams.get("session")
	if (token !== expectedToken) {
		sendText(res, 403, "Invalid session")
		return false
	}
	return true
}

function validateTokenBody(body: unknown, expectedToken: string, res: ServerResponse): boolean {
	if (!body || typeof body !== "object") {
		sendJson(res, 400, { ok: false, error: "Invalid request body" })
		return false
	}
	const token = (body as { token?: string }).token
	if (token !== expectedToken) {
		sendJson(res, 403, { ok: false, error: "Invalid session" })
		return false
	}
	return true
}

function ensureQuestionId(
	id: string,
	questionById: Map<string, Question>
): { ok: true; question: Question } | { ok: false; error: string } {
	const question = questionById.get(id)
	if (!question) {
		return { ok: false, error: `Unknown question id: ${id}` }
	}
	return { ok: true, question }
}

export async function startInterviewServer(
	options: InterviewServerOptions,
	callbacks: InterviewServerCallbacks
): Promise<InterviewServerHandle> {
	const { questions, sessionToken, sessionId, timeout, verbose } = options
	const questionById = new Map<string, Question>()
	for (const question of questions.questions) {
		questionById.set(question.id, question)
	}

	const server = http.createServer(async (req, res) => {
		try {
			const method = req.method || "GET"
			const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`)
			log(verbose, `${method} ${url.pathname}`)

			if (method === "GET" && url.pathname === "/") {
				if (!validateTokenQuery(url, sessionToken, res)) return
				const inlineData = safeInlineJSON({
					questions: questions.questions,
					title: questions.title,
					description: questions.description,
					sessionToken,
					timeout,
				})
				const html = TEMPLATE
					.replace("/* __INTERVIEW_DATA_PLACEHOLDER__ */", inlineData)
					.replace(/__SESSION_TOKEN__/g, sessionToken)
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
				})
				res.end(html)
				return
			}

			if (method === "GET" && url.pathname === "/health") {
				if (!validateTokenQuery(url, sessionToken, res)) return
				sendJson(res, 200, { ok: true })
				return
			}

			if (method === "GET" && url.pathname === "/styles.css") {
				if (!validateTokenQuery(url, sessionToken, res)) return
				res.writeHead(200, {
					"Content-Type": "text/css; charset=utf-8",
					"Cache-Control": "no-store",
				})
				res.end(STYLES)
				return
			}

			if (method === "GET" && url.pathname === "/script.js") {
				if (!validateTokenQuery(url, sessionToken, res)) return
				res.writeHead(200, {
					"Content-Type": "application/javascript; charset=utf-8",
					"Cache-Control": "no-store",
				})
				res.end(SCRIPT)
				return
			}

			if (method === "POST" && url.pathname === "/cancel") {
				const body = await parseJSONBody(req).catch((err) => {
					if (err instanceof BodyTooLargeError) {
						sendJson(res, err.statusCode, { ok: false, error: err.message })
						return null
					}
					sendJson(res, 400, { ok: false, error: err.message })
					return null
				})
				if (!body) return
				if (!validateTokenBody(body, sessionToken, res)) return
				sendJson(res, 200, { ok: true })
				setImmediate(() => callbacks.onCancel())
				return
			}

			if (method === "POST" && url.pathname === "/submit") {
				const body = await parseJSONBody(req).catch((err) => {
					if (err instanceof BodyTooLargeError) {
						sendJson(res, err.statusCode, { ok: false, error: err.message })
						return null
					}
					sendJson(res, 400, { ok: false, error: err.message })
					return null
				})
				if (!body) return
				if (!validateTokenBody(body, sessionToken, res)) return

				const payload = body as {
					responses?: Array<{ id: string; value: string | string[]; attachments?: string[] }>
					images?: Array<{ id: string; filename: string; mimeType: string; data: string; isAttachment?: boolean }>
				}

				const responsesInput = Array.isArray(payload.responses) ? payload.responses : []
				const imagesInput = Array.isArray(payload.images) ? payload.images : []

				if (imagesInput.length > MAX_IMAGES) {
					sendJson(res, 400, { ok: false, error: `Too many images (max ${MAX_IMAGES})` })
					return
				}

				const responses: ResponseItem[] = []
				for (const item of responsesInput) {
					if (!item || typeof item.id !== "string") continue
					const questionCheck = ensureQuestionId(item.id, questionById)
					if (questionCheck.ok === false) {
						sendJson(res, 400, { ok: false, error: questionCheck.error, field: item.id })
						return
					}
					const question = questionCheck.question

					const resp: ResponseItem = { id: item.id, value: "" }

					if (question.type === "image") {
						if (Array.isArray(item.value) && item.value.every((v) => typeof v === "string")) {
							resp.value = item.value
						}
					} else if (question.type === "multi") {
						if (!Array.isArray(item.value) || item.value.some((v) => typeof v !== "string")) {
							sendJson(res, 400, {
								ok: false,
								error: `Invalid response value for ${item.id}`,
								field: item.id,
							})
							return
						}
						resp.value = item.value
					} else {
						if (typeof item.value !== "string") {
							sendJson(res, 400, {
								ok: false,
								error: `Invalid response value for ${item.id}`,
								field: item.id,
							})
							return
						}
						resp.value = item.value
					}

					if (Array.isArray(item.attachments) && item.attachments.every((a) => typeof a === "string")) {
						resp.attachments = item.attachments
					}

					responses.push(resp)
				}

				for (const image of imagesInput) {
					if (!image || typeof image.id !== "string") continue
					const questionCheck = ensureQuestionId(image.id, questionById)
					if (questionCheck.ok === false) {
						sendJson(res, 400, { ok: false, error: questionCheck.error, field: image.id })
						return
					}

					if (
						typeof image.filename !== "string" ||
						typeof image.mimeType !== "string" ||
						typeof image.data !== "string"
					) {
						sendJson(res, 400, { ok: false, error: "Invalid image payload", field: image.id })
						return
					}

					try {
						const filepath = await handleImageUpload(image, sessionId)

						const existing = responses.find((r) => r.id === image.id)
						if (image.isAttachment) {
							if (existing) {
								existing.attachments = existing.attachments || []
								existing.attachments.push(filepath)
							} else {
								responses.push({ id: image.id, value: "", attachments: [filepath] })
							}
						} else {
							if (existing) {
								if (Array.isArray(existing.value)) {
									existing.value.push(filepath)
								} else if (existing.value === "") {
									existing.value = filepath
								} else {
									existing.value = [existing.value, filepath]
								}
							} else {
								responses.push({ id: image.id, value: filepath })
							}
						}
					} catch (err) {
						const message = err instanceof Error ? err.message : "Image upload failed"
						sendJson(res, 400, { ok: false, error: message, field: image.id })
						return
					}
				}

				sendJson(res, 200, { ok: true })
				setImmediate(() => callbacks.onSubmit(responses))
				return
			}

			sendText(res, 404, "Not found")
		} catch (err) {
			const message = err instanceof Error ? err.message : "Server error"
			sendJson(res, 500, { ok: false, error: message })
		}
	})

	return new Promise((resolve, reject) => {
		const onError = (err: Error) => {
			reject(new Error(`Failed to start server: ${err.message}`))
		}

		server.once("error", onError)
		server.listen(0, "127.0.0.1", () => {
			server.off("error", onError)
			const addr = server.address()
			if (!addr || typeof addr === "string") {
				reject(new Error("Failed to start server: invalid address"))
				return
			}
			const url = `http://localhost:${addr.port}/?session=${sessionToken}`
			resolve({
				server,
				url,
				close: () => {
					try {
						server.close()
					} catch {}
				},
			})
		})
	})
}
```

#### 4. Create index.ts
**File**: `~/.config/marvin/tools/interview/index.ts`
**Action**: Create new file

```typescript
/**
 * Interview Tool - Browser-based form for gathering user responses.
 *
 * Opens a web form in the user's browser for answering questions.
 * Supports single-select, multi-select, text input, and image upload.
 *
 * Usage:
 *   interview({ questions: "/path/to/questions.json" })
 *   interview({ questions: "/path/to/questions.json", timeout: 300 })
 */

import { Type } from "@sinclair/typebox"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { randomUUID } from "node:crypto"
import { startInterviewServer, type ResponseItem } from "./server.js"
import { validateQuestions, type QuestionsFile } from "./schema.js"

// Import ToolAPI type for type checking
interface ToolAPI {
	cwd: string
	hasUI: boolean
	exec: (command: string, args: string[], options?: { timeout?: number; signal?: AbortSignal }) => Promise<{
		stdout: string
		stderr: string
		code: number
		killed: boolean
	}>
	send: (text: string) => void
}

interface InterviewDetails {
	status: "completed" | "cancelled" | "timeout" | "aborted"
	responses: ResponseItem[]
	url: string
}

const InterviewParams = Type.Object({
	questions: Type.String({ description: "Path to questions JSON file" }),
	timeout: Type.Optional(
		Type.Number({ description: "Seconds before auto-timeout (default: 600)", default: 600 })
	),
	verbose: Type.Optional(Type.Boolean({ description: "Enable debug logging", default: false })),
})

async function openUrl(api: ToolAPI, url: string): Promise<void> {
	const platform = os.platform()
	let result
	if (platform === "darwin") {
		result = await api.exec("open", [url])
	} else if (platform === "win32") {
		result = await api.exec("cmd", ["/c", "start", "", url])
	} else {
		result = await api.exec("xdg-open", [url])
	}
	if (result.code !== 0) {
		throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`)
	}
}

function loadQuestions(questionsPath: string, cwd: string): QuestionsFile {
	const absolutePath = path.isAbsolute(questionsPath)
		? questionsPath
		: path.join(cwd, questionsPath)

	if (!fs.existsSync(absolutePath)) {
		throw new Error(`Questions file not found: ${absolutePath}`)
	}

	let data: unknown
	try {
		const content = fs.readFileSync(absolutePath, "utf-8")
		data = JSON.parse(content)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		throw new Error(`Invalid JSON in questions file: ${message}`)
	}

	return validateQuestions(data)
}

function formatResponses(responses: ResponseItem[]): string {
	if (responses.length === 0) return "(none)"
	return responses
		.map((resp) => {
			const value = Array.isArray(resp.value) ? resp.value.join(", ") : resp.value
			let line = `- ${resp.id}: ${value}`
			if (resp.attachments && resp.attachments.length > 0) {
				line += ` [attachments: ${resp.attachments.join(", ")}]`
			}
			return line
		})
		.join("\n")
}

const factory = (api: ToolAPI) => {
	return {
		name: "interview",
		label: "Interview",
		description:
			"Present an interactive form in the browser to gather user responses. " +
			"Supports single-select, multi-select, text input, and image upload questions. " +
			"Image responses are returned as file paths - use the read tool to display them.",
		parameters: InterviewParams,

		async execute(
			_toolCallId: string,
			params: { questions: string; timeout?: number; verbose?: boolean },
			signal?: AbortSignal
		) {
			const { questions, timeout = 600, verbose } = params

			if (!api.hasUI) {
				throw new Error(
					"Interview tool requires interactive mode. " +
					"Cannot run in headless mode."
				)
			}

			const questionsData = loadQuestions(questions, api.cwd)

			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Interview was aborted." }],
					details: { status: "aborted", url: "", responses: [] } as InterviewDetails,
				}
			}

			const sessionId = randomUUID()
			const sessionToken = randomUUID()
			let server: { close: () => void } | null = null
			let timeoutId: ReturnType<typeof setTimeout> | null = null
			let resolved = false
			let url = ""

			const cleanup = () => {
				if (timeoutId) {
					clearTimeout(timeoutId)
					timeoutId = null
				}
				if (server) {
					server.close()
					server = null
				}
			}

			return new Promise((resolve, reject) => {
				const finish = (status: InterviewDetails["status"], responses: ResponseItem[] = []) => {
					if (resolved) return
					resolved = true
					cleanup()

					let text = ""
					if (status === "completed") {
						text = `User completed the interview form.\n\nResponses:\n${formatResponses(responses)}`
					} else if (status === "cancelled") {
						text = "User cancelled the interview form."
					} else if (status === "timeout") {
						text = `Interview form timed out after ${timeout} seconds.`
					} else {
						text = "Interview was aborted."
					}

					resolve({
						content: [{ type: "text", text }],
						details: { status, url, responses } as InterviewDetails,
					})
				}

				const handleAbort = () => finish("aborted")
				signal?.addEventListener("abort", handleAbort, { once: true })

				startInterviewServer(
					{
						questions: questionsData,
						sessionToken,
						sessionId,
						timeout,
						verbose,
					},
					{
						onSubmit: (responses) => finish("completed", responses),
						onCancel: () => finish("cancelled"),
					}
				)
					.then(async (handle) => {
						server = handle
						url = handle.url

						try {
							await openUrl(api, url)
						} catch (err) {
							cleanup()
							const message = err instanceof Error ? err.message : String(err)
							reject(new Error(`Failed to open browser: ${message}`))
							return
						}

						if (timeout > 0) {
							const timeoutMs = timeout * 1000
							timeoutId = setTimeout(() => finish("timeout"), timeoutMs)
						}
					})
					.catch((err) => {
						cleanup()
						reject(err)
					})
			})
		},
	}
}

export default factory
```

#### 5. Create form/index.html
**File**: `~/.config/marvin/tools/interview/form/index.html`
**Action**: Create new file (simplified from pi-interview-tool)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interview</title>
  <link rel="stylesheet" href="/styles.css?session=__SESSION_TOKEN__">
</head>
<body>
  <main class="interview-container">
    <header class="interview-header">
      <h1 id="form-title"></h1>
      <p id="form-description"></p>
    </header>

    <form id="interview-form" novalidate>
      <div id="questions-container" role="list"></div>

      <div id="error-container" aria-live="polite" class="error-message hidden"></div>

      <footer class="form-footer">
        <button type="submit" id="submit-btn" class="btn-primary">Submit</button>
      </footer>
    </form>

    <nav class="shortcuts-bar" aria-label="Keyboard shortcuts">
      <div class="shortcut">
        <span class="shortcut-keys"><kbd>↑</kbd><kbd>↓</kbd> <kbd>Tab</kbd></span>
        <span class="shortcut-label">Options</span>
      </div>
      <div class="shortcut">
        <span class="shortcut-keys"><kbd>←</kbd><kbd>→</kbd></span>
        <span class="shortcut-label">Questions</span>
      </div>
      <div class="shortcut-divider"></div>
      <div class="shortcut">
        <span class="shortcut-keys"><kbd>Enter</kbd> <kbd>Space</kbd></span>
        <span class="shortcut-label">Select</span>
      </div>
      <div class="shortcut">
        <span class="shortcut-keys"><kbd class="mod-key">⌘</kbd><kbd>Enter</kbd></span>
        <span class="shortcut-label">Submit</span>
      </div>
      <div class="shortcut-divider"></div>
      <div class="shortcut">
        <span class="shortcut-keys"><kbd>Esc</kbd></span>
        <span class="shortcut-label">Cancel</span>
      </div>
      <div class="shortcut-divider"></div>
      <div class="shortcut recommended-hint">
        <span class="shortcut-keys"><span class="star">*</span></span>
        <span class="shortcut-label">Recommended</span>
      </div>
    </nav>

    <div id="success-overlay" class="success-overlay hidden" aria-live="polite">
      <div class="success-icon">OK</div>
      <p>Responses submitted</p>
    </div>

    <div id="countdown-badge" class="countdown-badge hidden" aria-live="polite">
      <svg class="countdown-ring" viewBox="0 0 36 36">
        <circle class="countdown-ring-bg" cx="18" cy="18" r="16" />
        <circle class="countdown-ring-progress" cx="18" cy="18" r="16" />
      </svg>
      <span class="countdown-value"></span>
    </div>

    <div id="expired-overlay" class="expired-overlay hidden" aria-live="polite">
      <div class="expired-content">
        <div class="expired-icon">!</div>
        <h2>Session Ended</h2>
        <p>The interview session has timed out.</p>
        <div class="expired-countdown">Closing in <span id="close-countdown">10</span>s</div>
        <div class="expired-actions">
          <button type="button" id="stay-btn" class="btn-primary">Stay Here</button>
          <button type="button" id="close-tab-btn" class="btn-secondary">Close Now</button>
        </div>
      </div>
    </div>
  </main>

  <script>
    window.__INTERVIEW_DATA__ = /* __INTERVIEW_DATA_PLACEHOLDER__ */;
  </script>
  <script src="/script.js?session=__SESSION_TOKEN__"></script>
</body>
</html>
```

#### 6. Create form/styles.css
**File**: `~/.config/marvin/tools/interview/form/styles.css`
**Action**: Copy from `/tmp/pi-interview-tool/form/styles.css` (dark theme only)

```bash
cp /tmp/pi-interview-tool/form/styles.css ~/.config/marvin/tools/interview/form/styles.css
```

#### 7. Create form/script.js
**File**: `~/.config/marvin/tools/interview/form/script.js`
**Action**: Copy from `/tmp/pi-interview-tool/form/script.js` (theme toggle logic can be removed but not required)

```bash
cp /tmp/pi-interview-tool/form/script.js ~/.config/marvin/tools/interview/form/script.js
```

#### 8. Create example questions file
**File**: `~/.config/marvin/tools/interview/example-questions.json`
**Action**: Create new file

```json
{
  "title": "Project Setup",
  "description": "Help me understand your requirements.",
  "questions": [
    {
      "id": "framework",
      "type": "single",
      "question": "Which framework should we use?",
      "options": ["React", "Vue", "Svelte", "Other"],
      "recommended": "React",
      "context": "React has the largest ecosystem."
    },
    {
      "id": "features",
      "type": "multi",
      "question": "Which features do you need?",
      "options": ["Authentication", "Database", "API routes", "File uploads"],
      "recommended": ["Authentication", "Database"],
      "context": "Select all that apply."
    },
    {
      "id": "notes",
      "type": "text",
      "question": "Any additional requirements?"
    },
    {
      "id": "mockup",
      "type": "image",
      "question": "Upload a design mockup (optional)",
      "context": "PNG, JPG, GIF, or WebP. Max 5MB."
    }
  ]
}
```

### Edge Cases to Handle
- [ ] Questions file not found: Clear error with path
- [ ] Invalid JSON: Parse error with details
- [ ] Headless mode: Immediate error, no browser attempt
- [ ] Browser open fails: Platform-specific error guidance
- [ ] User closes browser tab: Timeout eventually fires
- [ ] Image too large: Form shows error, doesn't crash
- [ ] AbortSignal: Clean shutdown, return aborted status

### Success Criteria

**Automated**:
```bash
# Syntax check TypeScript files
cd ~/.config/marvin/tools/interview
bun run --bun tsc --noEmit index.ts server.ts schema.ts 2>/dev/null || echo "No tsconfig, testing via import"

# Test import works
bun -e "import f from '$HOME/.config/marvin/tools/interview/index.ts'; console.log('OK:', typeof f)"
```

**Manual**:
1. [ ] Start marvin: `marvin`
2. [ ] Ask agent to "interview me about project setup using ~/.config/marvin/tools/interview/example-questions.json"
3. [ ] Browser opens with form
4. [ ] Navigate questions with ←→
5. [ ] Select options with ↑↓ and Enter
6. [ ] Enter text in text question
7. [ ] Upload or paste image in image question
8. [ ] Submit with ⌘+Enter
9. [ ] Agent receives structured responses
10. [ ] Test cancel with Esc×2
11. [ ] Test timeout countdown appears

### Rollback
```bash
rm -rf ~/.config/marvin/tools/interview
```

### Notes
[Space for implementer]

---

## Testing Strategy

### Unit Tests to Add/Modify

No unit tests for custom tools in `~/.config/marvin/tools/` - they are user-space extensions.

### Integration Tests

Manual testing only for Phase 4 (custom tool).

For Phases 1-3 (marvin core changes):
```bash
bun run test  # Existing test suite should pass
```

### Manual Testing Checklist

1. [ ] Phase 1: `rg "ask_user_question" apps/coding-agent/src` returns nothing
2. [ ] Phase 2: Directory tool `~/.config/marvin/tools/test-dir/index.ts` loads
3. [ ] Phase 3: Custom tool can access `api.hasUI`
4. [ ] Phase 4: Full interview flow works (see Phase 4 success criteria)

## Deployment Instructions

Not applicable - local development tool.

### Build After Changes
```bash
cd apps/coding-agent && bun run build
```

## Anti-Patterns to Avoid
- Don't try to open browser in headless mode (check hasUI first)
- Don't block on form indefinitely (always have timeout)
- Don't trust session token from query params for POST (validate in body)
- Don't leave HTTP server running after tool completes (cleanup in finally)

## Open Questions (must resolve before implementation)
- [x] Keep existing ask_user_question? -> Answer: No, remove it
- [x] Support inline questions or file only? -> Answer: File only (like pi-interview)
- [x] Image handling? -> Answer: Return as file paths in /tmp

## References
- pi-interview-tool: `/tmp/pi-interview-tool/`
- Custom tool loader: `apps/coding-agent/src/custom-tools/loader.ts`
- ToolAPI types: `apps/coding-agent/src/custom-tools/types.ts`
- Runtime factory: `apps/coding-agent/src/runtime/factory.ts`
- Existing custom tool example: `~/.config/marvin/tools/subagent.ts`

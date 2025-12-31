# Edit File Review Implementation Plan

## Plan Metadata
- Created: 2025-01-21
- Status: draft
- Owner: yesh
- Assumptions:
  - User has `$EDITOR` or configured editor in marvin config
  - Edit tool results contain `args.path` with the file path
  - Mouse click events work in the TUI (already proven with other clickable elements)

## Progress Tracking
- [x] Phase 1: Add `openFileInEditor` function
- [x] Phase 2: Thread `onEditFile` callback through component hierarchy
- [x] Phase 3: Add `[e]` UI element to edit tool header
- [x] Phase 4: Implement `handleEditFile` in tui-app

## Overview
Add `[e]` button to completed edit tool results. Clicking opens the file in user's editor. On return, if file was modified, inject the diff to conversation context as a queued user message.

## Current State

### Key Discoveries

**Editor support exists** - `apps/coding-agent/src/editor.ts:29-50`
```typescript
export const openExternalEditor = async (opts: {
  editor: EditorConfig
  cwd: string
  renderer: CliRenderer
  initialValue: string
}): Promise<string | undefined> => {
  // Creates temp file, opens editor, returns content
}
```
This creates a temp file. We need a simpler function that opens an existing file.

**Edit tool rendering** - `apps/coding-agent/src/tui-open-rendering.tsx:424-448`
```typescript
edit: {
  mode: (ctx) => (ctx.expanded ? "block" : "inline"),
  renderHeader: (ctx) => {
    const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
    const diffStats = ctx.editDiff ? getDiffStats(ctx.editDiff) : null
    const suffix = ctx.isComplete && !ctx.isError && diffStats ? `+${diffStats.added}/-${diffStats.removed}` : undefined
    return <ToolHeader label="edit" detail={path} suffix={suffix} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
  },
  // ...
}
```
Need to add `[e]` after the ToolHeader when complete and not error.

**ToolRenderContext** - `apps/coding-agent/src/tui-open-rendering.tsx:285-295`
```typescript
interface ToolRenderContext {
  name: string
  args: any
  output: string | null
  editDiff: string | null
  result: ToolBlockProps["result"] | null
  isError: boolean
  isComplete: boolean
  expanded: boolean
  diffWrapMode: "word" | "none"
}
```
Need to add `onEditFile?: (path: string) => void` callback.

**MessageList props** - `apps/coding-agent/src/components/MessageList.tsx:265-275`
```typescript
export interface MessageListProps {
  messages: UIMessage[]
  toolBlocks: ToolBlock[]
  thinkingVisible: boolean
  diffWrapMode: "word" | "none"
  concealMarkdown?: boolean
  isToolExpanded: (id: string) => boolean
  toggleToolExpanded: (id: string) => void
  isThinkingExpanded: (id: string) => boolean
  toggleThinkingExpanded: (id: string) => void
}
```
Need to add `onEditFile` callback.

**Queue message pattern** - `apps/coding-agent/src/tui-app.tsx:502`
```typescript
void agent.queueMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
```
This is how we inject the modification feedback.

**diff package available** - `apps/coding-agent/package.json` has `"diff": "^8.0.2"` with `createPatch` function.

## Desired End State

After an edit tool completes successfully:
1. Tool header shows `[e]` button: `▸ edit src/utils.ts +5/-2 [e]`
2. Clicking `[e]` opens file in user's editor
3. On editor close, if file changed, diff is queued as user message
4. User can continue conversation with agent aware of modifications

### Verification
```bash
bun run typecheck        # No type errors
bun test                 # All tests pass
```

Manual:
- [ ] Edit tool completes, `[e]` visible in header
- [ ] Click `[e]`, editor opens with correct file
- [ ] Modify file, save, close editor
- [ ] Toast shows "Edit recorded"
- [ ] Next agent response sees the modification message

## Out of Scope
- Keyboard shortcut for `[e]` (mouse only for v1)
- Visual indicator after file was reviewed
- Support for write tool (edit only)
- "Always approve" or permission system
- Blocking confirmation modal

## Breaking Changes
None. New feature, all changes are additive.

## Dependency and Configuration Changes

### Additions
None - `diff` package already installed.

### Configuration Changes
None required. Uses existing editor config.

## Error Handling Strategy
- File read fails → show toast with error, abort
- Editor fails to open → show toast, abort
- File unchanged after edit → silent no-op (no injection)

## Implementation Approach
Thread an `onEditFile` callback from tui-app through MessageList to ToolBlock. The edit tool renderer checks for this callback and renders `[e]` when present and tool is complete. Click triggers the callback which handles the full flow: snapshot → editor → diff → queue.

## Phase Dependencies and Parallelization
- Dependencies: Phase 2 depends on Phase 1; Phase 3 depends on Phase 2; Phase 4 depends on Phase 3
- Not parallelizable - each phase builds on previous
- Single implementer recommended

---

## Phase 1: Add `openFileInEditor` function

### Overview
Add a simpler editor function that opens an existing file directly (no temp file).

### Prerequisites
- [ ] None

### Change Checklist
- [ ] Add `openFileInEditor` function to editor.ts

### Changes

#### 1. Add `openFileInEditor` function
**File**: `apps/coding-agent/src/editor.ts`
**Location**: After `openExternalEditor` (line 50), add new function

**After** (append to file):
```typescript
/**
 * Open an existing file in the user's editor.
 * Unlike openExternalEditor, this opens the file directly without creating a temp copy.
 */
export const openFileInEditor = async (opts: {
	editor: EditorConfig
	filePath: string
	cwd: string
	renderer: CliRenderer
}): Promise<void> => {
	const { command, args } = buildEditorInvocation(opts.editor, opts.cwd, { appendCwd: false })

	opts.renderer.suspend()
	opts.renderer.currentRenderBuffer.clear()

	try {
		await runEditor(command, [...args, opts.filePath], opts.cwd)
	} finally {
		opts.renderer.currentRenderBuffer.clear()
		opts.renderer.resume()
		opts.renderer.requestRender()
	}
}
```

**Why**: Existing `openExternalEditor` creates temp files for editing content. We need to open an actual file on disk so user modifications persist.

### Success Criteria

**Automated**:
```bash
bun run typecheck
```

**Manual**:
- [ ] Function compiles without errors

### Rollback
```bash
git restore -- apps/coding-agent/src/editor.ts
```

---

## Phase 2: Thread `onEditFile` callback through component hierarchy

### Overview
Add `onEditFile` prop to ToolBlockProps, ToolRenderContext, MessageListProps, and ToolBlockWrapper. Wire through from tui-app to the tool renderers.

### Prerequisites
- [ ] Phase 1 complete

### Change Checklist
- [ ] Add `onEditFile` to `ToolBlockProps` interface
- [ ] Add `onEditFile` to `ToolRenderContext` interface
- [ ] Pass `onEditFile` through `ToolBlock` component to context
- [ ] Add `onEditFile` to `MessageListProps` interface
- [ ] Pass `onEditFile` to `ToolBlockWrapper`
- [ ] Pass `onEditFile` to `ToolBlockComponent`

### Changes

#### 1. Add to ToolBlockProps
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`
**Location**: lines 264-280 (ToolBlockProps interface)

**Before**:
```typescript
export interface ToolBlockProps {
	name: string
	args: any
	output: string | null
	editDiff: string | null
	isError: boolean
	isComplete: boolean
	expanded?: boolean
	onToggleExpanded?: () => void
	diffWrapMode?: "word" | "none"
	// Custom tool metadata
	label?: string
	source?: "builtin" | "custom"
	sourcePath?: string
	result?: { content: any[]; details: any }
	renderCall?: (args: any, theme: Theme) => JSX.Element
	renderResult?: (result: any, opts: { expanded: boolean; isPartial: boolean }, theme: Theme) => JSX.Element
}
```

**After**:
```typescript
export interface ToolBlockProps {
	name: string
	args: any
	output: string | null
	editDiff: string | null
	isError: boolean
	isComplete: boolean
	expanded?: boolean
	onToggleExpanded?: () => void
	diffWrapMode?: "word" | "none"
	// Edit file callback - opens file in editor for user review
	onEditFile?: (path: string) => void
	// Custom tool metadata
	label?: string
	source?: "builtin" | "custom"
	sourcePath?: string
	result?: { content: any[]; details: any }
	renderCall?: (args: any, theme: Theme) => JSX.Element
	renderResult?: (result: any, opts: { expanded: boolean; isPartial: boolean }, theme: Theme) => JSX.Element
}
```

#### 2. Add to ToolRenderContext
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`
**Location**: lines 285-295 (ToolRenderContext interface)

**Before**:
```typescript
interface ToolRenderContext {
	name: string
	args: any
	output: string | null
	editDiff: string | null
	result: ToolBlockProps["result"] | null
	isError: boolean
	isComplete: boolean
	expanded: boolean
	diffWrapMode: "word" | "none"
}
```

**After**:
```typescript
interface ToolRenderContext {
	name: string
	args: any
	output: string | null
	editDiff: string | null
	result: ToolBlockProps["result"] | null
	isError: boolean
	isComplete: boolean
	expanded: boolean
	diffWrapMode: "word" | "none"
	onEditFile?: (path: string) => void
}
```

#### 3. Pass through ToolBlock component
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`
**Location**: lines 455-464 (inside ToolBlock function, ctx object)

**Before**:
```typescript
	const ctx: ToolRenderContext = {
		name: props.name,
		args: props.args,
		output: props.output,
		editDiff: props.editDiff,
		result: props.result ?? null,
		isError: props.isError,
		isComplete: props.isComplete,
		get expanded() { return props.expanded ?? false },
		get diffWrapMode() { return props.diffWrapMode ?? "word" },
	}
```

**After**:
```typescript
	const ctx: ToolRenderContext = {
		name: props.name,
		args: props.args,
		output: props.output,
		editDiff: props.editDiff,
		result: props.result ?? null,
		isError: props.isError,
		isComplete: props.isComplete,
		get expanded() { return props.expanded ?? false },
		get diffWrapMode() { return props.diffWrapMode ?? "word" },
		onEditFile: props.onEditFile,
	}
```

#### 4. Add to MessageListProps
**File**: `apps/coding-agent/src/components/MessageList.tsx`
**Location**: lines 265-275 (MessageListProps interface)

**Before**:
```typescript
export interface MessageListProps {
	messages: UIMessage[]
	toolBlocks: ToolBlock[]
	thinkingVisible: boolean
	diffWrapMode: "word" | "none"
	concealMarkdown?: boolean
	isToolExpanded: (id: string) => boolean
	toggleToolExpanded: (id: string) => void
	isThinkingExpanded: (id: string) => boolean
	toggleThinkingExpanded: (id: string) => void
}
```

**After**:
```typescript
export interface MessageListProps {
	messages: UIMessage[]
	toolBlocks: ToolBlock[]
	thinkingVisible: boolean
	diffWrapMode: "word" | "none"
	concealMarkdown?: boolean
	isToolExpanded: (id: string) => boolean
	toggleToolExpanded: (id: string) => void
	isThinkingExpanded: (id: string) => boolean
	toggleThinkingExpanded: (id: string) => void
	onEditFile?: (path: string) => void
}
```

#### 5. Update ToolBlockWrapper props
**File**: `apps/coding-agent/src/components/MessageList.tsx`
**Location**: lines 13-18 (ToolBlockWrapper function signature)

**Before**:
```typescript
function ToolBlockWrapper(props: {
	tool: ToolBlock
	isExpanded: (id: string) => boolean
	onToggle: (id: string) => void
	diffWrapMode: "word" | "none"
}) {
```

**After**:
```typescript
function ToolBlockWrapper(props: {
	tool: ToolBlock
	isExpanded: (id: string) => boolean
	onToggle: (id: string) => void
	diffWrapMode: "word" | "none"
	onEditFile?: (path: string) => void
}) {
```

#### 6. Pass onEditFile to ToolBlockComponent
**File**: `apps/coding-agent/src/components/MessageList.tsx`
**Location**: lines 21-40 (ToolBlockWrapper return statement)

**Before**:
```typescript
	return (
		<ToolBlockComponent
			name={props.tool.name}
			args={props.tool.args}
			output={props.tool.output || null}
			editDiff={props.tool.editDiff || null}
			isError={props.tool.isError}
			isComplete={props.tool.isComplete}
			expanded={expanded()}
			diffWrapMode={props.diffWrapMode}
			onToggleExpanded={() => props.onToggle(props.tool.id)}
			// Custom tool metadata for first-class rendering
			label={props.tool.label}
			source={props.tool.source}
			sourcePath={props.tool.sourcePath}
			result={props.tool.result}
			renderCall={props.tool.renderCall}
			renderResult={props.tool.renderResult}
		/>
	)
```

**After**:
```typescript
	return (
		<ToolBlockComponent
			name={props.tool.name}
			args={props.tool.args}
			output={props.tool.output || null}
			editDiff={props.tool.editDiff || null}
			isError={props.tool.isError}
			isComplete={props.tool.isComplete}
			expanded={expanded()}
			diffWrapMode={props.diffWrapMode}
			onToggleExpanded={() => props.onToggle(props.tool.id)}
			onEditFile={props.onEditFile}
			// Custom tool metadata for first-class rendering
			label={props.tool.label}
			source={props.tool.source}
			sourcePath={props.tool.sourcePath}
			result={props.tool.result}
			renderCall={props.tool.renderCall}
			renderResult={props.tool.renderResult}
		/>
	)
```

#### 7. Pass onEditFile in all ToolBlockWrapper usages
**File**: `apps/coding-agent/src/components/MessageList.tsx`
**Location**: line 327-332 (inside MessageList render)

**Before**:
```typescript
								<ToolBlockWrapper
									tool={toolItem().tool}
									isExpanded={props.isToolExpanded}
									onToggle={props.toggleToolExpanded}
									diffWrapMode={props.diffWrapMode}
								/>
```

**After**:
```typescript
								<ToolBlockWrapper
									tool={toolItem().tool}
									isExpanded={props.isToolExpanded}
									onToggle={props.toggleToolExpanded}
									diffWrapMode={props.diffWrapMode}
									onEditFile={props.onEditFile}
								/>
```

**Note**: Search for all `<ToolBlockWrapper` usages in the file and add `onEditFile={props.onEditFile}` to each.

### Success Criteria

**Automated**:
```bash
bun run typecheck
```

### Rollback
```bash
git restore -- apps/coding-agent/src/tui-open-rendering.tsx apps/coding-agent/src/components/MessageList.tsx
```

---

## Phase 3: Add `[e]` UI element to edit tool header

### Overview
Modify the edit tool renderer to show `[e]` button when tool is complete and callback is available.

### Prerequisites
- [ ] Phase 2 complete

### Change Checklist
- [ ] Update edit tool `renderHeader` to include clickable `[e]`

### Changes

#### 1. Update edit tool renderHeader
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`
**Location**: lines 424-431 (edit tool in registry)

**Before**:
```typescript
	edit: {
		mode: (ctx) => (ctx.expanded ? "block" : "inline"),
		renderHeader: (ctx) => {
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const diffStats = ctx.editDiff ? getDiffStats(ctx.editDiff) : null
			const suffix = ctx.isComplete && !ctx.isError && diffStats ? `+${diffStats.added}/-${diffStats.removed}` : undefined
			return <ToolHeader label="edit" detail={path} suffix={suffix} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
		},
```

**After**:
```typescript
	edit: {
		mode: (ctx) => (ctx.expanded ? "block" : "inline"),
		renderHeader: (ctx) => {
			const { theme } = useTheme()
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const fullPath = String(ctx.args?.path || ctx.args?.file_path || "")
			const diffStats = ctx.editDiff ? getDiffStats(ctx.editDiff) : null
			const suffix = ctx.isComplete && !ctx.isError && diffStats ? `+${diffStats.added}/-${diffStats.removed}` : undefined
			const showEditButton = ctx.isComplete && !ctx.isError && ctx.onEditFile && fullPath
			return (
				<box flexDirection="row">
					<ToolHeader label="edit" detail={path} suffix={suffix} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
					{showEditButton && (
						<text
							fg={theme.textMuted}
							onMouseUp={(e: { stopPropagation?: () => void }) => {
								e.stopPropagation?.()
								ctx.onEditFile?.(fullPath)
							}}
						>
							{" [e]"}
						</text>
					)}
				</box>
			)
		},
```

**Why**: Shows `[e]` only when edit is complete, successful, has a valid path, and callback is provided. Click triggers the callback with the file path.

### Success Criteria

**Automated**:
```bash
bun run typecheck
```

**Manual**:
- [ ] Edit tool completes, `[e]` visible after stats
- [ ] Hovering shows cursor change (if supported)

### Rollback
```bash
git restore -- apps/coding-agent/src/tui-open-rendering.tsx
```

---

## Phase 4: Implement `handleEditFile` in tui-app

### Overview
Implement the full flow: snapshot file, open editor, compare, inject diff if changed.

### Prerequisites
- [ ] Phase 3 complete

### Change Checklist
- [ ] Add diff import
- [ ] Add `handleEditFile` function
- [ ] Pass `onEditFile` to MessageList

### Changes

#### 1. Add diff import
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: Near top of file with other imports (around line 1-30)

**Add import**:
```typescript
import { createPatch } from "diff"
```

#### 2. Add handleEditFile function
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: Inside the `App` component, after other handler functions (around line 500-550, near `handleSubmit`)

**Add**:
```typescript
	const handleEditFile = async (filePath: string) => {
		// Don't allow while agent is responding
		if (isResponding()) return

		// Snapshot current content
		let beforeContent: string
		try {
			beforeContent = await Bun.file(filePath).text()
		} catch (err) {
			pushToast({ title: `Cannot read file: ${filePath}`, variant: "error" }, 3000)
			return
		}

		// Open editor
		try {
			await openFileInEditor({
				editor: config.editor,
				filePath,
				cwd: process.cwd(),
				renderer,
			})
		} catch (err) {
			pushToast({ title: `Editor failed: ${err instanceof Error ? err.message : String(err)}`, variant: "error" }, 3000)
			return
		}

		// Read after
		let afterContent: string
		try {
			afterContent = await Bun.file(filePath).text()
		} catch (err) {
			pushToast({ title: `Cannot read file after edit: ${filePath}`, variant: "error" }, 3000)
			return
		}

		// Compare - if unchanged, do nothing
		if (beforeContent === afterContent) {
			return
		}

		// Compute diff
		const diff = createPatch(filePath, beforeContent, afterContent)
		// Trim header lines, keep from first @@ onwards
		const lines = diff.split("\n")
		const hunkStart = lines.findIndex((l) => l.startsWith("@@"))
		const diffBody = hunkStart >= 0 ? lines.slice(hunkStart).join("\n") : diff

		// Queue message for next turn
		const message = `Modified ${filePath}:\n${diffBody}`
		void agent.queueMessage({
			role: "user",
			content: [{ type: "text", text: message }],
			timestamp: Date.now(),
		})

		pushToast({ title: "Edit recorded", variant: "success" }, 1500)
	}
```

**Why**: Full flow - read before, open editor, read after, compute diff, queue as user message. Toast feedback. Error handling at each step.

#### 3. Add openFileInEditor import
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: With other imports from editor.ts

**Before** (find existing import):
```typescript
import { openExternalEditor } from "./editor.js"
```

**After**:
```typescript
import { openExternalEditor, openFileInEditor } from "./editor.js"
```

#### 4. Pass onEditFile to MessageList
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: line 766-767 (MessageList usage in render)

**Before**:
```typescript
				<MessageList messages={props.messages} toolBlocks={props.toolBlocks} thinkingVisible={props.thinkingVisible} diffWrapMode={props.diffWrapMode} concealMarkdown={props.concealMarkdown}
					isToolExpanded={isToolExpanded} toggleToolExpanded={toggleToolExpanded} isThinkingExpanded={isThinkingExpanded} toggleThinkingExpanded={toggleThinkingExpanded} />
```

**After**:
```typescript
				<MessageList messages={props.messages} toolBlocks={props.toolBlocks} thinkingVisible={props.thinkingVisible} diffWrapMode={props.diffWrapMode} concealMarkdown={props.concealMarkdown}
					isToolExpanded={isToolExpanded} toggleToolExpanded={toggleToolExpanded} isThinkingExpanded={isThinkingExpanded} toggleThinkingExpanded={toggleThinkingExpanded} onEditFile={handleEditFile} />
```

### Edge Cases to Handle
- [ ] File doesn't exist: Show error toast, abort
- [ ] Editor fails to open: Show error toast, abort
- [ ] File unchanged: Silent no-op
- [ ] Agent responding: Ignore click (isResponding check)

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test
```

**Manual**:
- [ ] Run marvin, make agent edit a file
- [ ] Click `[e]` on completed edit tool
- [ ] Editor opens with correct file
- [ ] Modify content, save, close
- [ ] Toast shows "Edit recorded"
- [ ] Type "continue" or any message
- [ ] Agent response shows it received the modification info

### Rollback
```bash
git restore -- apps/coding-agent/src/tui-app.tsx
```

---

## Testing Strategy

### Manual Testing Checklist
1. [ ] Edit tool completes → `[e]` visible in header
2. [ ] Click `[e]` → editor opens with file
3. [ ] Close without changes → no toast, no injection
4. [ ] Make changes, save, close → "Edit recorded" toast
5. [ ] Submit next message → agent sees "Modified {path}:" in context
6. [ ] Click `[e]` while agent responding → nothing happens
7. [ ] File doesn't exist → error toast
8. [ ] Multiple edit tools → each has independent `[e]`

### Integration Test (optional, future)
```typescript
describe("edit file review", () => {
  it("injects diff when file modified", async () => {
    // Would require mocking editor and file system
  })
})
```

## Deployment Instructions
None - feature is self-contained, no migrations or flags needed.

## Anti-Patterns to Avoid
- Don't block UI during editor open (already handled by suspend/resume pattern)
- Don't inject message if file unchanged (silent no-op is correct)
- Don't show `[e]` on failed edits (isError check)

## Open Questions
- [x] Should we add keyboard shortcut? → No, mouse only for v1
- [x] Should we show indicator after review? → No, per user preference
- [x] What about write tool? → Out of scope, edit only

## References
- Existing editor implementation: `apps/coding-agent/src/editor.ts:29-50`
- Tool rendering pattern: `apps/coding-agent/src/tui-open-rendering.tsx:424-448`
- Queue message pattern: `apps/coding-agent/src/tui-app.tsx:502`
- OpenCode PR inspiration: https://github.com/sst/opencode/pull/6476

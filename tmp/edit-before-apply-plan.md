# Plan: "Edit Suggested Changes Before Applying" for Marvin

## Summary

Add the ability for users to review and optionally edit AI-suggested file changes before they're applied, similar to [opencode PR #6476](https://github.com/sst/opencode/pull/6476).

---

## What OpenCode PR Does

### Core Flow
1. When the `edit` tool proposes changes, execution **pauses** for user approval
2. User sees diff and can:
   - Press **Enter** → apply as-is
   - Press **a** → always approve this session
   - Press **d** → reject
   - Press **e** → open suggested content in `$EDITOR`, edit, then apply modified version
3. If user edits, a note is injected into tool output: *"The user modified this edit before accepting..."*

### Key Components Added

```
packages/opencode/src/permission/editor.ts   # Check if editable, get content/extension/line
packages/opencode/src/util/text.ts           # normalizeLineEndings, getFirstDifferingLine, hasChanges
packages/opencode/src/cli/cmd/tui/util/editor.ts  # Editor.Result type
```

### Permission System
- `Permission.ask()` now returns `AskResult<T>` with optional `modified` data
- New response type: `"modify"` alongside `"once" | "always" | "reject"`
- Edit tool receives modified content and uses it instead of original suggestion

---

## Marvin Current State

| Aspect | OpenCode | Marvin |
|--------|----------|--------|
| Permission system | ✅ Full `Permission.ask()` flow | ❌ None - tools execute immediately |
| External editor | ✅ `Editor.open()` | ✅ `openExternalEditor()` in `editor.ts` |
| Edit tool | Pauses for approval | Auto-applies |
| Tool rendering | Shows pending permission UI | Shows running/complete state |

### Marvin's Existing Editor Support
```typescript
// apps/coding-agent/src/editor.ts
export const openExternalEditor = async (opts: {
  editor: EditorConfig
  cwd: string
  renderer: CliRenderer
  initialValue: string
}): Promise<string | undefined>
```

---

## Implementation Options

### Option A: Full Permission System (Large)
- Add `packages/agent/src/permission.ts` module
- Modify agent loop to pause on permission-required tools
- Add permission state to TUI
- ~500+ lines, affects core agent loop

### Option B: Edit Preview Mode (Focused) ⭐ Recommended
- Add optional "confirmation mode" for edit tool only
- Show diff preview, wait for key
- Press `e` to edit before apply
- ~200-300 lines, minimal core changes

---

## Recommended Implementation (Option B)

### Phase 1: Tool Confirmation Hook

Add a hook system that allows tools to request user confirmation before execution completes.

```typescript
// packages/agent/src/types.ts - New types
interface ToolConfirmation {
  toolCallId: string
  toolName: string
  preview: {
    diff?: string
    path?: string
    originalContent?: string
    suggestedContent?: string
  }
  resolve: (result: 'apply' | 'reject' | { modified: string }) => void
}

// New event type
| { type: "tool_confirmation_required"; confirmation: ToolConfirmation }
```

### Phase 2: Edit Tool Modification

```typescript
// packages/base-tools/src/tools/edit.ts
export const editTool: AgentTool<typeof editSchema> = {
  // ...existing...
  confirmBeforeApply: true, // NEW: flag to enable confirmation
  
  execute: async (toolCallId, { path, oldText, newText }, signal, hooks) => {
    // Read file, compute diff
    const content = await readFile(absolutePath, "utf-8")
    const index = content.indexOf(oldText)
    const newContent = content.substring(0, index) + newText + content.substring(index + oldText.length)
    const diff = buildTargetedDiff(path, content, index, oldText, newText)
    
    // If confirmation mode enabled, pause and wait
    if (hooks?.requestConfirmation) {
      const result = await hooks.requestConfirmation({
        diff,
        path: absolutePath,
        originalContent: content,
        suggestedContent: newContent,
      })
      
      if (result === 'reject') {
        throw new Error('Edit rejected by user')
      }
      
      // User may have modified the content
      const finalContent = typeof result === 'object' ? result.modified : newContent
      await writeFile(absolutePath, finalContent, "utf-8")
      
      // Return with modification note if edited
      const wasModified = typeof result === 'object'
      return {
        content: [{
          type: "text",
          text: wasModified 
            ? `Successfully applied user-modified edit to ${path}. Note: The user modified your suggested changes before accepting.`
            : `Successfully replaced text in ${path}.`
        }],
        details: { 
          diff: wasModified ? computeNewDiff(content, finalContent) : diff,
          userModified: wasModified
        },
      }
    }
    
    // Original immediate-apply path
    await writeFile(absolutePath, newContent, "utf-8")
    return { content: [...], details: { diff } }
  }
}
```

### Phase 3: TUI Confirmation UI

```typescript
// apps/coding-agent/src/components/EditConfirmationOverlay.tsx
export function EditConfirmationOverlay(props: {
  confirmation: ToolConfirmation
  onRespond: (response: 'apply' | 'reject' | { modified: string }) => void
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  
  const handleEdit = async () => {
    const edited = await openExternalEditor({
      editor: config.editor,
      cwd: process.cwd(),
      renderer,
      initialValue: props.confirmation.preview.suggestedContent!,
      // NEW: extension for syntax highlighting
      extension: path.extname(props.confirmation.preview.path!),
    })
    
    if (edited && edited !== props.confirmation.preview.suggestedContent) {
      props.onRespond({ modified: edited })
    } else {
      // User closed without changes, treat as accept
      props.onRespond('apply')
    }
  }
  
  useKeyboard((e) => {
    if (e.name === 'return') props.onRespond('apply')
    if (e.name === 'escape' || e.name === 'd') props.onRespond('reject')
    if (e.name === 'e') handleEdit()
  })
  
  return (
    <box flexDirection="column" padding={1}>
      <text bold>Confirm Edit: {props.confirmation.preview.path}</text>
      <Diff diffText={props.confirmation.preview.diff!} filetype={...} />
      <box flexDirection="row" gap={2}>
        <text><b>Enter</b> apply</text>
        <text><b>e</b> edit</text>
        <text><b>d</b> reject</text>
      </box>
    </box>
  )
}
```

### Phase 4: Agent Event Handler Integration

```typescript
// apps/coding-agent/src/agent-events.ts
// Add confirmation state tracking

const [pendingConfirmation, setPendingConfirmation] = createSignal<ToolConfirmation | null>(null)

// In event loop, handle new event type:
case "tool_confirmation_required":
  setPendingConfirmation(event.confirmation)
  // Pause further processing until resolved
  break
```

### Phase 5: Configuration

```typescript
// apps/coding-agent/src/config.ts
interface AgentConfig {
  // ...existing...
  confirmEdits?: boolean  // Default: false for backwards compatibility
}
```

---

## File Changes Summary

| File | Change Type | Lines |
|------|-------------|-------|
| `packages/agent/src/types.ts` | Add types | +20 |
| `packages/base-tools/src/tools/edit.ts` | Add confirmation hook | +50 |
| `apps/coding-agent/src/editor.ts` | Add extension/line support | +15 |
| `apps/coding-agent/src/components/EditConfirmationOverlay.tsx` | New file | +80 |
| `apps/coding-agent/src/agent-events.ts` | Handle confirmation events | +30 |
| `apps/coding-agent/src/tui-app.tsx` | Wire up overlay | +40 |
| `apps/coding-agent/src/config.ts` | Add option | +5 |

**Estimated total: ~240 lines**

---

## Differences from OpenCode Approach

| Aspect | OpenCode | Marvin (Proposed) |
|--------|----------|-------------------|
| Scope | Full permission system for all tools | Edit tool only |
| Architecture | Separate permission module | Hook-based in tool execution |
| Default behavior | Always ask | Opt-in via config flag |
| Response types | once/always/reject/modify | apply/reject/modified |
| Session memory | Remembers "always" per pattern | Not implemented (keep simple) |

---

## Open Questions

1. **Should `write` tool also support this?** The opencode PR only handles edit. Write is similar.

2. **Default on or off?** Recommend off for backwards compatibility, user enables via config.

3. **"Always" approval?** Could add later, but keep initial implementation simple.

4. **Abort during edit?** If user is in editor when agent loop continues, need to handle.

---

## Implementation Order

1. **Add types** (`packages/agent/src/types.ts`)
2. **Extend editor** (`apps/coding-agent/src/editor.ts` - extension param)
3. **Add confirmation overlay** (new component)
4. **Modify edit tool** (add confirmBeforeApply flow)
5. **Wire into TUI** (agent-events + tui-app)
6. **Add config flag**
7. **Tests**

---

## Detailed Implementation

### Step 1: Add Tool Confirmation Types

```typescript
// packages/ai/src/agent/types.ts

/** Data passed to confirmation callback for edit operations */
export interface EditConfirmationRequest {
  path: string
  originalContent: string
  suggestedContent: string
  diff: string
}

/** Response from user after confirmation */
export type ConfirmationResponse = 
  | { action: "apply" }
  | { action: "reject"; reason?: string }
  | { action: "modify"; content: string }

/** Confirmation callback type - tools call this to pause for user input */
export type ConfirmationCallback = (
  request: EditConfirmationRequest
) => Promise<ConfirmationResponse>

/** Extended tool context with optional confirmation support */
export interface ToolExecutionContext {
  requestConfirmation?: ConfirmationCallback
}
```

### Step 2: Modify AgentTool execute signature

```typescript
// packages/ai/src/agent/types.ts

export interface AgentTool<T extends TSchema = any, D = unknown> {
  name: string
  label?: string
  description: string
  parameters: T
  
  // Updated signature with context
  execute: (
    toolCallId: string,
    args: Static<T>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: any) => void,
    context?: ToolExecutionContext  // NEW
  ) => Promise<AgentToolResult<D>>
  
  // NEW: Flag for tools that want confirmation
  requiresConfirmation?: boolean
}
```

### Step 3: Update agent-loop.ts

```typescript
// packages/ai/src/agent/agent-loop.ts

export interface AgentLoopConfig {
  // ...existing...
  
  // NEW: Callback for tools that need user confirmation
  requestConfirmation?: ConfirmationCallback
}

async function executeToolCalls<T>(
  tools: AgentTool<any, T>[] | undefined,
  assistantMessage: AssistantMessage,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, Message[]>,
  config: AgentLoopConfig,  // NEW param
): Promise<ToolResultMessage<T>[]> {
  // ...
  
  for (const toolCall of toolCalls) {
    // ...
    
    const context: ToolExecutionContext = {}
    if (tool.requiresConfirmation && config.requestConfirmation) {
      context.requestConfirmation = config.requestConfirmation
    }
    
    result = await tool.execute(
      toolCall.id, 
      validatedArgs, 
      signal, 
      onUpdate,
      context  // Pass context
    )
    
    // ...
  }
}
```

### Step 4: Update Edit Tool

```typescript
// packages/base-tools/src/tools/edit.ts

export const editTool: AgentTool<typeof editSchema> = {
  name: "edit",
  label: "edit",
  description: "...",
  parameters: editSchema,
  requiresConfirmation: true,  // NEW
  
  execute: async (
    _toolCallId,
    { path, oldText, newText },
    signal,
    _onUpdate,
    context,  // NEW
  ) => {
    const absolutePath = resolvePath(expandPath(path))
    const content = await readFile(absolutePath, "utf-8")
    
    // Validate oldText exists and is unique (existing logic)
    if (!content.includes(oldText)) {
      throw new Error(`Could not find exact text in ${path}`)
    }
    
    const firstIndex = content.indexOf(oldText)
    const secondIndex = content.indexOf(oldText, firstIndex + 1)
    if (secondIndex !== -1) {
      throw new Error(`Found multiple occurrences in ${path}`)
    }
    
    // Compute new content
    const index = content.indexOf(oldText)
    let newContent = content.substring(0, index) + newText + content.substring(index + oldText.length)
    let userModified = false
    
    // If confirmation callback provided, pause and wait
    if (context?.requestConfirmation) {
      const diff = buildTargetedDiff(path, content, index, oldText, newText)
      
      const response = await context.requestConfirmation({
        path: absolutePath,
        originalContent: content,
        suggestedContent: newContent,
        diff,
      })
      
      if (response.action === "reject") {
        throw new Error(response.reason || "Edit rejected by user")
      }
      
      if (response.action === "modify") {
        newContent = response.content
        userModified = true
      }
    }
    
    // Write final content
    await writeFile(absolutePath, newContent, "utf-8")
    
    // Build output message
    const finalDiff = userModified 
      ? buildFullDiff(path, content, newContent)
      : buildTargetedDiff(path, content, index, oldText, newText)
    
    const text = userModified
      ? `Successfully applied user-modified edit to ${path}. Note: The user modified your suggested changes before accepting. Do not attempt to revert to your original suggestion.`
      : `Successfully replaced text in ${path}.`
    
    return {
      content: [{ type: "text", text }],
      details: { 
        diff: finalDiff,
        userModified,
      },
    }
  },
}
```

### Step 5: TUI Integration

```typescript
// apps/coding-agent/src/tui-app.tsx

// Add state for pending confirmation
const [pendingConfirmation, setPendingConfirmation] = createSignal<{
  request: EditConfirmationRequest
  resolve: (response: ConfirmationResponse) => void
} | null>(null)

// Create confirmation callback
const confirmationCallback: ConfirmationCallback = async (request) => {
  return new Promise((resolve) => {
    setPendingConfirmation({ request, resolve })
  })
}

// Pass to agent transport
const transport = createTransport({
  // ...
  requestConfirmation: config.confirmEdits ? confirmationCallback : undefined,
})

// Handle keyboard in confirmation mode
useKeyboard((e) => {
  const pending = pendingConfirmation()
  if (!pending) return
  
  if (e.name === "return") {
    pending.resolve({ action: "apply" })
    setPendingConfirmation(null)
  } else if (e.name === "escape" || e.name === "d") {
    pending.resolve({ action: "reject", reason: "User cancelled" })
    setPendingConfirmation(null)
  } else if (e.name === "e") {
    handleEditInEditor(pending)
  }
})

async function handleEditInEditor(pending: typeof pendingConfirmation extends () => infer T ? NonNullable<T> : never) {
  const edited = await openExternalEditor({
    editor: config.editor,
    cwd: process.cwd(),
    renderer,
    initialValue: pending.request.suggestedContent,
  })
  
  if (edited && edited !== pending.request.suggestedContent) {
    pending.resolve({ action: "modify", content: edited })
  } else {
    // Closed without changes = accept as-is
    pending.resolve({ action: "apply" })
  }
  setPendingConfirmation(null)
}

// Render overlay when confirmation pending
<Show when={pendingConfirmation()}>
  <EditConfirmationOverlay
    request={pendingConfirmation()!.request}
    onApply={() => {
      pendingConfirmation()!.resolve({ action: "apply" })
      setPendingConfirmation(null)
    }}
    onReject={() => {
      pendingConfirmation()!.resolve({ action: "reject" })
      setPendingConfirmation(null)
    }}
    onEdit={() => handleEditInEditor(pendingConfirmation()!)}
  />
</Show>
```

### Step 6: Edit Confirmation Overlay Component

```typescript
// apps/coding-agent/src/components/EditConfirmationOverlay.tsx

import { Diff, useTheme } from "@marvin-agents/open-tui"
import type { EditConfirmationRequest } from "@marvin-agents/ai"
import { shortenPath } from "../tui-open-rendering.js"
import * as path from "path"

export interface EditConfirmationOverlayProps {
  request: EditConfirmationRequest
  onApply: () => void
  onReject: () => void
  onEdit: () => void
}

export function EditConfirmationOverlay(props: EditConfirmationOverlayProps) {
  const { theme } = useTheme()
  const filetype = path.extname(props.request.path).slice(1) || "text"
  
  return (
    <box 
      flexDirection="column" 
      borderStyle="single" 
      borderColor={theme.warning}
      padding={1}
    >
      <text bold fg={theme.warning}>
        Review Edit: {shortenPath(props.request.path)}
      </text>
      
      <box marginTop={1} maxHeight={20}>
        <Diff diffText={props.request.diff} filetype={filetype} />
      </box>
      
      <box flexDirection="row" gap={3} marginTop={1}>
        <text fg={theme.text}>
          <text bold>Enter</text> apply
        </text>
        <text fg={theme.text}>
          <text bold>e</text> edit first
        </text>
        <text fg={theme.text}>
          <text bold>d</text> reject
        </text>
      </box>
    </box>
  )
}
```

---

## Alternative: Simpler "Edit Last" Approach

Instead of pausing mid-execution, add a keybind (e.g., `Ctrl+E`) that:
1. Finds the last edit tool result
2. Opens the target file in editor
3. No modification of agent loop

**Pros:** Much simpler, no agent changes
**Cons:** Post-hoc editing, not pre-apply review

This could be Phase 0 before full implementation.

---

## Migration / Backwards Compatibility

1. **Default off** - `requiresConfirmation` flag on tool is opt-in
2. **Config flag** - `confirmEdits: true` in user config enables the flow
3. **No breaking changes** - Existing tools and agent loop work unchanged
4. **Progressive adoption** - Can add confirmation to write tool later

---

## Testing Strategy

```typescript
// packages/base-tools/tests/edit-confirmation.test.ts

describe("edit tool with confirmation", () => {
  it("applies edit when confirmed", async () => {
    const confirmFn = vi.fn().mockResolvedValue({ action: "apply" })
    const result = await editTool.execute(
      "id",
      { path: "test.txt", oldText: "foo", newText: "bar" },
      undefined,
      undefined,
      { requestConfirmation: confirmFn }
    )
    expect(confirmFn).toHaveBeenCalled()
    expect(await readFile("test.txt", "utf-8")).toBe("bar")
  })
  
  it("rejects edit when user cancels", async () => {
    const confirmFn = vi.fn().mockResolvedValue({ action: "reject" })
    await expect(editTool.execute(...)).rejects.toThrow("rejected")
  })
  
  it("applies modified content when user edits", async () => {
    const confirmFn = vi.fn().mockResolvedValue({ 
      action: "modify", 
      content: "modified" 
    })
    await editTool.execute(...)
    expect(await readFile("test.txt", "utf-8")).toBe("modified")
  })
})
```

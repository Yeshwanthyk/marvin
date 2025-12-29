# TUI Performance Optimizations Implementation Plan

## Plan Metadata
- Created: 2025-12-28
- Status: complete
- Assumptions:
  - Large repos (10k+ files) are common
  - Long streaming sessions with frequent tool calls
  - Image rendering is broken and can be removed

## Progress Tracking
- [x] Phase 1: File Index On-Demand Refresh
- [x] Phase 2: Directory Cache for Absolute/Home Paths
- [x] Phase 3: Streaming Message Isolation
- [x] Phase 4: Tool Updates O(1) via ID References
- [x] Phase 5: Write Tool Collapsed View
- [x] Phase 6: SelectList Width Caching
- [x] Phase 7: Image Component Placeholder
- [x] Phase 8: Low-Severity Fixes

## Overview
Address performance bottlenecks identified in TUI rendering and autocomplete:
1. Eliminate wasteful 5s background file scans
2. Cache directory reads for absolute/home paths
3. Reduce streaming update costs with message isolation
4. Make tool updates O(1) instead of O(n)
5. Collapse write tool output by default
6. Cache text width calculations in SelectList
7. Replace broken image rendering with placeholder
8. Fix O(n²) shell buffering and diff stats recomputation

## Current State

### File Index (5s stale timer)
- **File**: `packages/open-tui/src/autocomplete/file-index.ts:47`
- Timer triggers on every `search()` call if stale, spawning `rg --files`
```typescript
this.staleTime = options.staleTime ?? 5_000 // Default 5s - short for quick file visibility
// ...
if (this.indexed && !this.indexing && Date.now() - this.lastRefreshTime > this.staleTime) {
  this.refresh().catch(() => {/* ignore */})
}
```

### readdirSync for absolute/home paths
- **File**: `packages/open-tui/src/autocomplete/autocomplete.ts:278-341`
- Every keystroke in `~/` or `/` paths hits `readdirSync(searchDir)`
- No caching - fresh syscall each time

### Streaming updates clone full arrays
- **File**: `apps/coding-agent/src/agent-events.ts`
- `updateStreamingMessage()` (L177-199) clones entire messages array on EVERY streaming update:
  ```typescript
  ctx.setMessages((prev) => {
    const next = prev.slice()  // ⚠️ O(n) clone
    next[idx] = updated
    return next
  })
  ```
- Called from `handleMessageUpdate()` which fires every 150-220ms during streaming

### Tool updates O(n) per update
- **File**: `apps/coding-agent/src/agent-events.ts`
- `updateToolInContentBlocks()` (L443-456) maps entire contentBlocks array:
  ```typescript
  return contentBlocks.map((block) => {  // ⚠️ O(n) every tool update
    if (block.type === "tool" && block.tool.id === toolId) { ... }
  })
  ```
- Called from `handleToolStart()`, `handleToolUpdateImmediate()`, `handleToolEnd()`
- Tool data stored in 3 places: `toolBlocks` signal, `message.tools`, `message.contentBlocks[*].tool`

### Write tool always shows content
- **File**: `apps/coding-agent/src/tui-open-rendering.tsx:393-405`
- Always renders full CodeBlock even when collapsed

### SelectList width per item per render
- **File**: `packages/open-tui/src/components/select-list.tsx:185-195`
- Calls `truncateToWidth()` and `visibleWidth()` per item every render

### Image component (broken)
- **File**: `packages/open-tui/src/components/image.tsx` (396 lines)
- Complex iTerm2/Kitty protocol code that doesn't work

### Shell O(n²) reduce
- **File**: `apps/coding-agent/src/shell-runner.ts:90`
- `chunks.reduce((sum, c) => sum + c.length, 0)` called per chunk

## Desired End State
- File index only refreshes when `@` triggers autocomplete
- Absolute/home path completions use cached directory entries
- Streaming updates mutate isolated buffer, not full messages array
- Tool updates are O(1) via ID reference
- Write tool shows one-line summary by default
- SelectList caches width calculations per string
- Image shows simple placeholder text
- Shell buffer tracks size incrementally

### Verification
```bash
bun run typecheck          # Zero type errors
bun run test               # All tests pass
# Manual: Type in large repo, verify no CPU spike without @
# Manual: Stream long response, verify smooth updates
```

## Out of Scope
- Message list virtualization (larger change)
- Tree-sitter lazy loading (complex, separate PR)
- Streaming throttle adjustment (intentional design)

## Breaking Changes
None - all changes are internal performance improvements.

## Implementation Approach
Phases ordered by isolation and impact:
1-2: Autocomplete fixes (isolated, easy wins)
3-4: Streaming fixes (most impactful, moderate complexity)
5-7: UI rendering fixes (simple, visible improvement)
8: Low-severity cleanup (opportunistic)

## Phase Dependencies and Parallelization
- Phase 1-2: Independent, can run in parallel
- Phase 3-4: Should be sequential (both touch agent-events.ts)
- Phase 5-7: Independent, can run in parallel after 3-4
- Phase 8: Independent, can run anytime

---

## Phase 1: File Index On-Demand Refresh

### Overview
Remove 5s stale timer. Trigger refresh explicitly when `@` activates file autocomplete.

### Prerequisites
- [ ] None

### Change Checklist
- [x] Remove staleTime logic from FileIndex.search()
- [x] Add forceRefresh() method to FileIndex
- [x] Call forceRefresh() when @ is detected in autocomplete

### Changes

#### 1. Remove stale timer from search
**File**: `packages/open-tui/src/autocomplete/file-index.ts`
**Location**: lines 47-49

**Before**:
```typescript
constructor(options: FileIndexOptions) {
	this.cwd = options.cwd
	this.staleTime = options.staleTime ?? 5_000 // Default 5s - short for quick file visibility
```

**After**:
```typescript
constructor(options: FileIndexOptions) {
	this.cwd = options.cwd
	this.staleTime = options.staleTime ?? Infinity // Disable automatic refresh
```

#### 2. Remove stale check from search
**File**: `packages/open-tui/src/autocomplete/file-index.ts`
**Location**: lines 116-120

**Before**:
```typescript
// Trigger background refresh if stale (doesn't block current search)
if (this.indexed && !this.indexing && Date.now() - this.lastRefreshTime > this.staleTime) {
	this.refresh().catch(() => {
		/* ignore */
	})
}
```

**After**:
```typescript
// Stale refresh removed - use forceRefresh() for explicit refresh
```

#### 3. Add forceRefresh method
**File**: `packages/open-tui/src/autocomplete/file-index.ts`
**Location**: After line 147 (after `isReady` getter)

**Add**:
```typescript
/** Force a refresh if not currently indexing. Returns immediately. */
forceRefresh(): void {
	if (!this.indexing) {
		this.refresh().catch(() => {/* ignore */})
	}
}
```

#### 4. Trigger refresh on @ detection
**File**: `packages/open-tui/src/autocomplete/autocomplete.ts`
**Location**: lines 63-69

**Before**:
```typescript
// Check for @ file reference (fuzzy search) - must be after a space or at start
const atMatch = textBeforeCursor.match(/(?:^|[\s])(@[^\s]*)$/)
if (atMatch) {
	const prefix = atMatch[1] ?? "@" // The @... part
	const query = prefix.slice(1) // Remove the @
	const suggestions = this.getFuzzyFileSuggestions(query)
```

**After**:
```typescript
// Check for @ file reference (fuzzy search) - must be after a space or at start
const atMatch = textBeforeCursor.match(/(?:^|[\s])(@[^\s]*)$/)
if (atMatch) {
	const prefix = atMatch[1] ?? "@" // The @... part
	// Trigger background refresh when @ is typed (non-blocking)
	if (prefix === "@") {
		this.fileIndex.forceRefresh()
	}
	const query = prefix.slice(1) // Remove the @
	const suggestions = this.getFuzzyFileSuggestions(query)
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/open-tui/tests/autocomplete.test.ts
```

**Manual**:
- [ ] In large repo, type without @, verify no rg process spawns
- [ ] Type @, verify rg spawns once
- [ ] Continue typing after @, verify no additional spawns until next @

### Rollback
```bash
git restore -- packages/open-tui/src/autocomplete/file-index.ts packages/open-tui/src/autocomplete/autocomplete.ts
```

---

## Phase 2: Directory Cache for Absolute/Home Paths

### Overview
Cache readdirSync results for absolute/home paths with 30s TTL.

### Prerequisites
- [ ] None (can run parallel to Phase 1)

### Change Checklist
- [x] Add dirCache Map to CombinedAutocompleteProvider
- [x] Create getCachedDirEntries helper
- [x] Replace readdirSync call with cached version
- [x] Clear cache on forceRefresh (via public method)

### Changes

#### 1. Add cache field
**File**: `packages/open-tui/src/autocomplete/autocomplete.ts`
**Location**: After line 51 (after `private fileIndex: FileIndex`)

**Add**:
```typescript
private dirCache = new Map<string, { entries: import("node:fs").Dirent[]; ts: number }>()
private static readonly DIR_CACHE_TTL_MS = 30_000
```

#### 2. Add getCachedDirEntries method
**File**: `packages/open-tui/src/autocomplete/autocomplete.ts`
**Location**: After expandHomePath method (around line 278)

**Add**:
```typescript
// Get cached directory entries, refreshing if stale
private getCachedDirEntries(dir: string): import("node:fs").Dirent[] {
	const cached = this.dirCache.get(dir)
	const now = Date.now()
	if (cached && now - cached.ts < CombinedAutocompleteProvider.DIR_CACHE_TTL_MS) {
		return cached.entries
	}
	const entries = readdirSync(dir, { withFileTypes: true })
	this.dirCache.set(dir, { entries, ts: now })
	return entries
}
```

#### 3. Replace readdirSync call
**File**: `packages/open-tui/src/autocomplete/autocomplete.ts`
**Location**: line 341

**Before**:
```typescript
const entries = readdirSync(searchDir, { withFileTypes: true })
```

**After**:
```typescript
const entries = this.getCachedDirEntries(searchDir)
```

#### 4. Add clearCaches method
**File**: `packages/open-tui/src/autocomplete/autocomplete.ts`
**Location**: End of class, before closing brace

**Add**:
```typescript
/** Clear all caches. Call when workspace changes. */
clearCaches(): void {
	this.dirCache.clear()
	this.fileIndex.forceRefresh()
}
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/open-tui/tests/autocomplete.test.ts
```

**Manual**:
- [ ] Type `~/` twice quickly, verify second completion is instant
- [ ] Wait 30s, type `~/` again, verify it reads fresh

### Rollback
```bash
git restore -- packages/open-tui/src/autocomplete/autocomplete.ts
```

---

## Phase 3: Streaming Message Isolation

### Overview
Store streaming message separately from messages array. Eliminates O(n) array cloning on every streaming update.

### Current Event Flow
```
agent_start
  └─→ reset turnIndex, extractionCache

message_start
  ├─→ [user]: shift queuedMessages, persist, add to messages[], set "thinking"
  └─→ [assistant]: create streamingMessageId, reset extractionCache, 
                   push empty message to messages[]  ⚠️ CLONES ARRAY

message_update (throttled 150-220ms)
  └─→ extractIncremental() → updateStreamingMessage() 
      → setMessages(prev => prev.slice())  ⚠️ CLONES ARRAY EVERY UPDATE

message_end
  └─→ full extraction, updateStreamingMessage(), persist, clear streamingMessageId

tool_execution_start/update/end
  └─→ updates toolBlocks + message.tools + message.contentBlocks

agent_end
  └─→ clear streamingMessageId, set idle
```

### New Event Flow
```
message_start [assistant]
  └─→ setStreamingMessage(newMsg)  ✓ NO ARRAY CLONE

message_update
  └─→ setStreamingMessage(updater)  ✓ NO ARRAY CLONE

message_end
  └─→ setMessages([...prev, finalMsg]), setStreamingMessage(null)
      (single array append, not per-update)
```

### Prerequisites
- [x] Phase 1 and 2 complete

### Change Checklist
- [ ] Add streamingMessage signal to tui-app.tsx
- [ ] Add to EventHandlerContext interface
- [ ] Update handleMessageStart to use setStreamingMessage
- [ ] Replace updateStreamingMessage() with direct signal update
- [ ] Update handleMessageEnd to push final message, clear streaming
- [ ] Update handleAgentEnd to clear streamingMessage on abort
- [ ] Update handleAbort to clear streamingMessage
- [ ] Add streamingMessage prop to MessageList
- [ ] Render streaming message (Option A: merge array, Option B: separate render)

### Changes

#### 1. Add streamingMessage signal
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: After `const [messages, setMessages] = createSignal<UIMessage[]>([])`

```typescript
const [messages, setMessages] = createSignal<UIMessage[]>([])
const [streamingMessage, setStreamingMessage] = createSignal<UIAssistantMessage | null>(null)
```

#### 2. Add to EventHandlerContext interface
**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: EventHandlerContext interface (around line 28)

```typescript
export interface EventHandlerContext {
	// State setters
	setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void
	setStreamingMessage: (updater: (prev: UIAssistantMessage | null) => UIAssistantMessage | null) => void
	// ... rest unchanged
```

#### 3. Update eventCtx construction
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: eventCtx construction (around line 224)

```typescript
const eventCtx: EventHandlerContext = {
	setMessages: setMessages as (updater: (prev: UIMessage[]) => UIMessage[]) => void,
	setStreamingMessage: setStreamingMessage as (updater: (prev: UIAssistantMessage | null) => UIAssistantMessage | null) => void,
	// ... rest unchanged
```

#### 4. Update handleMessageStart
**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: handleMessageStart function, assistant branch (around line 269-284)

**Before**:
```typescript
if (event.message.role === "assistant") {
	ctx.streamingMessageId.current = crypto.randomUUID()
	cache.set(createExtractionCache())
	batch(() => {
		ctx.setActivityState("streaming")
		ctx.setMessages((prev) => [
			...prev,
			{
				id: ctx.streamingMessageId.current!,
				role: "assistant",
				content: "",
				isStreaming: true,
				tools: [],
				timestamp: Date.now(),
			},
		])
	})
}
```

**After**:
```typescript
if (event.message.role === "assistant") {
	ctx.streamingMessageId.current = crypto.randomUUID()
	cache.set(createExtractionCache())
	batch(() => {
		ctx.setActivityState("streaming")
		ctx.setStreamingMessage(() => ({
			id: ctx.streamingMessageId.current!,
			role: "assistant",
			content: "",
			isStreaming: true,
			tools: [],
			timestamp: Date.now(),
		}))
	})
}
```

#### 5. Replace updateStreamingMessage with direct signal update
**File**: `apps/coding-agent/src/agent-events.ts`

The `updateStreamingMessage()` function (lines 177-199) searches the messages array and clones it. Replace all calls with direct `setStreamingMessage()`.

**In handleMessageUpdate** (around line 169):
```typescript
// Before: updateStreamingMessage(ctx, (msg) => ({ ...msg, content: textTail, ... }))
// After:
ctx.setStreamingMessage((prev) => {
	if (!prev) return null
	return { ...prev, content: textTail, thinking: nextThinking, contentBlocks }
})
```

**In handleToolStart** (around line 347-378):
```typescript
// Before: updateStreamingMessage(ctx, (msg) => ({ ...msg, tools: [...], contentBlocks: ... }))
// After:
ctx.setStreamingMessage((prev) => {
	if (!prev) return null
	return {
		...prev,
		tools: [...(prev.tools || []), newTool],
		contentBlocks: updateToolInContentBlocks(prev.contentBlocks, event.toolCallId, () => newTool),
	}
})
```

Similar changes in `handleToolUpdateImmediate`.

#### 6. Update handleMessageEnd
**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: handleMessageEnd function (around line 286-319)

```typescript
function handleMessageEnd(
	event: Extract<AgentEvent, { type: "message_end" }>,
	ctx: EventHandlerContext
): void {
	const content = event.message.content as unknown[]
	const text = extractText(content)
	const thinking = extractThinking(content)
	const orderedBlocks = extractOrderedBlocks(content)

	const contentBlocks: UIContentBlock[] = orderedBlocks.map((block) => {
		if (block.type === "thinking") {
			return { type: "thinking" as const, id: block.id, summary: block.summary, full: block.full }
		} else if (block.type === "text") {
			return { type: "text" as const, text: block.text }
		} else {
			return {
				type: "tool" as const,
				tool: { id: block.id, name: block.name, args: block.args, isError: false, isComplete: false },
			}
		}
	})

	// Finalize streaming message and push to messages array
	ctx.setStreamingMessage((prev) => {
		if (!prev) return null
		const finalMessage: UIAssistantMessage = {
			...prev,
			content: text,
			thinking: thinking || prev.thinking,
			contentBlocks,
			isStreaming: false,
		}
		// Push to messages array (single append, not per-update clone)
		ctx.setMessages((msgs) => [...msgs, finalMessage])
		return null // Clear streaming message
	})

	ctx.streamingMessageId.current = null

	// Save message to session
	ctx.sessionManager.appendMessage(event.message as AppMessage)

	// Update usage stats...
}
```

#### 7. Update handleAgentEnd to clear streamingMessage
**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: handleAgentEnd function (around line 416)

```typescript
function handleAgentEnd(...) {
	ctx.streamingMessageId.current = null
	ctx.setStreamingMessage(() => null)  // Clear on abort/completion
	// ... rest unchanged
}
```

#### 8. Update MessageList props and rendering
**File**: `apps/coding-agent/src/components/MessageList.tsx`

**Props** (around line 672):
```typescript
export interface MessageListProps {
	messages: UIMessage[]
	streamingMessage: UIAssistantMessage | null  // NEW
	toolBlocks: ToolBlock[]
	// ... rest unchanged
}
```

**Option A - Merge at render** (simpler):
```typescript
const allMessages = createMemo(() => 
	props.streamingMessage ? [...props.messages, props.streamingMessage] : props.messages
)

return (
	<box flexDirection="column" gap={1} paddingTop={1}>
		<Index each={allMessages()}>
			{(message, index) => (
				<MessageItems
					message={message}
					toolBlocks={props.toolBlocks}
					isLastMessage={() => index === allMessages().length - 1}
					// ...
				/>
			)}
		</Index>
	</box>
)
```

**Option B - Separate render** (better perf, avoids array creation):
```typescript
const lastMessageIndex = createMemo(() => props.messages.length - 1)
const hasStreaming = createMemo(() => props.streamingMessage !== null)

return (
	<box flexDirection="column" gap={1} paddingTop={1}>
		<Index each={props.messages}>
			{(message, index) => (
				<MessageItems
					message={message}
					toolBlocks={props.toolBlocks}
					isLastMessage={() => !hasStreaming() && index === lastMessageIndex()}
					// ...
				/>
			)}
		</Index>
		<Show when={props.streamingMessage}>
			{(streaming) => (
				<MessageItems
					message={streaming}
					toolBlocks={props.toolBlocks}
					isLastMessage={() => true}
					// ...
				/>
			)}
		</Show>
	</box>
)
```

#### 9. Pass streamingMessage to MessageList
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: MessageList usage in MainView (around line 574)

```typescript
<MessageList 
	messages={props.messages} 
	streamingMessage={streamingMessage()}  // NEW
	toolBlocks={props.toolBlocks}
	// ...
/>
```

Also need to thread `streamingMessage` through MainView props.

### Edge Cases

| Case | Handling |
|------|----------|
| Aborted streams | `handleAgentEnd()` + `handleAbort()` clear streamingMessage |
| Rapid message switches | streamingMessageId ref prevents stale updates |
| Tool events after message_end | `handleToolEnd()` searches messages by toolId - works since message pushed on message_end |
| Session restore | No streaming message on restore - only finalized messages |

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Manual**:
- [ ] Stream a long response, verify smooth scrolling
- [ ] Abort mid-stream (Ctrl+C), verify no orphaned messages
- [ ] Verify tool output updates correctly during streaming
- [ ] Queue multiple messages, verify they process correctly
- [ ] Session restore still works

### Rollback
```bash
git restore -- apps/coding-agent/src/agent-events.ts apps/coding-agent/src/tui-app.tsx apps/coding-agent/src/components/MessageList.tsx
```

---

## Phase 4: Tool Updates O(1) via ID References

### Overview
ContentBlocks reference tool IDs instead of embedding full tool objects. Tool data is looked up from toolBlocks signal at render time. This eliminates O(n) `updateToolInContentBlocks()` mapping on every tool update.

### Current Problem
Tool data is stored in THREE places, all updated on every tool event:
1. `toolBlocks` signal (global) - via `setToolBlocks()`
2. `message.tools` array (per-message) - via `updateStreamingMessage()`
3. `message.contentBlocks[*].tool` (embedded) - via `updateToolInContentBlocks()` O(n) map

```typescript
// updateToolInContentBlocks - called on EVERY tool update
function updateToolInContentBlocks(contentBlocks, toolId, updater) {
	return contentBlocks.map((block) => {  // ⚠️ O(n) every update
		if (block.type === "tool" && block.tool.id === toolId) {
			return { ...block, tool: updater(block.tool) }
		}
		return block
	})
}
```

### New Approach
- `contentBlocks` stores `{ type: "tool", toolId: string }` - stable structure, no updates needed
- Tool handlers only update `toolBlocks` signal
- MessageList looks up tool data from `toolBlocks` at render time
- Solid's fine-grained reactivity handles re-render when `toolBlocks` changes

### Prerequisites
- [ ] Phase 3 complete (shares agent-events.ts modifications)

### Change Checklist
- [ ] Update UIContentBlock type in types.ts
- [ ] Update extractIncremental() to use toolId
- [ ] Update handleMessageEnd() to use toolId
- [ ] Delete updateToolInContentBlocks() entirely
- [ ] Simplify handleToolStart() - remove contentBlocks update
- [ ] Simplify handleToolUpdateImmediate() - remove contentBlocks update  
- [ ] Update buildMessageItems() with toolMap lookup
- [ ] Update buildContentItems() with toolMap lookup
- [ ] Update restoreSession() to use toolId references
- [ ] Verify getCachedItem() reactivity still works

### Changes

#### 1. Update UIContentBlock type
**File**: `apps/coding-agent/src/types.ts`
**Location**: UIContentBlock type (around line 5)

**Before**:
```typescript
export type UIContentBlock =
	| { type: "thinking"; id: string; summary: string; full: string }
	| { type: "text"; text: string }
	| { type: "tool"; tool: ToolBlock }
```

**After**:
```typescript
export type UIContentBlock =
	| { type: "thinking"; id: string; summary: string; full: string }
	| { type: "text"; text: string }
	| { type: "tool"; toolId: string }  // Reference only
```

#### 2. Update extractIncremental()
**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: extractIncremental function, tool block creation (around line 151)

**Before**:
```typescript
} else {
	return {
		type: "tool" as const,
		tool: { id: block.id, name: block.name, args: block.args, isError: false, isComplete: false },
	}
}
```

**After**:
```typescript
} else {
	return { type: "tool" as const, toolId: block.id }
}
```

#### 3. Update handleMessageEnd()
**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: handleMessageEnd, contentBlocks creation (around line 300)

**Before**:
```typescript
const contentBlocks: UIContentBlock[] = orderedBlocks.map((block) => {
	// ...
	} else {
		return {
			type: "tool" as const,
			tool: { id: block.id, name: block.name, args: block.args, isError: false, isComplete: false },
		}
	}
})
```

**After**:
```typescript
const contentBlocks: UIContentBlock[] = orderedBlocks.map((block) => {
	// ...
	} else {
		return { type: "tool" as const, toolId: block.id }
	}
})
```

#### 4. Delete updateToolInContentBlocks()
**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: Function definition (around line 443-456)

**Remove entirely** - no longer needed.

#### 5. Simplify handleToolStart()
**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: handleToolStart function (around line 347-378)

**Before**:
```typescript
ctx.setStreamingMessage((prev) => {
	if (!prev) return null
	return {
		...prev,
		tools: [...(prev.tools || []), newTool],
		contentBlocks: updateToolInContentBlocks(prev.contentBlocks, event.toolCallId, () => newTool),
	}
})
```

**After**:
```typescript
ctx.setStreamingMessage((prev) => {
	if (!prev) return null
	return {
		...prev,
		tools: [...(prev.tools || []), newTool],
		// contentBlocks already has toolId from message_update - no update needed
	}
})
```

#### 6. Simplify handleToolUpdateImmediate()
**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: handleToolUpdateImmediate function (around line 396-411)

**Before**:
```typescript
batch(() => {
	ctx.setToolBlocks(updateTools)
	ctx.setStreamingMessage((prev) => {
		if (!prev) return null
		return {
			...prev,
			tools: updateTools(prev.tools || []),
			contentBlocks: updateToolInContentBlocks(prev.contentBlocks, event.toolCallId, toolUpdater),
		}
	})
})
```

**After**:
```typescript
// Only update toolBlocks - render will lookup by ID
ctx.setToolBlocks(updateTools)
// Optionally update message.tools for consistency, but not contentBlocks
ctx.setStreamingMessage((prev) => {
	if (!prev) return null
	return { ...prev, tools: updateTools(prev.tools || []) }
})
```

#### 7. Update MessageList with tool lookup
**File**: `apps/coding-agent/src/components/MessageList.tsx`

**Add toolMap creation** (in MessageItems component, around line 568):
```typescript
function MessageItems(props: { /* ... */ }) {
	// Create lookup map for O(1) tool access
	const toolMap = createMemo(() => new Map(props.toolBlocks.map(t => [t.id, t])))
	
	// ... rest of component
}
```

**Update buildMessageItems** (around line 370-463) to handle new type:

**Before**:
```typescript
} else if (block.type === "tool") {
	if (!renderedToolIds.has(block.tool.id)) {
		const item: ContentItem = { type: "tool", tool: block.tool }
		// ...
		renderedToolIds.add(block.tool.id)
	}
}
```

**After**:
```typescript
} else if (block.type === "tool") {
	if (!renderedToolIds.has(block.toolId)) {
		// Look up tool from toolBlocks
		const tool = toolBlocks.find(t => t.id === block.toolId)
		if (tool) {
			const item: ContentItem = { type: "tool", tool }
			// ...
			renderedToolIds.add(block.toolId)
		}
	}
}
```

Note: `buildMessageItems` receives `toolBlocks` as a parameter, so this lookup works.

#### 8. Update restoreSession()
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: restoreSession function, contentBlocks creation (around line 255-298)

**Before**:
```typescript
const contentBlocks: UIContentBlock[] = orderedBlocks.map((block) => {
	// ...
	} else {
		const tool = tools.find((t) => t.id === block.id)
		return {
			type: "tool" as const,
			tool: tool || { id: block.id, name: block.name, args: block.args, isError: false, isComplete: false },
		}
	}
})
```

**After**:
```typescript
const contentBlocks: UIContentBlock[] = orderedBlocks.map((block) => {
	// ...
	} else {
		return { type: "tool" as const, toolId: block.id }
	}
})
```

### Reactivity Consideration

With toolId references, contentBlocks structure is stable during tool updates. Need to ensure re-render happens when toolBlocks changes.

**Current flow:**
1. `contentItems = createMemo(() => buildMessageItems(message, toolBlocks, ...))`
2. When `toolBlocks` signal updates, memo recomputes
3. `buildMessageItems` looks up tool data → new tool object with new `updateSeq`
4. `getCachedItem()` sees different `updateSeq` → cache miss → re-render

This works because:
- `toolBlocks` is passed as a prop to MessageItems
- The `createMemo` in MessageItems depends on `props.toolBlocks`
- When `toolBlocks` changes, the memo recomputes and finds updated tool data

**Verify:** The cache key in `getCachedItem` includes `tool.updateSeq`:
```typescript
getCachedItem(`tool:${block.tool.id}:${block.tool.isComplete}`, item, (a, b) =>
	// ...
	(a.tool.updateSeq ?? 0) === (b.tool.updateSeq ?? 0)
)
```

This ensures tool updates trigger re-render even with stable contentBlocks structure.

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Manual**:
- [ ] Run tool-heavy session, verify tool output updates in real-time
- [ ] Verify tool completion/error states render properly
- [ ] Verify tool expansion toggle works
- [ ] Session restore shows tools correctly
- [ ] Multiple concurrent tools update independently

### Rollback
```bash
git restore -- apps/coding-agent/src/types.ts apps/coding-agent/src/agent-events.ts apps/coding-agent/src/components/MessageList.tsx apps/coding-agent/src/tui-app.tsx
```

---

## Phase 5: Write Tool Collapsed View

### Overview
Write tool shows single-line summary when collapsed. Full content only on expand.

### Prerequisites
- [ ] None (independent of Phases 3-4)

### Change Checklist
- [ ] Update write tool renderer to show summary when collapsed
- [ ] Add line count to summary

### Changes

#### 1. Update write tool renderer
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`
**Location**: lines 393-405 (write tool in registry)

**Before**:
```typescript
write: {
	mode: () => "block",
	renderHeader: (ctx) => {
		const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
		return <ToolHeader label="write" detail={path} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
	},
	renderBody: (ctx) => {
		const { theme } = useTheme()
		const content = String(ctx.args?.content || "")
		if (!content && !ctx.isComplete) return <text fg={theme.textMuted}>writing…</text>
		if (!content) return <text fg={theme.textMuted}>no content</text>

		const filetype = getLanguageFromPath(String(ctx.args?.path || ctx.args?.file_path || ""))
		const rendered = ctx.expanded ? replaceTabs(content) : truncateLines(content, 40).text
		return <CodeBlock content={rendered} filetype={filetype} title="write" />
	},
},
```

**After**:
```typescript
write: {
	mode: (ctx) => (ctx.expanded ? "block" : "inline"),
	renderHeader: (ctx) => {
		const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
		const content = String(ctx.args?.content || "")
		const lineCount = content ? content.split("\n").length : 0
		const suffix = ctx.isComplete && !ctx.isError && lineCount > 0 ? `${lineCount} lines` : undefined
		return <ToolHeader label="write" detail={path} suffix={suffix} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
	},
	renderBody: (ctx) => {
		const { theme } = useTheme()
		// Only show body when expanded
		if (!ctx.expanded) return null
		const content = String(ctx.args?.content || "")
		if (!content && !ctx.isComplete) return <text fg={theme.textMuted}>writing…</text>
		if (!content) return <text fg={theme.textMuted}>no content</text>

		const filetype = getLanguageFromPath(String(ctx.args?.path || ctx.args?.file_path || ""))
		return <CodeBlock content={replaceTabs(content)} filetype={filetype} title="write" />
	},
},
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
```

**Manual**:
- [ ] Write tool shows "write path/to/file (42 lines)" when collapsed
- [ ] Expanding shows full CodeBlock with syntax highlighting
- [ ] Large file writes don't cause visible lag

### Rollback
```bash
git restore -- apps/coding-agent/src/tui-open-rendering.tsx
```

---

## Phase 6: SelectList Width Caching

### Overview
Cache visibleWidth and truncateToWidth results per string to avoid repeated grapheme segmentation.

### Prerequisites
- [ ] None (independent)

### Change Checklist
- [ ] Add width cache to text-width.ts
- [ ] Add cached versions of visibleWidth and truncateToWidth
- [ ] Update SelectListItem to use cached versions

### Changes

#### 1. Add caches to text-width.ts
**File**: `packages/open-tui/src/utils/text-width.ts`
**Location**: After line 30 (after stripAnsi function)

**Add**:
```typescript
// Width caches - cleared on resize or when growing too large
const visibleWidthCache = new Map<string, number>()
const truncateCache = new Map<string, string>()
const MAX_CACHE_SIZE = 2000

function maybePruneCache<K, V>(cache: Map<K, V>): void {
	if (cache.size > MAX_CACHE_SIZE) {
		// Delete oldest half
		const keys = Array.from(cache.keys())
		for (let i = 0; i < keys.length / 2; i++) {
			cache.delete(keys[i]!)
		}
	}
}

/** Cached version of visibleWidth for repeated lookups */
export function cachedVisibleWidth(str: string): number {
	let w = visibleWidthCache.get(str)
	if (w === undefined) {
		w = visibleWidth(str)
		maybePruneCache(visibleWidthCache)
		visibleWidthCache.set(str, w)
	}
	return w
}

/** Cached version of truncateToWidth */
export function cachedTruncateToWidth(text: string, maxWidth: number, ellipsis: string = "..."): string {
	const key = `${text}:${maxWidth}:${ellipsis}`
	let result = truncateCache.get(key)
	if (result === undefined) {
		result = truncateToWidth(text, maxWidth, ellipsis)
		maybePruneCache(truncateCache)
		truncateCache.set(key, result)
	}
	return result
}

/** Clear width caches (call on terminal resize) */
export function clearWidthCaches(): void {
	visibleWidthCache.clear()
	truncateCache.clear()
}
```

#### 2. Export new functions
**File**: `packages/open-tui/src/utils/text-width.ts`

Ensure the new functions are exported (they should be via `export function`).

#### 3. Update SelectListItem
**File**: `packages/open-tui/src/components/select-list.tsx`
**Location**: Import and usage

**Update import**:
```typescript
import { cachedTruncateToWidth, cachedVisibleWidth } from "../utils/text-width.js"
```

**Update SelectListItem** (around line 185-195):

**Before**:
```typescript
const label = () => truncateToWidth(value(), labelWidth(), "")
const labelPad = () => " ".repeat(Math.max(0, labelWidth() - visibleWidth(label())))
// ...
const desc = () =>
	showDescription() ? truncateToWidth(props.item.description!, descWidth(), "") : ""
// ...
const pad = () => " ".repeat(Math.max(0, props.width() - visibleWidth(line())))
```

**After**:
```typescript
const label = () => cachedTruncateToWidth(value(), labelWidth(), "")
const labelPad = () => " ".repeat(Math.max(0, labelWidth() - cachedVisibleWidth(label())))
// ...
const desc = () =>
	showDescription() ? cachedTruncateToWidth(props.item.description!, descWidth(), "") : ""
// ...
const pad = () => " ".repeat(Math.max(0, props.width() - cachedVisibleWidth(line())))
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/open-tui
```

**Manual**:
- [ ] Rapid filtering in SelectList is smooth
- [ ] Width calculations correct after window resize

### Rollback
```bash
git restore -- packages/open-tui/src/utils/text-width.ts packages/open-tui/src/components/select-list.tsx
```

---

## Phase 7: Image Component Placeholder

### Overview
Replace broken image rendering with simple text placeholder.

### Prerequisites
- [ ] None (independent)

### Change Checklist
- [ ] Replace Image component body with placeholder
- [ ] Remove unused helper functions
- [ ] Keep interface for compatibility

### Changes

#### 1. Replace Image component
**File**: `packages/open-tui/src/components/image.tsx`

**Replace entire file with**:
```typescript
/**
 * Image component placeholder
 *
 * Terminal image protocols (iTerm2/Kitty) are unreliable across terminals.
 * This placeholder shows image metadata instead.
 */

import type { JSX } from "solid-js"
import { useTheme } from "../context/theme.js"

export interface ImageProps {
	/** Base64 encoded image data */
	data: string
	/** MIME type of the image */
	mimeType: string
	/** Filename for display */
	filename?: string
	/** Unused - kept for API compatibility */
	maxWidth?: number
	/** Unused - kept for API compatibility */
	maxHeight?: number
}

export function Image(props: ImageProps): JSX.Element {
	const { theme } = useTheme()

	// Calculate approximate size from base64 length (3/4 ratio)
	const sizeKb = () => Math.round((props.data.length * 3) / 4 / 1024)

	const label = () => {
		const name = props.filename ?? props.mimeType.split("/")[1] ?? "image"
		return `[Image: ${name} (~${sizeKb()}KB)]`
	}

	return <text fg={theme.textMuted}>{label()}</text>
}
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/open-tui
```

**Manual**:
- [ ] Read tool on image file shows placeholder text
- [ ] No crash or rendering issues

### Rollback
```bash
git restore -- packages/open-tui/src/components/image.tsx
```

---

## Phase 8: Low-Severity Fixes

### Overview
Fix O(n²) shell buffering, diff stats recomputation, and itemCache growth.

### Prerequisites
- [ ] None (independent)

### Change Checklist
- [ ] Fix shell buffer to track size incrementally
- [ ] Memoize getDiffStats call
- [ ] Add LRU cap to itemCache

### Changes

#### 1. Fix shell buffer O(n²)
**File**: `apps/coding-agent/src/shell-runner.ts`
**Location**: lines 85-95

**Before**:
```typescript
// Keep rolling buffer (2x max for truncation headroom)
chunks.push(data)
let chunksBytes = chunks.reduce((sum, c) => sum + c.length, 0)
const maxChunksBytes = DEFAULT_MAX_BYTES * 2
while (chunksBytes > maxChunksBytes && chunks.length > 1) {
	const removed = chunks.shift()!
	chunksBytes -= removed.length
}
```

**After**:
```typescript
// Keep rolling buffer (2x max for truncation headroom)
chunks.push(data)
chunksBytes += data.length
const maxChunksBytes = DEFAULT_MAX_BYTES * 2
while (chunksBytes > maxChunksBytes && chunks.length > 1) {
	const removed = chunks.shift()!
	chunksBytes -= removed.length
}
```

**Also move declaration** (around line 50):

**Before**:
```typescript
const chunks: Buffer[] = []
let totalBytes = 0
```

**After**:
```typescript
const chunks: Buffer[] = []
let totalBytes = 0
let chunksBytes = 0
```

#### 2. Memoize getDiffStats
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`
**Location**: Around line 416 (edit tool renderHeader)

**Before**:
```typescript
renderHeader: (ctx) => {
	const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
	const diffStats = ctx.editDiff ? getDiffStats(ctx.editDiff) : null
	const suffix = ctx.isComplete && !ctx.isError && diffStats ? `+${diffStats.added}/-${diffStats.removed}` : undefined
	return <ToolHeader label="edit" detail={path} suffix={suffix} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
},
```

This is already called per-render but ctx.editDiff is stable per tool. Add a simple cache:

**After getDiffStats function** (around line 218):
```typescript
// Cache diff stats by diff text hash (first 100 chars + length as key)
const diffStatsCache = new Map<string, { added: number; removed: number }>()

function getCachedDiffStats(diffText: string): { added: number; removed: number } {
	const key = diffText.slice(0, 100) + diffText.length
	let stats = diffStatsCache.get(key)
	if (!stats) {
		stats = getDiffStats(diffText)
		if (diffStatsCache.size > 500) diffStatsCache.clear() // Simple size limit
		diffStatsCache.set(key, stats)
	}
	return stats
}
```

**Update edit tool**:
```typescript
const diffStats = ctx.editDiff ? getCachedDiffStats(ctx.editDiff) : null
```

#### 3. Add LRU cap to itemCache
**File**: `apps/coding-agent/src/components/MessageList.tsx`
**Location**: Around line 214

**Before**:
```typescript
const itemCache = new Map<string, ContentItem>()
let lastMessageCount = 0
```

**After**:
```typescript
const itemCache = new Map<string, ContentItem>()
const MAX_ITEM_CACHE_SIZE = 500
let lastMessageCount = 0

function pruneItemCache(): void {
	if (itemCache.size > MAX_ITEM_CACHE_SIZE) {
		// Delete oldest half (Map maintains insertion order)
		const keys = Array.from(itemCache.keys())
		for (let i = 0; i < keys.length / 2; i++) {
			itemCache.delete(keys[i]!)
		}
	}
}
```

**Update getCachedItem** (around line 225):
```typescript
function getCachedItem<T extends ContentItem>(
	key: string,
	current: T,
	isEqual: (a: T, b: T) => boolean
): T {
	const cached = itemCache.get(key) as T | undefined
	if (cached && cached.type === current.type && isEqual(cached, current)) {
		return cached
	}
	pruneItemCache()
	itemCache.set(key, current)
	return current
}
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Manual**:
- [ ] Long bash command with streaming output doesn't slow down
- [ ] Edit tool header renders quickly for large diffs
- [ ] Long session doesn't grow memory indefinitely

### Rollback
```bash
git restore -- apps/coding-agent/src/shell-runner.ts apps/coding-agent/src/tui-open-rendering.tsx apps/coding-agent/src/components/MessageList.tsx
```

---

## Testing Strategy

### Unit Tests to Add/Modify

**File**: `packages/open-tui/tests/autocomplete.test.ts`

```typescript
describe('file index refresh', () => {
  it('should not auto-refresh on search', async () => {
    // Verify no background refresh without explicit trigger
  })
  
  it('should refresh when forceRefresh called', async () => {
    // Verify refresh happens on demand
  })
})
```

**File**: `packages/open-tui/tests/text-width.test.ts`

```typescript
describe('cachedVisibleWidth', () => {
  it('should return same result as visibleWidth', () => {
    // Verify cache correctness
  })
  
  it('should cache repeated lookups', () => {
    // Verify cache hit
  })
})
```

### Manual Testing Checklist
1. [ ] Large repo (10k+ files): No CPU spike when typing without @
2. [ ] Streaming response: Smooth scrolling during long output
3. [ ] Tool-heavy session: No lag during rapid tool updates
4. [ ] Write tool: Collapsed by default, expands on click
5. [ ] SelectList: Smooth filtering with many items
6. [ ] Image read: Shows placeholder instead of broken rendering
7. [ ] Long session: Memory usage stable over time

## Open Questions
- [x] Should forceRefresh be debounced? -> No, the file index already handles concurrent refreshes via pendingCallbacks
- [x] Cache TTL for dir entries? -> 30s is reasonable, matches typical completion session length

## References
- File index: `packages/open-tui/src/autocomplete/file-index.ts`
- Autocomplete: `packages/open-tui/src/autocomplete/autocomplete.ts`
- Agent events: `apps/coding-agent/src/agent-events.ts`
- Message list: `apps/coding-agent/src/components/MessageList.tsx`
- Tool rendering: `apps/coding-agent/src/tui-open-rendering.tsx`
- Shell runner: `apps/coding-agent/src/shell-runner.ts`

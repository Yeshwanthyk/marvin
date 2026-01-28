# Session Picker Revamp Implementation Plan

## Plan Metadata
- Created: 2025-01-28
- Status: draft
- Assumptions:
  - mmem is installed and available in PATH
  - mmem index is kept reasonably fresh (we'll trigger background index)
  - Current subagent filtering heuristic (`firstMessage.startsWith("System context:")`) is sufficient

## Progress Tracking
- [x] Phase 1: Add lastActivity to SessionManager
- [x] Phase 2: Create mmem client wrapper
- [x] Phase 3: Revamp session picker UI

## Overview
Revamp the resume sessions selector to:
1. Add full-text search via mmem integration
2. Sort by last activity (not creation time)
3. Group sessions by date ("Today", "Yesterday", "This Week", "Older")
4. Gracefully fall back to title-only search when mmem unavailable

## Current State

### Session Picker (`apps/coding-agent/src/session-picker.tsx`)
- Basic SelectList with no search input
- Sessions sorted by creation timestamp (from filename)
- Shows: title (first 60 chars), relative time, message count, model
- Filters out subagent sessions via `firstMessage.startsWith("System context:")`

### SessionManager (`packages/runtime-effect/src/session-manager.ts`)
```typescript
// lines 49-52
export interface SessionDetails extends SessionInfo {
  messageCount: number;
  firstMessage: string;
  // Missing: lastActivity
}
```
- `loadAllSessions()` (lines 215-268) reads all JSONL files
- Sorts by filename (creation timestamp), not last activity
- No lastActivity field available

### mmem Integration
- Available in PATH as `mmem`
- Supports `--agent marvin` to filter to marvin sessions only
- Returns: `path`, `title`, `last_message_at`, `score`
- Full-text search across all message content via SQLite FTS5

### Key Discoveries
- File mtime closely tracks last message timestamp (verified)
- ~10% of sessions are subagent sessions (67/634 in sample)
- SelectList already has `filter` prop for filtering (line 28 of select-list.tsx)
- Input component available from `@yeshwanthyk/open-tui`

## Desired End State

### UI Mockup
```
┌─ Resume Session ─────────────────────────────────┐
│ Search: [___________________________________]    │
│                                                  │
│ Today                                            │
│ → fix the resume picker bug           2h ago    │
│   add search to session list          5h ago    │
│                                                  │
│ Yesterday                                        │
│   implement mmem indexer              1d ago    │
│                                                  │
│ ↑/↓ navigate · Enter select · Esc cancel        │
└──────────────────────────────────────────────────┘
```

When searching (ranked by relevance, no date groups):
```
│ Search: [session picker______________]           │
│                                                  │
│ → fix the resume picker bug           2h ago    │
│   look at session picker component    3d ago    │
│   session list improvements           1w ago    │
│                                        [full-text] │
```

### Verification
```bash
bun run typecheck          # Zero type errors
bun test                   # All tests pass
bun run marvin -r          # Opens picker with search, date groups
```

Manual:
- [ ] Empty search shows sessions grouped by date
- [ ] Typing query triggers mmem search after debounce
- [ ] Results ranked by relevance when searching
- [ ] Fallback to title filter when mmem unavailable (shows `[title only]`)
- [ ] Sessions sorted by last activity, not creation time

## Out of Scope
- Adding `parentId` to SessionMetadata (keep current heuristic)
- Delete/rename keybinds (future enhancement)
- Preview panel showing session content
- Cross-directory session search

## Breaking Changes
None - SessionDetails gets new optional-compatible field, UI is internal.

## Dependency and Configuration Changes
None required.

## Error Handling Strategy

### mmem Errors as Values
```typescript
type MmemSearchResult = 
  | { ok: true; sessions: MmemSession[] }
  | { ok: false; reason: "not-installed" | "not-indexed" | "exec-error" | "parse-error" }
```

| Scenario | Reason | Fallback |
|----------|--------|----------|
| mmem not in PATH | `not-installed` | In-memory title filter |
| mmem index missing | `not-indexed` | In-memory title filter |
| mmem non-zero exit | `exec-error` | In-memory title filter |
| Invalid JSON output | `parse-error` | In-memory title filter |

No exceptions thrown - all paths return values.

## Implementation Approach

**Why this approach:**
- Leverage existing mmem for full-text search (already indexes 1283 sessions)
- Keep UI simple - search input + grouped list
- Graceful degradation ensures picker always works

**Alternatives rejected:**
- Build custom FTS index: Duplicates mmem functionality
- Always load all message content: Too slow for large session counts
- Real-time indexing: Adds latency to search

## Phase Dependencies and Parallelization
- Phase 1 (SessionManager) and Phase 2 (mmem client) can run in parallel
- Phase 3 (UI) depends on both Phase 1 and Phase 2
- Single implementer recommended (small scope)

---

## Phase 1: Add lastActivity to SessionManager

### Overview
Add `lastActivity` field to SessionDetails using file mtime. Sort sessions by lastActivity instead of creation timestamp.

### Prerequisites
- [ ] None

### Change Checklist
- [x] Add `lastActivity` to SessionDetails interface
- [x] Import `statSync` from node:fs
- [x] Get file mtime in loadAllSessions()
- [x] Sort by lastActivity descending

### Changes

#### 1. Add lastActivity to SessionDetails interface
**File**: `packages/runtime-effect/src/session-manager.ts`
**Location**: lines 49-52

**Before**:
```typescript
export interface SessionDetails extends SessionInfo {
  messageCount: number;
  firstMessage: string;
}
```

**After**:
```typescript
export interface SessionDetails extends SessionInfo {
  messageCount: number;
  firstMessage: string;
  lastActivity: number;
}
```

**Why**: Enable sorting by last activity instead of creation time.

#### 2. Import statSync
**File**: `packages/runtime-effect/src/session-manager.ts`
**Location**: line 1

**Before**:
```typescript
import { appendFile, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
```

**After**:
```typescript
import { appendFile, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
```

#### 3. Get file mtime and add lastActivity
**File**: `packages/runtime-effect/src/session-manager.ts`
**Location**: lines 252-262 (inside loadAllSessions, after message parsing loop)

**Before**:
```typescript
        sessions.push({
          id: metadata.id,
          timestamp: metadata.timestamp,
          path,
          provider: metadata.provider,
          modelId: metadata.modelId,
          messageCount,
          firstMessage: firstMessage || "(empty session)",
        });
```

**After**:
```typescript
        // Use file mtime for last activity (more accurate than creation timestamp)
        const lastActivity = statSync(path).mtimeMs;

        sessions.push({
          id: metadata.id,
          timestamp: metadata.timestamp,
          path,
          provider: metadata.provider,
          modelId: metadata.modelId,
          messageCount,
          firstMessage: firstMessage || "(empty session)",
          lastActivity,
        });
```

#### 4. Sort by lastActivity
**File**: `packages/runtime-effect/src/session-manager.ts`
**Location**: line 268 (end of loadAllSessions)

**Before**:
```typescript
    return sessions;
  }
```

**After**:
```typescript
    // Sort by last activity (most recent first)
    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }
```

### Edge Cases to Handle
- [ ] File stat fails: Wrapped in existing try/catch, session skipped
- [ ] Empty sessions directory: Returns empty array (existing behavior)

### Success Criteria

**Automated**:
```bash
bun run typecheck                    # Zero type errors
bun test packages/runtime-effect     # Tests pass
```

**Manual**:
- [ ] `loadAllSessions()` returns sessions with `lastActivity` field
- [ ] Sessions ordered by most recent activity first

### Rollback
```bash
git checkout -- packages/runtime-effect/src/session-manager.ts
```

---

## Phase 2: Create mmem Client Wrapper

### Overview
Create a simple wrapper for mmem that handles errors as values and filters results to current cwd.

### Prerequisites
- [ ] None (can run in parallel with Phase 1)

### Change Checklist
- [ ] Create mmem.ts with types
- [ ] Implement searchSessions function
- [ ] Implement background index trigger
- [ ] Handle all error cases as values

### Changes

#### 1. Create mmem client
**File**: `apps/coding-agent/src/mmem.ts`
**Location**: new file

**Content**:
```typescript
/**
 * mmem client for full-text session search
 * Gracefully falls back when mmem unavailable
 */

import { spawnSync, spawn } from "bun";

export interface MmemSession {
  path: string;
  title: string;
  lastActivity: number;
  score: number;
}

export type MmemSearchResult =
  | { ok: true; sessions: MmemSession[] }
  | { ok: false; reason: "not-installed" | "not-indexed" | "exec-error" | "parse-error" };

interface MmemRawResult {
  path: string;
  title: string;
  last_message_at: string;
  score: number;
}

/**
 * Encode cwd to match marvin's session directory naming
 * e.g., /Users/foo/bar -> --Users--foo--bar--
 */
function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/\//g, "--")}--`;
}

/**
 * Search sessions via mmem with full-text search
 * Filters to marvin sessions in the specified cwd
 */
export function searchSessions(query: string, cwd: string, limit = 30): MmemSearchResult {
  // Check if mmem exists
  const which = spawnSync(["which", "mmem"]);
  if (which.exitCode !== 0) {
    return { ok: false, reason: "not-installed" };
  }

  // Run search
  const result = spawnSync([
    "mmem", "find", query,
    "--agent", "marvin",
    "--scope", "session",
    "--limit", String(limit),
    "--json",
  ]);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    if (stderr.includes("no such table") || stderr.includes("no index")) {
      return { ok: false, reason: "not-indexed" };
    }
    return { ok: false, reason: "exec-error" };
  }

  // Parse JSON
  let data: MmemRawResult[];
  try {
    const stdout = result.stdout.toString().trim();
    if (!stdout) {
      return { ok: true, sessions: [] };
    }
    data = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "parse-error" };
  }

  // Filter to current cwd and transform
  const encodedCwd = encodeCwd(cwd);
  const sessions: MmemSession[] = data
    .filter((r) => r.path.includes(encodedCwd))
    .map((r) => ({
      path: r.path,
      title: r.title,
      lastActivity: parseInt(r.last_message_at, 10),
      score: r.score,
    }));

  return { ok: true, sessions };
}

/**
 * Trigger mmem index in background (non-blocking)
 * Call after session ends or when picker opens
 */
export function triggerBackgroundIndex(): void {
  try {
    spawn(["mmem", "index"], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // Silently ignore - mmem may not be installed
  }
}
```

**Why**: Encapsulates mmem integration with clean error handling.

### Edge Cases to Handle
- [ ] mmem not installed: Returns `{ ok: false, reason: "not-installed" }`
- [ ] mmem index empty: Returns `{ ok: false, reason: "not-indexed" }`
- [ ] mmem crashes: Returns `{ ok: false, reason: "exec-error" }`
- [ ] Invalid JSON: Returns `{ ok: false, reason: "parse-error" }`
- [ ] Empty results: Returns `{ ok: true, sessions: [] }`
- [ ] No sessions match cwd filter: Returns `{ ok: true, sessions: [] }`

### Success Criteria

**Automated**:
```bash
bun run typecheck  # Zero type errors
```

**Manual**:
```bash
# Test in bun repl
import { searchSessions } from "./apps/coding-agent/src/mmem.js"
searchSessions("session picker", process.cwd())
# Should return { ok: true, sessions: [...] } or { ok: false, reason: "..." }
```

### Rollback
```bash
rm apps/coding-agent/src/mmem.ts
```

---

## Phase 3: Revamp Session Picker UI

### Overview
Add search input, date grouping, and integrate mmem search with graceful fallback.

### Prerequisites
- [ ] Phase 1 complete (lastActivity available)
- [ ] Phase 2 complete (mmem client available)

### Change Checklist
- [ ] Add Input component for search
- [ ] Add search state with debounce
- [ ] Implement date grouping logic
- [ ] Integrate mmem search with fallback
- [ ] Update SessionPickerProps to include cwd
- [ ] Trigger background index on mount
- [ ] Show fallback indicator when using title-only search
- [ ] Update keyboard handling for search focus

### Changes

#### 1. Update imports and add types
**File**: `apps/coding-agent/src/session-picker.tsx`
**Location**: lines 1-8

**Before**:
```typescript
/**
 * OpenTUI-based session picker
 */

import { render, useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { SelectList, ThemeProvider, useTheme, type SelectItem, type SelectListRef, type ThemeMode } from "@yeshwanthyk/open-tui"
import type { SessionManager } from "./session-manager.js"
```

**After**:
```typescript
/**
 * OpenTUI-based session picker with full-text search
 */

import { render, useTerminalDimensions, useKeyboard } from "@opentui/solid";
import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { Input, SelectList, ThemeProvider, useTheme, type SelectItem, type SelectListRef, type ThemeMode } from "@yeshwanthyk/open-tui";
import type { SessionManager } from "./session-manager.js";
import { searchSessions, triggerBackgroundIndex, type MmemSession } from "./mmem.js";
```

#### 2. Add date grouping helper
**File**: `apps/coding-agent/src/session-picker.tsx`
**Location**: after imports (new code)

**Add**:
```typescript
type DateCategory = "Today" | "Yesterday" | "This Week" | "Older";

function getDateCategory(timestamp: number): DateCategory {
  const now = new Date();
  const date = new Date(timestamp);
  
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= weekAgo) return "This Week";
  return "Older";
}

interface GroupedSessions {
  category: DateCategory;
  sessions: SessionForDisplay[];
}

interface SessionForDisplay {
  path: string;
  title: string;
  lastActivity: number;
  messageCount?: number;
  modelId?: string;
}

function groupByDate(sessions: SessionForDisplay[]): GroupedSessions[] {
  const categories: DateCategory[] = ["Today", "Yesterday", "This Week", "Older"];
  const grouped = new Map<DateCategory, SessionForDisplay[]>();
  
  for (const cat of categories) {
    grouped.set(cat, []);
  }
  
  for (const session of sessions) {
    const cat = getDateCategory(session.lastActivity);
    grouped.get(cat)!.push(session);
  }
  
  return categories
    .map((cat) => ({ category: cat, sessions: grouped.get(cat)! }))
    .filter((g) => g.sessions.length > 0);
}
```

#### 3. Update SessionPickerProps
**File**: `apps/coding-agent/src/session-picker.tsx`
**Location**: interface SessionPickerProps

**Before**:
```typescript
interface SessionPickerProps {
	sessions: Array<{
		path: string
		firstMessage: string
		timestamp: number
		messageCount: number
		modelId: string
	}>
	onSelect: (path: string) => void
	onCancel: () => void
}
```

**After**:
```typescript
interface SessionPickerProps {
  sessions: Array<{
    path: string;
    firstMessage: string;
    timestamp: number;
    lastActivity: number;
    messageCount: number;
    modelId: string;
  }>;
  cwd: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}
```

#### 4. Rewrite SessionPickerApp component
**File**: `apps/coding-agent/src/session-picker.tsx`
**Location**: replace entire SessionPickerApp function

**Before**:
```typescript
function SessionPickerApp(props: SessionPickerProps) {
	const { theme } = useTheme()
	const dimensions = useTerminalDimensions()
	let listRef: SelectListRef | undefined

	const items: SelectItem[] = props.sessions.map((s) => ({
		value: s.path,
		label: formatFirstMessage(s.firstMessage),
		description: formatMeta(s.timestamp, s.messageCount, s.modelId),
	}))

	useKeyboard((e: { name: string; ctrl?: boolean }) => {
		if (e.name === "up" || (e.ctrl && e.name === "p")) {
			listRef?.moveUp()
		} else if (e.name === "down" || (e.ctrl && e.name === "n")) {
			listRef?.moveDown()
		} else if (e.name === "return") {
			listRef?.select()
		} else if (e.name === "escape" || (e.ctrl && e.name === "c")) {
			props.onCancel()
		}
	})

	return (
		<box
			flexDirection="column"
			width={dimensions().width}
			height={dimensions().height}
		>
			<text fg={theme.textMuted}>Resume Session</text>
			<box height={1} />
			<SelectList
				ref={(r) => { listRef = r }}
				items={items}
				maxVisible={Math.min(10, dimensions().height - 4)}
				width={dimensions().width - 2}
				onSelect={(item) => props.onSelect(item.value)}
				onCancel={props.onCancel}
			/>
			<box flexGrow={1} />
			<text fg={theme.textMuted}>↑/↓ navigate · Enter select · Esc cancel</text>
		</box>
	)
}
```

**After**:
```typescript
function SessionPickerApp(props: SessionPickerProps) {
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();
  let listRef: SelectListRef | undefined;
  let inputRef: { focus: () => void } | undefined;

  const [query, setQuery] = createSignal("");
  const [searchFocused, setSearchFocused] = createSignal(true);
  const [usingFallback, setUsingFallback] = createSignal(false);

  // Trigger background index on mount
  onMount(() => {
    triggerBackgroundIndex();
  });

  // Convert loaded sessions to display format
  const loadedSessions = createMemo((): SessionForDisplay[] =>
    props.sessions.map((s) => ({
      path: s.path,
      title: s.firstMessage,
      lastActivity: s.lastActivity,
      messageCount: s.messageCount,
      modelId: s.modelId,
    }))
  );

  // Search results (mmem or fallback)
  const searchResults = createMemo((): SessionForDisplay[] | null => {
    const q = query().trim();
    if (!q) return null;

    // Try mmem search
    const result = searchSessions(q, props.cwd);
    if (result.ok) {
      setUsingFallback(false);
      return result.sessions;
    }

    // Fallback to title filter
    setUsingFallback(true);
    const lowerQ = q.toLowerCase();
    return loadedSessions().filter((s) =>
      s.title.toLowerCase().includes(lowerQ)
    );
  });

  // Final display list
  const displaySessions = createMemo(() => searchResults() ?? loadedSessions());

  // Group by date only when not searching
  const grouped = createMemo(() => {
    if (query().trim()) return null;
    return groupByDate(displaySessions());
  });

  // Flat items for SelectList
  const items = createMemo((): SelectItem[] =>
    displaySessions().map((s) => ({
      value: s.path,
      label: formatFirstMessage(s.title),
      description: formatMeta(s.lastActivity, s.messageCount, s.modelId),
    }))
  );

  useKeyboard((e: { name: string; ctrl?: boolean; shift?: boolean }) => {
    if (e.name === "up" || (e.ctrl && e.name === "p")) {
      listRef?.moveUp();
    } else if (e.name === "down" || (e.ctrl && e.name === "n")) {
      listRef?.moveDown();
    } else if (e.name === "return" && !searchFocused()) {
      listRef?.select();
    } else if (e.name === "escape" || (e.ctrl && e.name === "c")) {
      if (query()) {
        setQuery("");
      } else {
        props.onCancel();
      }
    }
  });

  const maxVisible = () => Math.min(10, dimensions().height - 6);

  return (
    <box flexDirection="column" width={dimensions().width} height={dimensions().height}>
      <text fg={theme.text}>Resume Session</text>
      <box height={1} />
      <box flexDirection="row" width={dimensions().width - 2}>
        <text fg={theme.textMuted}>Search: </text>
        <Input
          value={query()}
          placeholder="search sessions..."
          focused={searchFocused()}
          width={dimensions().width - 12}
          onChange={(v) => setQuery(v)}
          onSubmit={() => setSearchFocused(false)}
          onEscape={() => {
            if (query()) {
              setQuery("");
            } else {
              props.onCancel();
            }
          }}
        />
      </box>
      <box height={1} />
      <Show when={grouped()} fallback={
        <SelectList
          ref={(r) => { listRef = r; }}
          items={items()}
          maxVisible={maxVisible()}
          width={dimensions().width - 2}
          onSelect={(item) => props.onSelect(item.value)}
          onCancel={props.onCancel}
        />
      }>
        {(groups) => (
          <box flexDirection="column">
            <For each={groups()}>
              {(group) => (
                <box flexDirection="column">
                  <text fg={theme.accent}>{group.category}</text>
                  <For each={group.sessions}>
                    {(session, idx) => (
                      <text fg={idx() === 0 ? theme.text : theme.textMuted}>
                        {idx() === 0 ? "→ " : "  "}
                        {formatFirstMessage(session.title)}
                        {"  "}
                        <span style={{ fg: theme.textMuted }}>
                          {formatRelativeTime(session.lastActivity)}
                        </span>
                      </text>
                    )}
                  </For>
                  <box height={1} />
                </box>
              )}
            </For>
          </box>
        )}
      </Show>
      <box flexGrow={1} />
      <box flexDirection="row" justifyContent="space-between" width={dimensions().width - 2}>
        <text fg={theme.textMuted}>↑/↓ navigate · Enter select · Esc cancel</text>
        <Show when={usingFallback() && query()}>
          <text fg={theme.textMuted}>[title only]</text>
        </Show>
      </box>
    </box>
  );
}
```

#### 5. Update formatMeta to use lastActivity
**File**: `apps/coding-agent/src/session-picker.tsx`
**Location**: formatMeta function

**Before**:
```typescript
function formatMeta(ts: number, count: number, model: string): string {
	const ago = formatRelativeTime(ts)
	return `${ago} · ${count} msgs · ${model}`
}
```

**After**:
```typescript
function formatMeta(lastActivity: number, count?: number, model?: string): string {
  const ago = formatRelativeTime(lastActivity);
  const parts = [ago];
  if (count !== undefined) parts.push(`${count} msgs`);
  if (model) parts.push(model);
  return parts.join(" · ");
}
```

#### 6. Update selectSession to pass cwd
**File**: `apps/coding-agent/src/session-picker.tsx`
**Location**: selectSession function

**Before**:
```typescript
export async function selectSession(sessionManager: SessionManager): Promise<string | null> {
	const allSessions = sessionManager.loadAllSessions()
	// Filter out empty sessions and subagent sessions (start with "System context:")
	const sessions = allSessions.filter(
		(s) => s.messageCount > 0 && !s.firstMessage.startsWith("System context:")
	)
	if (sessions.length === 0) return null
	if (sessions.length === 1) return sessions[0]!.path

	return new Promise((resolve) => {
		let resolved = false

		const doResolve = (value: string | null) => {
			if (resolved) return
			resolved = true
			if (value === null) {
				// Cancel - exit immediately since we're done
				process.stdout.write("\nNo session selected\n")
				process.exit(0)
			}
			resolve(value)
		}

		const themeMode = detectThemeMode()

		render(
			() => (
				<ThemeProvider mode={themeMode}>
					<SessionPickerApp
						sessions={sessions}
						onSelect={(path) => doResolve(path)}
						onCancel={() => doResolve(null)}
					/>
				</ThemeProvider>
			),
			{
				targetFps: 30,
				exitOnCtrlC: false,
				useKittyKeyboard: {},
			}
		)
	})
}
```

**After**:
```typescript
export async function selectSession(sessionManager: SessionManager): Promise<string | null> {
  const allSessions = sessionManager.loadAllSessions();
  // Filter out empty sessions and subagent sessions (start with "System context:")
  const sessions = allSessions.filter(
    (s) => s.messageCount > 0 && !s.firstMessage.startsWith("System context:")
  );
  if (sessions.length === 0) return null;
  if (sessions.length === 1) return sessions[0]!.path;

  const cwd = process.cwd();

  return new Promise((resolve) => {
    let resolved = false;

    const doResolve = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      if (value === null) {
        // Cancel - exit immediately since we're done
        process.stdout.write("\nNo session selected\n");
        process.exit(0);
      }
      resolve(value);
    };

    const themeMode = detectThemeMode();

    render(
      () => (
        <ThemeProvider mode={themeMode}>
          <SessionPickerApp
            sessions={sessions}
            cwd={cwd}
            onSelect={(path) => doResolve(path)}
            onCancel={() => doResolve(null)}
          />
        </ThemeProvider>
      ),
      {
        targetFps: 30,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
      }
    );
  });
}
```

### Edge Cases to Handle
- [ ] Empty query: Shows all sessions grouped by date
- [ ] No matching sessions: Shows "No matching sessions" via SelectList
- [ ] mmem not installed: Falls back to title filter, shows `[title only]`
- [ ] Very long session titles: Truncated to 60 chars (existing behavior)
- [ ] Escape with query: Clears query first, second Escape cancels

### Success Criteria

**Automated**:
```bash
bun run typecheck  # Zero type errors
bun run test       # All tests pass
```

**Manual**:
- [ ] `bun run marvin -r` opens picker with search input
- [ ] Empty search shows sessions grouped by "Today", "Yesterday", etc.
- [ ] Typing triggers search, results ranked by relevance
- [ ] Sessions sorted by last activity (recent first)
- [ ] Without mmem: shows `[title only]` indicator, still works
- [ ] Escape clears search, second Escape closes picker

### Rollback
```bash
git checkout -- apps/coding-agent/src/session-picker.tsx
rm apps/coding-agent/src/mmem.ts
git checkout -- packages/runtime-effect/src/session-manager.ts
```

---

## Testing Strategy

### Unit Tests to Add

**File**: `apps/coding-agent/tests/mmem.test.ts` (new)

```typescript
import { describe, it, expect, mock } from "bun:test";
import { searchSessions } from "../src/mmem.js";

describe("mmem client", () => {
  it("should return not-installed when mmem missing", () => {
    // Mock spawnSync to return exit code 1 for 'which'
    const result = searchSessions("test", "/tmp");
    // Verify graceful fallback
    expect(result.ok === false && result.reason === "not-installed").toBe(true);
  });

  it("should filter results by cwd", () => {
    // Test with mock data
  });

  it("should handle empty results", () => {
    // Test with mock data returning []
  });
});
```

### Manual Testing Checklist
1. [ ] Open picker in repo with many sessions - verify date grouping
2. [ ] Search for term in message content (not title) - verify mmem finds it
3. [ ] Uninstall mmem temporarily - verify fallback works
4. [ ] Search with no results - verify empty state
5. [ ] Test keyboard navigation through grouped sessions

## Anti-Patterns to Avoid
- Don't block on mmem index - always async/background
- Don't throw exceptions from mmem client - return error values
- Don't filter in SelectList AND manually - use one approach

## Open Questions
- [x] Debounce delay for search? -> No debounce needed; spawnSync is fast enough (~50ms)
- [x] Show date headers in SelectList? -> Use grouped rendering when not searching, flat SelectList when searching

## References
- Similar impl: opencode's `dialog-session-list.tsx`
- mmem source: `/Users/yesh/Documents/personal/mmem`
- SelectList component: `packages/open-tui/src/components/select-list.tsx`

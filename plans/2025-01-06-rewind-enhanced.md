# Enhanced /rewind: File Changes + Context

## Problem

Current `/rewind` shows opaque snapshot labels like `checkpoint-turn-0-1703350000000`. User cannot:
1. See what files would change when rewinding
2. Understand what triggered the snapshot

## Current State

Ref names already encode context:
- `checkpoint-resume-*` → session start/resume
- `checkpoint-turn-N-*` → turn N start  
- `before-rewind-*` → safety snapshot before rewind
- `latest` / `resume` → special refs

We can parse these AND compute file diffs against current state.

## Proposed Solution

### Phase 1: File change detection (core utility)

Add `getChangedFiles(cwd, ref)` to compare current working tree against a snapshot.

```
Current state → Snapshot X
  M src/foo.ts        (modified)
  A src/bar.ts        (added in snapshot, missing now)
  D src/baz.ts        (deleted in snapshot, exists now)
```

Note: "A" means file exists in snapshot but not current (will be added on rewind).

### Phase 2: Better labels from ref names

Parse ref names to show human-readable context:

| Ref pattern | Display |
|-------------|---------|
| `checkpoint-turn-N-*` | `Turn N` |
| `checkpoint-resume-*` | `Session start` |
| `before-rewind-*` | `Before rewind` |
| `latest` | `Latest` |
| `resume` | `Resume point` |

### Phase 3: Enhanced picker UI

Show file changes inline with each snapshot:

```
Rewind to Snapshot

  Turn 3                              2m ago
    M src/components/App.tsx
    M src/utils/helpers.ts

  Turn 2                              5m ago
    A src/new-file.ts
    M package.json

  Session start                      15m ago
    (no changes from current)

↑/↓ navigate · Enter rewind · Esc cancel
```

If many files changed, show summary: `12 files (M:8 A:3 D:1)` with expansion.

---

## Phase 1: File Change Detection

### Changes

#### 1. Add types and getChangedFiles function
**File**: `apps/coding-agent/src/rewind.ts`

**Add after SnapshotRef type**:
```ts
export type FileChange = {
  status: "A" | "M" | "D" | "R" | "T" | "U" | "X"
  path: string
}

export async function getChangedFiles(cwd: string, targetRef: string): Promise<FileChange[]> {
  const root = await gitRoot(cwd)
  if (!root) return []
  const gitDir = await snapshotGitDir(root, cwd)
  if (!gitDir) return []

  // Create tree from current working state
  await git(["-C", root, "--git-dir", gitDir, "--work-tree", root, "add", "-A", "."], cwd)
  const currentTree = await gitLine(["-C", root, "--git-dir", gitDir, "--work-tree", root, "write-tree"], cwd)

  // Compare: current → target (what changes if we rewind to target)
  const lines = await gitLines(
    ["--git-dir", gitDir, "diff-tree", "-r", "--name-status", currentTree, targetRef],
    cwd
  )

  return lines
    .map((line) => {
      const match = line.match(/^([AMDRTUX])\t(.+)$/)
      if (!match) return null
      return { status: match[1] as FileChange["status"], path: match[2]! }
    })
    .filter((c): c is FileChange => c !== null)
}
```

**Why**: Enables picker to show what files will change for each snapshot.

### Success Criteria
- [ ] `getChangedFiles(cwd, ref)` returns file list with status
- [ ] Empty array if no changes between current and target

---

## Phase 2: Human-Readable Labels

### Changes

#### 1. Update SnapshotRef type and parsing
**File**: `apps/coding-agent/src/rewind.ts`

**Replace SnapshotRef type**:
```ts
export type SnapshotRef = {
  ref: string
  label: string      // Human-readable: "Turn 3", "Session start"
  rawLabel: string   // Original: "checkpoint-turn-3-1234567890"
  kind: "turn" | "resume" | "before-rewind" | "latest" | "other"
  turnIndex?: number // For turn snapshots
  timestamp: number
}
```

**Replace toSnapshotRef function**:
```ts
function toSnapshotRef(ref: string): SnapshotRef | null {
  const rawLabel = ref.replace(REF_PREFIX, "")
  const ts = extractTimestamp(ref)
  
  // Parse kind and build human label
  if (rawLabel === "latest") {
    return { ref, label: "Latest", rawLabel, kind: "latest", timestamp: ts || Date.now() }
  }
  if (rawLabel === "resume") {
    return { ref, label: "Resume point", rawLabel, kind: "resume", timestamp: ts || Date.now() }
  }
  
  const turnMatch = rawLabel.match(/^checkpoint-turn-(\d+)-(\d+)$/)
  if (turnMatch) {
    const turnIndex = parseInt(turnMatch[1]!, 10)
    const timestamp = parseInt(turnMatch[2]!, 10)
    return { ref, label: `Turn ${turnIndex}`, rawLabel, kind: "turn", turnIndex, timestamp }
  }
  
  const resumeMatch = rawLabel.match(/^checkpoint-resume-(\d+)$/)
  if (resumeMatch) {
    const timestamp = parseInt(resumeMatch[1]!, 10)
    return { ref, label: "Session start", rawLabel, kind: "resume", timestamp }
  }
  
  const rewindMatch = rawLabel.match(/^before-rewind-(\d+)$/)
  if (rewindMatch) {
    const timestamp = parseInt(rewindMatch[1]!, 10)
    return { ref, label: "Before rewind", rawLabel, kind: "before-rewind", timestamp }
  }
  
  // Unknown pattern - use raw label
  if (!ts) return null
  return { ref, label: rawLabel, rawLabel, kind: "other", timestamp: ts }
}
```

**Why**: Users see "Turn 3" instead of cryptic ref names.

### Success Criteria
- [ ] Turn snapshots show as "Turn N"
- [ ] Resume snapshots show as "Session start"
- [ ] Unknown patterns still work with raw label

---

## Phase 3: Enhanced Picker UI

### Changes

#### 1. Update RewindItem and picker
**File**: `apps/coding-agent/src/rewind-picker.tsx`

**Replace RewindItem interface**:
```tsx
export interface RewindItem {
  ref: string
  label: string
  timestamp: number
  changes: FileChange[]  // From getChangedFiles
}

export type FileChange = {
  status: "A" | "M" | "D" | "R" | "T" | "U" | "X"
  path: string
}
```

**Update RewindPickerApp to show changes**:
```tsx
function RewindPickerApp(props: RewindPickerProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  let listRef: SelectListRef | undefined

  const items: SelectItem[] = props.items.map((s) => ({
    value: s.ref,
    label: s.label,
    description: formatDescription(s),
  }))

  // ... keyboard handling unchanged ...

  return (
    <box flexDirection="column" width={dimensions().width} height={dimensions().height}>
      <text fg={theme.textMuted}>Rewind to Snapshot</text>
      <box height={1} />
      <SelectList
        ref={(r) => { listRef = r }}
        items={items}
        maxVisible={Math.min(15, dimensions().height - 4)}
        width={dimensions().width - 2}
        onSelect={(item) => props.onSelect(item.value)}
        onCancel={props.onCancel}
      />
      <box flexGrow={1} />
      <text fg={theme.textMuted}>↑/↓ navigate · Enter rewind · Esc cancel</text>
    </box>
  )
}

function formatDescription(item: RewindItem): string {
  const timeAgo = formatRelativeTime(item.timestamp)
  
  if (item.changes.length === 0) {
    return `${timeAgo} · no changes`
  }
  
  // Compact summary
  const counts = { A: 0, M: 0, D: 0, other: 0 }
  for (const c of item.changes) {
    if (c.status === "A") counts.A++
    else if (c.status === "M") counts.M++
    else if (c.status === "D") counts.D++
    else counts.other++
  }
  
  const parts: string[] = []
  if (counts.M > 0) parts.push(`M:${counts.M}`)
  if (counts.A > 0) parts.push(`A:${counts.A}`)
  if (counts.D > 0) parts.push(`D:${counts.D}`)
  if (counts.other > 0) parts.push(`?:${counts.other}`)
  
  // Show first few file names if space permits
  const filePreview = item.changes.slice(0, 3).map(c => `${c.status} ${path.basename(c.path)}`).join(", ")
  
  return `${timeAgo} · ${item.changes.length} files (${parts.join(" ")}) · ${filePreview}`
}
```

#### 2. Update command handler to fetch changes
**File**: `apps/coding-agent/src/commands.ts`

**Update handleRewindCmd**:
```ts
async function handleRewindCmd(ctx: CommandContext): Promise<boolean> {
  if (ctx.isResponding()) {
    addSystemMessage(ctx, "Cannot rewind while responding. Use /abort first.")
    return true
  }

  try {
    const snapshots = await listSnapshots(ctx.cwd)
    if (snapshots.length === 0) {
      addSystemMessage(ctx, "No snapshots found. Enable the snapshot hook to use /rewind.")
      return true
    }

    // Fetch file changes for each snapshot (could be slow for many snapshots)
    const { getChangedFiles } = await import("./rewind.js")
    const items = await Promise.all(
      snapshots.slice(0, 20).map(async (s) => ({
        ref: s.ref,
        label: s.label,
        timestamp: s.timestamp,
        changes: await getChangedFiles(ctx.cwd, s.ref),
      }))
    )

    const { selectRewind } = await import("./rewind-picker.js")
    const selected = await selectRewind(items)
    if (!selected) return true

    await createSafetySnapshot(ctx.cwd)
    await restoreSnapshot(ctx.cwd, selected)
    addSystemMessage(ctx, `Rewound to ${selected.replace("refs/marvin-checkpoints/", "")}.`)
    return true
  } catch (err) {
    addSystemMessage(ctx, `Rewind failed: ${err instanceof Error ? err.message : String(err)}`)
    return true
  }
}
```

### Success Criteria
- [ ] Picker shows human-readable labels
- [ ] Picker shows file change summary for each snapshot
- [ ] User can see at a glance what will change

---

## Future Enhancements (out of scope)

1. **Git notes for richer metadata** - Store tool name, file paths, user message context
2. **Diff preview** - Show full diff of selected snapshot before confirming
3. **Lazy loading** - Fetch file changes on demand as user navigates (performance)
4. **Filter by file** - "Show snapshots that touched src/foo.ts"

---

## Testing

### Manual Testing
1. [ ] Create several turns of conversation with edits
2. [ ] Run `/rewind` - see human-readable labels (Turn 0, Turn 1, etc.)
3. [ ] See file change counts for each snapshot
4. [ ] Select a snapshot and confirm files are restored
5. [ ] Before-rewind safety snapshot appears in next `/rewind`

---

## Rollback

```bash
git checkout HEAD -- apps/coding-agent/src/rewind.ts apps/coding-agent/src/rewind-picker.tsx apps/coding-agent/src/commands.ts
```

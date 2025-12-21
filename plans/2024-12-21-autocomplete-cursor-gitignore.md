# Autocomplete: Cursor Correctness + .gitignore Respect

## Overview

Fix autocomplete cursor jumping/jank and make .gitignore authoritative for all file suggestions.

## Current State

1. **Cursor position ignored** - `apps/coding-agent/src/tui-app.tsx:526`:
```typescript
updateAutocomplete(text, lines.length - 1, lines[lines.length - 1]?.length ?? 0)  // Always EOB
```

2. **setText() clears undo + cursor** - `apps/coding-agent/src/tui-app.tsx:432`:
```typescript
textareaRef.setText(result.lines.join("\n"))  // Clears history, resets cursor
```

3. **readdirSync ignores .gitignore** - `packages/open-tui/src/autocomplete/autocomplete.ts:268`

### Available APIs (from @opentui/core)

- `textareaRef.logicalCursor` → `{ row, col, offset }`
- `textareaRef.replaceText(text)` → preserves undo history
- `textareaRef.editBuffer.setCursorToLineCol(line, col)` → restore cursor

## Desired End State

1. Cursor position used for suggestion lookup AND apply
2. Autocomplete preserves undo history and cursor position
3. All file suggestions respect .gitignore (except absolute/~ paths)

### Verification

```bash
bun run check
```

Manual: type mid-line, autocomplete at cursor, undo works, `@` excludes node_modules/

## Out of Scope

- Perf optimizations (fuzzysort.prepare) - defer until proven slow
- Selection stability by value - polish, defer
- UI dropdown refactor

---

## Phase 1: Cursor Correctness

### Changes

#### 1. Use actual cursor in onContentChange

**File**: `apps/coding-agent/src/tui-app.tsx`
**Line**: 526

**Before**:
```typescript
onContentChange={() => { if (textareaRef) { const text = textareaRef.plainText; if (!text.startsWith("/") && !text.includes("@")) { setShowAutocomplete(false); return }; const lines = text.split("\n"); updateAutocomplete(text, lines.length - 1, lines[lines.length - 1]?.length ?? 0) } }}
```

**After**:
```typescript
onContentChange={() => { if (textareaRef) { const text = textareaRef.plainText; if (!text.startsWith("/") && !text.includes("@")) { setShowAutocomplete(false); return }; const cursor = textareaRef.logicalCursor; updateAutocomplete(text, cursor.row, cursor.col) } }}
```

#### 2. Use actual cursor + replaceText in applyAutocomplete

**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: 424-433

**Before**:
```typescript
const applyAutocomplete = () => {
	if (!showAutocomplete() || !textareaRef) return false
	const items = autocompleteItems(), idx = autocompleteIndex()
	if (idx < 0 || idx >= items.length) return false
	const text = textareaRef.plainText, lines = text.split("\n"), cursorLine = lines.length - 1
	const result = autocompleteProvider.applyCompletion(lines, cursorLine, lines[cursorLine]?.length ?? 0, items[idx]!, autocompletePrefix())
	textareaRef.setText(result.lines.join("\n")); setShowAutocomplete(false); setAutocompleteItems([]); return true
}
```

**After**:
```typescript
const applyAutocomplete = () => {
	if (!showAutocomplete() || !textareaRef) return false
	const items = autocompleteItems(), idx = autocompleteIndex()
	if (idx < 0 || idx >= items.length) return false
	const cursor = textareaRef.logicalCursor
	const text = textareaRef.plainText, lines = text.split("\n")
	const result = autocompleteProvider.applyCompletion(lines, cursor.row, cursor.col, items[idx]!, autocompletePrefix())
	textareaRef.replaceText(result.lines.join("\n"))
	textareaRef.editBuffer.setCursorToLineCol(result.cursorLine, result.cursorCol)
	setShowAutocomplete(false); setAutocompleteItems([])
	return true
}
```

### Success Criteria

```bash
bun run check
```

Manual:
- [ ] Type `hello @`, move cursor after `@`, complete → inserts at cursor
- [ ] Undo after completion → restores previous state

### Rollback

```bash
git checkout HEAD -- apps/coding-agent/src/tui-app.tsx
```

---

## Phase 2: Index-Backed File Suggestions

### Overview

Route relative paths through existing `getFuzzyFileSuggestions()` instead of readdirSync.

### Prerequisites

- [ ] Phase 1 complete

### Changes

#### 1. Route relative paths through fuzzy search

**File**: `packages/open-tui/src/autocomplete/autocomplete.ts`
**Method**: `getFileSuggestions` (~line 236)

**Before** (beginning of method):
```typescript
private getFileSuggestions(prefix: string): AutocompleteItem[] {
	try {
		let searchDir: string;
		let searchPrefix: string;
		let expandedPrefix = prefix;
		let isAtPrefix = false;

		// Handle @ file attachment prefix
		if (prefix.startsWith("@")) {
			isAtPrefix = true;
			expandedPrefix = prefix.slice(1); // Remove the @
		}

		// Handle home directory expansion
		if (expandedPrefix.startsWith("~")) {
			expandedPrefix = this.expandHomePath(expandedPrefix);
		}
```

**After**:
```typescript
private getFileSuggestions(prefix: string): AutocompleteItem[] {
	try {
		let expandedPrefix = prefix;
		let isAtPrefix = false;

		// Handle @ file attachment prefix
		if (prefix.startsWith("@")) {
			isAtPrefix = true;
			expandedPrefix = prefix.slice(1);
		}

		// Handle home directory expansion
		if (expandedPrefix.startsWith("~")) {
			expandedPrefix = this.expandHomePath(expandedPrefix);
		}

		// For relative paths, use index-backed fuzzy search (respects .gitignore)
		const isAbsoluteOrHome = expandedPrefix.startsWith("/") || prefix.startsWith("~");
		if (!isAbsoluteOrHome) {
			return this.getFuzzyFileSuggestions(expandedPrefix);
		}

		// Fall through to readdirSync for absolute/home paths
		let searchDir: string;
		let searchPrefix: string;
```

**Why**: Reuses existing index-backed fuzzy search which respects .gitignore. Only absolute/~ paths use readdirSync (where gitignore doesn't apply anyway).

### Success Criteria

```bash
bun run check
```

Manual (in repo with node_modules in .gitignore):
- [ ] `@` suggestions don't show `node_modules/`
- [ ] `~/` and `/` paths still work

### Rollback

```bash
git checkout HEAD -- packages/open-tui/src/autocomplete/autocomplete.ts
```

---

## References

- TextareaRenderable API: `node_modules/.bun/@opentui+core@0.1.62+.../renderables/Textarea.d.ts`
- EditBuffer API: `node_modules/.bun/@opentui+core@0.1.62+.../edit-buffer.d.ts`

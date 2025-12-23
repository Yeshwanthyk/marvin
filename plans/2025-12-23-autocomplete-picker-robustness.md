# Autocomplete/Picker Robustness (Themes + Files) — Implementation Plan

## Overview
Fix TUI autocomplete picker inconsistencies (theme picker in particular): eliminate stale/garbled lines, ensure scrolling keeps the selected item visible, make triggering consistent across multiline input, prevent immediate reopen after applying a completion, and unify theme names to a single source of truth.

## Current State

### Key Discoveries
- **Picker rendering is custom + not width-clearing** → stale trailing glyphs (matches screenshot).
  - File: `apps/coding-agent/src/tui-app.tsx`
  - Lines: 620-643
  - Current implementation renders each row as variable-length `<text>` without padding to terminal width.
- **No scrolling window** → when selection index moves beyond visible area, it feels “random” because selected item is clipped.
  - File: `apps/coding-agent/src/tui-app.tsx`
  - Lines: 620-643 (list has `maxHeight={15}` but renders up to 30 items; selected can move offscreen)
- **Autocomplete trigger is gated on whole-buffer prefix** → inconsistent for multiline edits.
  - File: `apps/coding-agent/src/tui-app.tsx`
  - Line: 650
  - Gate: `!text.startsWith("/") && !text.includes("@")` prevents completions when `/theme` isn’t at buffer start, and blocks non-@ path completions.
- **Apply completion causes programmatic text update** → can re-trigger autocomplete instantly.
  - File: `apps/coding-agent/src/tui-app.tsx`
  - Lines: 478-495
  - `textareaRef.replaceText(newText)` can fire `onContentChange` before the UI closes the picker.
- **Theme names are duplicated/hardcoded** (drift risk).
  - File: `apps/coding-agent/src/commands.ts:14-21`
  - File: `apps/coding-agent/src/autocomplete-commands.ts:33-37`
  - Source of truth already exists: `packages/open-tui/src/context/theme.tsx:54` (`BUILTIN_THEMES`)
- **We already have a robust list renderer** (`SelectList`) that pads each line and scrolls.
  - File: `packages/open-tui/src/components/select-list.tsx:176-206` (pads to full width)

## Desired End State

### Behavior
- Autocomplete picker:
  - No stale characters / corrupted rows on rerender.
  - Selected item is always visible (scroll window).
  - Triggering works consistently based on cursor context (including multiline); not based on whole-buffer `startsWith("/")`.
  - Applying a completion does not immediately reopen the picker.
- Themes:
  - `/theme` validation and `/theme <tab>` suggestions share a single source of truth derived from `BUILTIN_THEMES`.

### Verification

**Automated (run in order):**
```bash
bun run typecheck
bun run test
```

**Manual (TUI):**
1. Run `bun run marvin`.
2. Type `/theme ` (with a trailing space) and use ↑/↓ for deep list navigation.
   - Expect: selection stays visible; no ghost characters.
3. On a multiline prompt, put `/theme ` on the second line.
   - Expect: picker shows theme completions (previously inconsistent).
4. Select a theme with Tab.
   - Expect: picker closes and stays closed; no instant reopen.

## Out of Scope
- New dedicated `/theme` preview dialog.
- Adding “Tab opens picker from empty input” file completion UX.
- Changing `CombinedAutocompleteProvider` matching semantics.

## Error Handling Strategy
- UI state changes must not throw.
- Defensive width calculations (avoid negative widths on small terminals).

## Implementation Approach

### Chosen
**Use `SelectList` for rendering** (solves width padding + scrolling in one move) and keep existing keyboard handler to drive selection/apply.

### Alternative (fallback)
Keep custom renderer but pad each row to terminal width using `visibleWidth/truncateToWidth` (mirroring `SelectListItem`).

---

## Phase 1: Single Source of Truth for Theme Names

### Overview
Eliminate hardcoded theme lists and derive available themes from `@marvin-agents/open-tui` `BUILTIN_THEMES`.

### Prerequisites
- [x] None

### Changes

#### 1. Add shared theme name module
**File**: `apps/coding-agent/src/theme-names.ts`
**Lines**: new file

**Add**:
```ts
import { BUILTIN_THEMES } from "@marvin-agents/open-tui"

export const THEME_NAMES = ["marvin", ...Object.keys(BUILTIN_THEMES)]
```

**Why**: single source of truth consumed by both slash command handling and autocomplete.

#### 2. Update `/theme` validation to use shared list
**File**: `apps/coding-agent/src/commands.ts`
**Lines**: 14-21, 135-155

**Before**:
```ts
// Available theme names (must match BUILTIN_THEMES in @marvin-agents/open-tui)
const THEME_NAMES = [
	"marvin", "aura", "ayu", "catppuccin", "catppuccin-macchiato", "cobalt2",
	"dracula", "everforest", "flexoki", "github", "gruvbox", "kanagawa", "lucent-orng",
	"material", "matrix", "mercury", "monokai", "nightowl", "nord", "one-dark", "opencode",
	"orng", "palenight", "rosepine", "solarized", "synthwave84", "tokyonight", "vercel",
	"vesper", "zenburn",
]
```

**After**:
```ts
import { THEME_NAMES } from "./theme-names.js"
```

**Before**:
```ts
	// Validate theme name
	if (!THEME_NAMES.includes(themeName)) {
		addSystemMessage(ctx, `Unknown theme "${themeName}". Available: ${THEME_NAMES.join(", ")}`)
		return true
	}
```

**After** (same logic; uses imported `THEME_NAMES`):
```ts
	// Validate theme name
	if (!THEME_NAMES.includes(themeName)) {
		addSystemMessage(ctx, `Unknown theme "${themeName}". Available: ${THEME_NAMES.join(", ")}`)
		return true
	}
```

**Why**: ensures `/theme` remains aligned with the shipped themes.

#### 3. Update theme argument completions to use shared list
**File**: `apps/coding-agent/src/autocomplete-commands.ts`
**Lines**: 31-41

**Before**:
```ts
    getArgumentCompletions: (argumentText: string) => {
      const prefix = argumentText.trim().toLowerCase();
      const themes = ['marvin', 'aura', 'ayu', 'catppuccin', 'catppuccin-macchiato', 'cobalt2',
        'dracula', 'everforest', 'flexoki', 'github', 'gruvbox', 'kanagawa', 'lucent-orng',
        'material', 'matrix', 'mercury', 'monokai', 'nightowl', 'nord', 'one-dark', 'opencode',
        'orng', 'palenight', 'rosepine', 'solarized', 'synthwave84', 'tokyonight', 'vercel',
        'vesper', 'zenburn'];
      return themes
        .filter((t) => t.startsWith(prefix))
        .map((t) => ({ value: t, label: t }));
    },
```

**After**:
```ts
import { THEME_NAMES } from "./theme-names.js";

// ...

    getArgumentCompletions: (argumentText: string) => {
      const prefix = argumentText.trim().toLowerCase();
      return THEME_NAMES
        .filter((t) => t.startsWith(prefix))
        .map((t) => ({ value: t, label: t }));
    },
```

**Why**: autocomplete suggestions never drift from `/theme` validation or actual theme availability.

### Edge Cases to Handle
- [ ] `BUILTIN_THEMES` missing a key → still safe; list is derived.
- [ ] Theme name not present → existing error message remains.

### Success Criteria

**Automated:**
```bash
bun run typecheck
```

**Manual:**
- [ ] `/theme` prints an up-to-date list.

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/commands.ts apps/coding-agent/src/autocomplete-commands.ts
rm -f apps/coding-agent/src/theme-names.ts
```

---

## Phase 2: Replace Autocomplete Overlay Rendering With `SelectList`

### Overview
Use `SelectList` to get width padding + scroll-window behavior (fixes stale characters + offscreen selection).

### Prerequisites
- [x] Phase 1 `bun run typecheck` passes

### Changes

#### 1. Update imports + remove unused Solid helpers
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: 6-16

**Before**:
```ts
import { render, useTerminalDimensions } from "@opentui/solid"
import { createSignal, createEffect, createMemo, For, Show, onCleanup, onMount, batch } from "solid-js"
import { ThemeProvider, ToastViewport, useRenderer, useTheme, type ToastItem } from "@marvin-agents/open-tui"
// ...
import { CombinedAutocompleteProvider, type AutocompleteItem } from "@marvin-agents/open-tui"
```

**After**:
```ts
import { render, useTerminalDimensions } from "@opentui/solid"
import { createSignal, createEffect, Show, onCleanup, onMount, batch } from "solid-js"
import { CombinedAutocompleteProvider, SelectList, ThemeProvider, ToastViewport, useRenderer, useTheme, type AutocompleteItem, type SelectItem, type ToastItem } from "@marvin-agents/open-tui"
```

**Why**: `For/createMemo` become unnecessary; `SelectList` replaces custom list rendering.

#### 2. Replace picker JSX block
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: 620-643

**Before**:
```tsx
			<Show when={showAutocomplete() && autocompleteItems().length > 0}>
				<box flexDirection="column" borderColor={theme.border} maxHeight={15} flexShrink={0}>
					<For each={autocompleteItems().filter(item => item && typeof item === "object")}>{(item, i) => {
						const isSelected = createMemo(() => i() === autocompleteIndex())
						const label = String(item.label ?? item.value ?? "")
						const descRaw = item.description
						// Truncate description from start to show relevant end (filename context)
						const maxDescLen = Math.max(0, dimensions().width - label.length - 8)
						const desc = typeof descRaw === "string" && descRaw && descRaw !== label
							? (descRaw.length > maxDescLen ? "…" + descRaw.slice(-(maxDescLen - 1)) : descRaw)
							: ""
						// Fixed-width label column for alignment
						const labelCol = label.length < 24 ? label + " ".repeat(24 - label.length) : label.slice(0, 23) + "…"
						return (
							<text>
								<span style={{ fg: isSelected() ? theme.accent : theme.textMuted }}>{isSelected() ? " ▸ " : "   "}</span>
								<span style={{ fg: isSelected() ? theme.text : theme.textMuted }}>{labelCol}</span>
								<span style={{ fg: theme.textMuted }}>{desc ? " " + desc : ""}</span>
							</text>
						)
					}}</For>
					<text fg={theme.textMuted}>{"   "}↑↓ navigate · Tab select · Esc cancel</text>
				</box>
			</Show>
```

**After**:
```tsx
			<Show when={showAutocomplete() && autocompleteItems().length > 0}>
				<box flexDirection="column" borderColor={theme.border} maxHeight={15} flexShrink={0}>
					<SelectList
						items={autocompleteItems().map((item): SelectItem => ({
							value: item.value,
							label: item.label,
							description: item.description,
						}))}
						selectedIndex={autocompleteIndex()}
						maxVisible={12}
						width={Math.max(10, dimensions().width - 2)}
					/>
					<text fg={theme.textMuted}>{"   "}↑↓ navigate · Tab select · Esc cancel</text>
				</box>
			</Show>
```

**Why**: `SelectList` pads each line to width and scrolls around selection, fixing repaint artifacts and offscreen selection.

#### 3. Keep selection index in-range when items change
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: 467-476

**Before**:
```ts
	const updateAutocomplete = (text: string, cursorLine: number, cursorCol: number) => {
		const result = autocompleteProvider.getSuggestions(text.split("\n"), cursorLine, cursorCol)
		if (result && result.items.length > 0) {
			// Show up to 30 items (covers all themes; files naturally limited by results)
			const prevPrefix = autocompletePrefix(), newItems = result.items.slice(0, 30)
			setAutocompleteItems(newItems); setAutocompletePrefix(result.prefix)
			if (result.prefix !== prevPrefix) setAutocompleteIndex(0); else setAutocompleteIndex((i) => Math.min(i, newItems.length - 1))
			setShowAutocomplete(true)
		} else { setShowAutocomplete(false); setAutocompleteItems([]) }
	}
```

**After** (add guard to avoid empty-line file listing; keep existing clamp):
```ts
	const updateAutocomplete = (text: string, cursorLine: number, cursorCol: number) => {
		const lines = text.split("\n")
		const currentLine = lines[cursorLine] ?? ""
		const beforeCursor = currentLine.slice(0, cursorCol)

		if (beforeCursor.trim() === "") {
			setShowAutocomplete(false); setAutocompleteItems([])
			return
		}

		const result = autocompleteProvider.getSuggestions(lines, cursorLine, cursorCol)
		if (result && result.items.length > 0) {
			// Show up to 30 items (covers all themes; files naturally limited by results)
			const prevPrefix = autocompletePrefix(), newItems = result.items.slice(0, 30)
			setAutocompleteItems(newItems); setAutocompletePrefix(result.prefix)
			if (result.prefix !== prevPrefix) setAutocompleteIndex(0); else setAutocompleteIndex((i) => Math.min(i, newItems.length - 1))
			setShowAutocomplete(true)
		} else { setShowAutocomplete(false); setAutocompleteItems([]) }
	}
```

**Why**: removing the gate (Phase 3) would otherwise allow file suggestions on an empty line; this keeps picker quiet unless cursor context has actual content.

### Edge Cases to Handle
- [ ] Very narrow terminal: `width` must not go negative (`Math.max(10, ...)`).
- [ ] Item list shrinks: selection index stays in range (existing clamp already handles).

### Success Criteria

**Automated:**
```bash
bun run typecheck
```

**Manual:**
- [ ] Rapid scrolling through themes never leaves stale characters.
- [ ] Selected item remains visible while scrolling beyond 12 items.

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/tui-app.tsx
```

---

## Phase 3: Triggering + “No Reopen After Apply”

### Overview
Make triggering cursor-context-based (not whole-buffer `startsWith`), and suppress the `onContentChange` re-trigger that happens after `replaceText()`.

### Prerequisites
- [x] Phase 2 `bun run typecheck` passes

### Changes

#### 1. Add one-shot suppression flag around programmatic edits
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: around 447-495

**Before**:
```ts
	const [showAutocomplete, setShowAutocomplete] = createSignal(false)

	const applyAutocomplete = () => {
		if (!showAutocomplete() || !textareaRef) return false
		const items = autocompleteItems(), idx = autocompleteIndex()
		if (idx < 0 || idx >= items.length) return false
		const cursor = textareaRef.logicalCursor
		const text = textareaRef.plainText, lines = text.split("\n")
		const result = autocompleteProvider.applyCompletion(lines, cursor.row, cursor.col, items[idx]!, autocompletePrefix())
		const newText = result.lines.join("\n")
		// If completion wouldn't change text, close autocomplete but return false to allow Enter to pass through
		if (newText === text) {
			setShowAutocomplete(false); setAutocompleteItems([])
			return false
		}
		textareaRef.replaceText(newText)
		textareaRef.editBuffer.setCursorToLineCol(result.cursorLine, result.cursorCol)
		setShowAutocomplete(false); setAutocompleteItems([])
		return true
	}
```

**After**:
```ts
	const [showAutocomplete, setShowAutocomplete] = createSignal(false)
	let suppressNextAutocompleteUpdate = false

	const applyAutocomplete = () => {
		if (!showAutocomplete() || !textareaRef) return false
		const items = autocompleteItems(), idx = autocompleteIndex()
		if (idx < 0 || idx >= items.length) return false
		const cursor = textareaRef.logicalCursor
		const text = textareaRef.plainText, lines = text.split("\n")
		const result = autocompleteProvider.applyCompletion(lines, cursor.row, cursor.col, items[idx]!, autocompletePrefix())
		const newText = result.lines.join("\n")
		// If completion wouldn't change text, close autocomplete but return false to allow Enter to pass through
		if (newText === text) {
			setShowAutocomplete(false); setAutocompleteItems([])
			return false
		}
		suppressNextAutocompleteUpdate = true
		textareaRef.replaceText(newText)
		textareaRef.editBuffer.setCursorToLineCol(result.cursorLine, result.cursorCol)
		setShowAutocomplete(false); setAutocompleteItems([])
		return true
	}
```

**Why**: prevents picker reopening on the `onContentChange` that follows `replaceText()`.

#### 2. Remove whole-buffer gate; update autocomplete on every content change
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: 650

**Before**:
```tsx
					onContentChange={() => { if (textareaRef) { const text = textareaRef.plainText; if (!text.startsWith("/") && !text.includes("@")) { setShowAutocomplete(false); return }; const cursor = textareaRef.logicalCursor; updateAutocomplete(text, cursor.row, cursor.col) } }}
```

**After**:
```tsx
					onContentChange={() => {
						if (!textareaRef) return
						if (suppressNextAutocompleteUpdate) {
							suppressNextAutocompleteUpdate = false
							return
						}
						const text = textareaRef.plainText
						const cursor = textareaRef.logicalCursor
						updateAutocomplete(text, cursor.row, cursor.col)
					}}
```

**Why**: cursor context decides; multiline `/theme` is now consistent.

### Edge Cases to Handle
- [ ] Ensure picker closes when suppression triggers (apply already closes it).

### Success Criteria

**Automated:**
```bash
bun run typecheck
```

**Manual:**
- [ ] `/theme` on line 2 triggers picker.
- [ ] After Tab-select, picker stays closed.

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/tui-app.tsx
```

---

## Phase 4: Regression Tests

### Overview
Add targeted unit tests for `/theme` behavior + theme completion list source.

### Prerequisites
- [x] Phase 3 `bun run typecheck` passes

### Changes

#### 1. Add `/theme` tests
**File**: `apps/coding-agent/tests/commands.test.ts`
**Lines**: append near other slash command tests

**Add**:
```ts
	describe("/theme", () => {
		it("lists themes when no args", () => {
			const ctx = createMockContext()
			const ok = handleSlashCommand("/theme", ctx)
			expect(ok).toBe(true)
			expect(ctx.setMessages).toHaveBeenCalled()
		})

		it("sets theme when valid", () => {
			const setTheme = mock(() => {})
			const ctx = createMockContext({ setTheme })
			const ok = handleSlashCommand("/theme aura", ctx)
			expect(ok).toBe(true)
			expect(setTheme).toHaveBeenCalledWith("aura")
		})

		it("rejects unknown theme", () => {
			const setTheme = mock(() => {})
			const ctx = createMockContext({ setTheme })
			const ok = handleSlashCommand("/theme not-a-theme", ctx)
			expect(ok).toBe(true)
			expect(setTheme).not.toHaveBeenCalled()
		})
	})
```

**Why**: validates that `/theme` remains functional and properly validates theme names.

#### 2. Add theme completion tests (optional but recommended)
**File**: `apps/coding-agent/tests/autocomplete-commands.test.ts`
**Lines**: new file

**Add**:
```ts
import { describe, expect, it } from "bun:test"
import { createAutocompleteCommands } from "../src/autocomplete-commands.js"

describe("autocomplete /theme", () => {
	it("suggests built-in themes", () => {
		const cmds = createAutocompleteCommands(() => ({ currentProvider: "openai" as any }))
		const theme = cmds.find((c) => c.name === "theme")
		expect(theme).toBeTruthy()
		const items = theme!.getArgumentCompletions!("a")
		expect(items.some((i) => i.value === "aura")).toBe(true)
	})
})
```

**Why**: ensures theme completions stay aligned with the real theme list.

### Success Criteria

**Automated:**
```bash
bun run test
```

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/tests/commands.test.ts
rm -f apps/coding-agent/tests/autocomplete-commands.test.ts
```

---

## Testing Strategy

### Unit
- `/theme` command behavior (valid/invalid/list).
- Theme autocomplete suggestions include known builtin theme (e.g. `aura`).

### Manual
- Reproduce screenshot conditions: long list navigation, rerender, selection past visible region.

## Anti-Patterns to Avoid
- Reintroducing hardcoded theme arrays in multiple places.
- Rendering variable-length picker rows without explicit padding.
- Whole-buffer gates (`text.startsWith("/")`) that break multiline editing.

## Open Questions
None.

## References
- Current picker UI: `apps/coding-agent/src/tui-app.tsx:620`
- Trigger gate: `apps/coding-agent/src/tui-app.tsx:650`
- Programmatic apply: `apps/coding-agent/src/tui-app.tsx:478`
- Theme source of truth: `packages/open-tui/src/context/theme.tsx:54`
- `SelectList` padding/scrolling: `packages/open-tui/src/components/select-list.tsx:176`

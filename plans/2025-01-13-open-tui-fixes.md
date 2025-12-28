# open-tui Bug Fixes and Improvements Implementation Plan

## Plan Metadata
- Created: 2025-01-13
- Ticket: N/A (internal quality improvements)
- Status: complete
- Owner: yesh
- Assumptions:
  - Bun runtime is required (already in package.json engines)
  - OSC 52 clipboard support cannot be verified synchronously
  - Image protocol detection is already correct; only rendering logic needs fixes

## Progress Tracking
- [x] Phase 1: Quick Wins (5 items)
- [x] Phase 2: Component Improvements (4 items)
- [x] Phase 3: Larger Work (3 items)

## Overview
Address correctness, reliability, and UX issues in the open-tui package identified during code review. Fixes range from one-line patches to component overhauls, organized by effort and impact.

## Current State

### Key Discoveries

1. **Autocomplete @ prefix leak** (`packages/open-tui/src/autocomplete/autocomplete.ts:366`)
```typescript
// getFuzzyFileSuggestions always prepends @ regardless of context
return {
  value: `@${String(entryPath)}`,
  label: String(entryName) + (isDirectory ? "/" : ""),
  description: String(pathWithoutSlash),
}
```
Called from `getFileSuggestions` for relative paths (line 236), which is used for both `@` completions and plain path completions.

2. **ThemeProvider mode not synced** (`packages/open-tui/src/context/theme.tsx:351-355`)
```typescript
// Only themeName is synced, mode is ignored after mount
createEffect(() => {
  if (props.themeName !== undefined && props.themeName !== store.themeName) {
    setStore("themeName", props.themeName)
  }
})
```

3. **Image keying issues** (`packages/open-tui/src/components/image.tsx:200`)
```typescript
// renderedImages uses stable imageId, not content-based key
const [imageId] = createSignal(`img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
// ...
const renderedImages = new Set<string>()
```

4. **text-width Segmenter per call** (`packages/open-tui/src/utils/text-width.ts:33`)
```typescript
function parseTextSegments(text: string): TextSegment[] {
  const segmenter = new Intl.Segmenter() // Created every call
```

5. **copyToClipboard returns true for OSC 52** (`packages/open-tui/src/utils/clipboard.ts:18-20`)
```typescript
process.stdout.write(osc52)
// ...
return true // No way to verify OSC 52 worked
```

## Desired End State

### Verification
```bash
bun run typecheck                    # Zero type errors
bun test packages/open-tui           # All tests pass
bun run packages/open-tui/examples/demo.tsx  # Demo renders correctly
```

### Manual Observable Behavior
- Path completion without `@` prefix returns paths without `@`
- Theme mode changes (dark↔light) apply immediately
- Image re-renders when dimensions change
- Editor value prop syncs bidirectionally
- Clipboard returns false when unsure of success

## Out of Scope
- Incremental tree-sitter parsing for Markdown/CodeBlock
- Image render queue/scheduler integration (requires opentui core changes)
- SelectList fuzzy highlight (cosmetic only)
- FileIndex async readdirSync (only affects absolute paths, rare path)

## Breaking Changes
None. All changes are additive or fix incorrect behavior.

## Dependency and Configuration Changes
None required.

## Error Handling Strategy
- Clipboard: Return `false` for unknown outcomes; caller decides fallback
- Image: Fall back to text placeholder on dimension parse failure (already exists)
- FileIndex: Silent degradation already in place; no changes needed

## Implementation Approach
Three phases ordered by effort and dependency:
1. **Phase 1**: Isolated one-file fixes with no cross-component impact
2. **Phase 2**: Component improvements requiring coordination between files
3. **Phase 3**: Larger refactors with test coverage requirements

## Phase Dependencies and Parallelization
- Dependencies: None between phases; all are independent
- Parallelizable: All 3 phases can run in parallel with separate agents
- Suggested @agents:
  - Agent A: Phase 1 (quick fixes)
  - Agent B: Phase 2 (component improvements)
  - Agent C: Phase 3 (image + tests + demo)

---

## Phase 1: Quick Wins

### Overview
Five isolated fixes that each touch a single file with minimal risk. Can be committed individually.

### Prerequisites
- [ ] Codebase builds: `bun run typecheck` passes

### Change Checklist
- [x] 1.1 Fix autocomplete @ prefix leak
- [x] 1.2 Add ThemeProvider mode sync effect
- [x] 1.3 Add README.md
- [x] 1.4 Fix copyToClipboard return value and add Linux fallback
- [x] 1.5 Cache Intl.Segmenter in text-width

### Changes

#### 1.1 Fix autocomplete @ prefix leak
**File**: `packages/open-tui/src/autocomplete/autocomplete.ts`
**Location**: lines 230-240 and 358-370

**Context**: `getFileSuggestions` is called from two paths:
1. When prefix starts with `@` (line 73) — should return `@path`
2. When prefix is a relative path without `@` (line 136) — should return `path`

Currently `getFuzzyFileSuggestions` always adds `@`, breaking case 2.

**Before** (line 232-239):
```typescript
// For relative paths, use index-backed fuzzy search (respects .gitignore)
const isAbsoluteOrHome = expandedPrefix.startsWith("/") || prefix.startsWith("~")
if (!isAbsoluteOrHome) {
  return this.getFuzzyFileSuggestions(expandedPrefix)
}
```

**After**:
```typescript
// For relative paths, use index-backed fuzzy search (respects .gitignore)
const isAbsoluteOrHome = expandedPrefix.startsWith("/") || prefix.startsWith("~")
if (!isAbsoluteOrHome) {
  return this.getFuzzyFileSuggestions(expandedPrefix, isAtPrefix)
}
```

**Before** (line 358-370):
```typescript
// Fuzzy file search using ripgrep + fuzzysort (fast, respects .gitignore)
private getFuzzyFileSuggestions(query: string): AutocompleteItem[] {
  const results = this.fileIndex.search(query, { limit: 20, includeDirs: true })

  return results
    .filter((r) => r.path != null) // Guard against malformed results
    .map(({ path: entryPath, isDirectory }) => {
      const pathWithoutSlash = isDirectory ? entryPath.slice(0, -1) : entryPath
      const entryName = basename(pathWithoutSlash)

      return {
        value: `@${String(entryPath)}`,
        label: String(entryName) + (isDirectory ? "/" : ""),
        description: String(pathWithoutSlash),
      }
    })
}
```

**After**:
```typescript
// Fuzzy file search using ripgrep + fuzzysort (fast, respects .gitignore)
private getFuzzyFileSuggestions(query: string, includeAtPrefix: boolean = true): AutocompleteItem[] {
  const results = this.fileIndex.search(query, { limit: 20, includeDirs: true })

  return results
    .filter((r) => r.path != null) // Guard against malformed results
    .map(({ path: entryPath, isDirectory }) => {
      const pathWithoutSlash = isDirectory ? entryPath.slice(0, -1) : entryPath
      const entryName = basename(pathWithoutSlash)
      const value = includeAtPrefix ? `@${String(entryPath)}` : String(entryPath)

      return {
        value,
        label: String(entryName) + (isDirectory ? "/" : ""),
        description: String(pathWithoutSlash),
      }
    })
}
```

**Why**: The `@` prefix should only appear when the user typed `@` to start the completion.

---

#### 1.2 Add ThemeProvider mode sync effect
**File**: `packages/open-tui/src/context/theme.tsx`
**Location**: lines 351-355

**Before**:
```typescript
// Sync themeName prop changes to store (for external control)
createEffect(() => {
  if (props.themeName !== undefined && props.themeName !== store.themeName) {
    setStore("themeName", props.themeName)
  }
})
```

**After**:
```typescript
// Sync themeName prop changes to store (for external control)
createEffect(() => {
  if (props.themeName !== undefined && props.themeName !== store.themeName) {
    setStore("themeName", props.themeName)
  }
})

// Sync mode prop changes to store (for external light/dark toggle)
createEffect(() => {
  if (props.mode !== undefined && props.mode !== store.mode) {
    setStore("mode", props.mode)
  }
})
```

**Why**: External components (system theme detection, user preferences) may update `mode` prop after mount.

---

#### 1.3 Add README.md
**File**: `packages/open-tui/README.md`
**Location**: new file

**Content**:
```markdown
# @marvin-agents/open-tui

A Terminal User Interface library built on [OpenTUI](https://github.com/anthropics/opentui) with SolidJS reactive rendering.

## Installation

```bash
bun add @marvin-agents/open-tui
```

## Quick Start

```tsx
import { render } from "@opentui/solid"
import { ThemeProvider, useTheme, Markdown, Panel } from "@marvin-agents/open-tui"

function App() {
  const { theme } = useTheme()
  
  return (
    <Panel variant="panel" padding={1}>
      <Markdown text="# Hello World\n\nThis is **bold** text." />
    </Panel>
  )
}

render(
  () => (
    <ThemeProvider mode="dark" themeName="tokyonight">
      <App />
    </ThemeProvider>
  ),
  { exitOnCtrlC: true }
)
```

## Components

### Layout
- `Panel` - Bordered container with theme variants
- `Dialog` - Modal overlay with backdrop
- `Spacer` - Flexible space filler
- `Divider` - Horizontal/vertical separator

### Content
- `Markdown` - Tree-sitter highlighted markdown
- `CodeBlock` - Syntax-highlighted code with line numbers
- `Diff` - Unified/split diff view
- `Image` - Kitty/iTerm2 inline images

### Input
- `Editor` - Multi-line text input
- `Input` - Single-line text input
- `SelectList` - Filterable selection list

### Feedback
- `Loader` - Animated spinner
- `Toast` / `ToastViewport` - Notification toasts
- `Badge` - Status badges

## Theming

### Built-in Themes
```tsx
<ThemeProvider themeName="dracula" mode="dark">
```

Available themes: `aura`, `ayu`, `catppuccin`, `cobalt2`, `dracula`, `everforest`, 
`flexoki`, `github`, `gruvbox`, `kanagawa`, `material`, `monokai`, `nightowl`, 
`nord`, `one-dark`, `palenight`, `rosepine`, `solarized`, `synthwave84`, 
`tokyonight`, `vercel`, `vesper`, `zenburn`, and more.

### Custom Theme Overrides
```tsx
<ThemeProvider 
  themeName="dracula"
  customTheme={{ primary: parseColor("#ff79c6") }}
>
```

### Accessing Theme
```tsx
function MyComponent() {
  const { theme, mode, setMode, themeName, setTheme } = useTheme()
  
  return <text fg={theme.primary}>Themed text</text>
}
```

## Tree-sitter Setup

For syntax highlighting, configure parsers before rendering:

```tsx
import { configureParsers } from "@marvin-agents/open-tui"

await configureParsers({
  languages: ["typescript", "python", "markdown"],
  wasmPath: "./parsers" // Path to .wasm files
})
```

## Autocomplete

```tsx
import { CombinedAutocompleteProvider } from "@marvin-agents/open-tui"

const provider = new CombinedAutocompleteProvider(
  [{ name: "help", description: "Show help" }],
  process.cwd()
)

// Get suggestions
const suggestions = provider.getSuggestions(lines, cursorLine, cursorCol)

// Apply completion
const result = provider.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
```

## License

MIT
```

**Why**: Package.json lists README.md in `files` but it doesn't exist. Users need basic documentation.

---

#### 1.4 Fix copyToClipboard return value and add Linux fallback
**File**: `packages/open-tui/src/utils/clipboard.ts`
**Location**: entire file (small)

**Before**:
```typescript
/**
 * Clipboard utilities for terminal applications
 * Uses OSC 52 escape sequence for broad terminal support
 */

import { spawnSync } from "node:child_process"

/**
 * Copy text to clipboard using OSC 52 escape sequence
 * Falls back to pbcopy on macOS if OSC 52 fails
 */
export function copyToClipboard(text: string): boolean {
	if (!text) return false

	// Try OSC 52 first (works in iTerm2, kitty, Ghostty, tmux with set-clipboard on, etc.)
	const base64 = Buffer.from(text).toString("base64")
	const osc52 = `\x1b]52;c;${base64}\x07`
	process.stdout.write(osc52)

	// Also try pbcopy on macOS as fallback (OSC 52 may be disabled or unsupported)
	if (process.platform === "darwin") {
		try {
			const result = spawnSync("pbcopy", { input: text, encoding: "utf-8" })
			return result.status === 0
		} catch {
			// pbcopy not available, OSC 52 was our only attempt
		}
	}

	return true
}
```

**After**:
```typescript
/**
 * Clipboard utilities for terminal applications
 * Uses native clipboard commands with OSC 52 fallback
 */

import { spawnSync } from "node:child_process"

/**
 * Copy text to clipboard using platform-native commands
 * Falls back to OSC 52 escape sequence for terminal support
 * 
 * @returns true if clipboard command succeeded, false if only OSC 52 was attempted
 */
export function copyToClipboard(text: string): boolean {
	if (!text) return false

	// Try platform-native clipboard first (verifiable)
	if (process.platform === "darwin") {
		try {
			const result = spawnSync("pbcopy", { input: text, encoding: "utf-8" })
			if (result.status === 0) return true
		} catch {
			// pbcopy not available
		}
	} else if (process.platform === "linux") {
		// Try xclip first, then xsel, then wl-copy (Wayland)
		const tools = [
			["xclip", ["-selection", "clipboard"]],
			["xsel", ["--clipboard", "--input"]],
			["wl-copy"],
		] as const

		for (const [cmd, args = []] of tools) {
			try {
				const result = spawnSync(cmd, args, { input: text, encoding: "utf-8" })
				if (result.status === 0) return true
			} catch {
				// Tool not available, try next
			}
		}
	}

	// Fall back to OSC 52 (works in iTerm2, kitty, Ghostty, tmux with set-clipboard on)
	// Note: We cannot verify if OSC 52 succeeded
	const base64 = Buffer.from(text).toString("base64")
	const osc52 = `\x1b]52;c;${base64}\x07`
	process.stdout.write(osc52)

	// Return false to indicate we couldn't verify success
	return false
}
```

**Why**: 
1. Returning `true` unconditionally is incorrect when we can't verify OSC 52 worked
2. Linux users had no fallback at all
3. Try native tools first since they're verifiable

---

#### 1.5 Cache Intl.Segmenter in text-width
**File**: `packages/open-tui/src/utils/text-width.ts`
**Location**: line 33

**Before** (line 27-46):
```typescript
interface TextSegment {
	type: "ansi" | "grapheme"
	value: string
}

/**
 * Parse text into segments of ANSI codes and graphemes
 */
function parseTextSegments(text: string): TextSegment[] {
	const segmenter = new Intl.Segmenter()
	const segments: TextSegment[] = []
	let i = 0
```

**After**:
```typescript
interface TextSegment {
	type: "ansi" | "grapheme"
	value: string
}

// Cache segmenter instance - it's stateless and reusable
const graphemeSegmenter = new Intl.Segmenter()

/**
 * Parse text into segments of ANSI codes and graphemes
 */
function parseTextSegments(text: string): TextSegment[] {
	const segments: TextSegment[] = []
	let i = 0
```

**Also update** the usage on line ~52:
```typescript
// Before
for (const seg of segmenter.segment(textPortion)) {

// After
for (const seg of graphemeSegmenter.segment(textPortion)) {
```

**Why**: `Intl.Segmenter` is stateless. Creating one per call wastes memory and GC cycles on hot paths.

---

### Edge Cases to Handle
- [ ] Autocomplete with empty query: returns first N files (unchanged behavior)
- [ ] Theme mode undefined: keeps current mode (handled by condition)
- [ ] Clipboard with empty string: returns false early (unchanged)
- [ ] Text-width with empty string: returns empty array (unchanged)

### Success Criteria

**Automated** (run after each change):
```bash
bun run typecheck                    # Zero type errors
bun test packages/open-tui           # Existing tests pass
```

**Before proceeding to Phase 2**:
```bash
bun run check                        # Full lint + typecheck
```

**Manual**:
- [ ] Type `src/` in editor, get completions without `@` prefix
- [ ] Type `@src/` in editor, get completions with `@` prefix
- [ ] Verify README renders correctly on GitHub

### Rollback
```bash
git restore -- packages/open-tui/src/autocomplete/autocomplete.ts \
               packages/open-tui/src/context/theme.tsx \
               packages/open-tui/src/utils/clipboard.ts \
               packages/open-tui/src/utils/text-width.ts \
               packages/open-tui/README.md
```

### Notes
_Space for implementer discoveries_

---

## Phase 2: Component Improvements

### Overview
Four component improvements requiring coordination but still isolated to single files each.

### Prerequisites
- [ ] Phase 1 automated checks pass (or running in parallel)
- [ ] Codebase builds: `bun run typecheck` passes

### Change Checklist
- [x] 2.1 Add Editor value prop with sync
- [x] 2.2 Add Dialog ESC handling
- [x] 2.3 Add ToastViewport auto-dismiss
- [x] 2.4 Add Loader theme awareness

### Changes

#### 2.1 Add Editor value prop with sync
**File**: `packages/open-tui/src/components/editor.tsx`
**Location**: lines 25-50 and 90-100

**Add to EditorProps interface** (after line 30):
```typescript
export interface EditorProps {
	/** Initial text content */
	initialValue?: string
	/** Controlled value - syncs bidirectionally */
	value?: string
	/** Placeholder text when empty */
	placeholder?: string
```

**Add sync effect** (after line 78, inside the component):
```typescript
// Sync external value changes to textarea
createEffect(() => {
	if (props.value !== undefined && textareaRef) {
		const currentText = textareaRef.plainText ?? ""
		if (props.value !== currentText) {
			textareaRef.setText(props.value)
		}
	}
})
```

**Update initialValue logic** (line 118-121):
```typescript
// Before
if (props.initialValue !== undefined) {
	// biome-ignore lint/complexity/useLiteralKeys: dynamic prop assignment
	textareaProps["initialValue"] = props.initialValue
}

// After
if (props.value !== undefined) {
	// Controlled mode - use value as initial
	// biome-ignore lint/complexity/useLiteralKeys: dynamic prop assignment
	textareaProps["initialValue"] = props.value
} else if (props.initialValue !== undefined) {
	// biome-ignore lint/complexity/useLiteralKeys: dynamic prop assignment
	textareaProps["initialValue"] = props.initialValue
}
```

**Why**: Allows parent components to control editor content, essential for undo/redo and state sync.

---

#### 2.2 Add Dialog ESC handling
**File**: `packages/open-tui/src/components/dialog.tsx`
**Location**: lines 1-10 and 20-25

**Update imports** (line 1-5):
```typescript
// Before
import { TextAttributes } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { Show, splitProps } from "solid-js"

// After
import { TextAttributes } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { useKeyboard } from "@opentui/solid"
import { createEffect, Show, splitProps } from "solid-js"
```

**Add keyboard handling** (after line 22, inside the component before the return):
```typescript
// Handle ESC to close dialog
createEffect(() => {
	if (!local.open) return

	// Only register keyboard handler when dialog is open
	useKeyboard({
		onKey: (e) => {
			if (e.name === "escape") {
				e.preventDefault()
				local.onClose?.()
			}
		},
	})
})
```

**Actually, better approach** - use conditional rendering pattern:

**After** (replace lines 21-24):
```typescript
export function Dialog(props: DialogProps): JSX.Element {
	const { theme } = useTheme()
	const [local, rest] = splitProps(props, ["open", "title", "borderColor", "onClose", "children"])

	return (
		<Show when={local.open}>
			<DialogContent {...local} theme={theme} rest={rest} />
		</Show>
	)
}

function DialogContent(props: {
	title?: string
	borderColor?: RGBA
	onClose?: () => void
	children?: JSX.Element
	theme: Theme
	rest: Record<string, unknown>
}): JSX.Element {
	// Handle ESC to close - only active when dialog is mounted
	useKeyboard({
		onKey: (e) => {
			if (e.name === "escape") {
				e.preventDefault()
				props.onClose?.()
			}
		},
	})

	return (
		<box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={900}>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: overlay only handles click-to-dismiss */}
			<box
				position="absolute"
				top={0}
				left={0}
				width="100%"
				height="100%"
				backgroundColor={props.theme.background}
				opacity={0.8}
				onMouseUp={() => props.onClose?.()}
			/>
			<box
				position="absolute"
				top="15%"
				left="15%"
				width="70%"
				maxHeight="70%"
				zIndex={901}
				{...props.rest}
			>
				<Panel
					variant="panel"
					borderColor={props.borderColor ?? props.theme.borderActive}
					paddingX={2}
					paddingY={1}
				>
					<Show when={props.title}>
						<text fg={props.theme.text} attributes={TextAttributes.BOLD}>
							{props.title}
						</text>
						<box height={1} />
					</Show>
					{props.children}
				</Panel>
			</box>
		</box>
	)
}
```

**Add type import**:
```typescript
import { type RGBA, type Theme, useTheme } from "../context/theme.js"
```

**Why**: Dialogs should close on ESC by convention. Extracting to inner component ensures keyboard handler is only active when dialog is visible.

---

#### 2.3 Add ToastViewport auto-dismiss
**File**: `packages/open-tui/src/components/toast.tsx`
**Location**: multiple locations

**Update ToastItem interface** (after line 12):
```typescript
// Before
export interface ToastItem {
	id: string
	title: string
	message?: string
	variant?: ToastVariant
}

// After
export interface ToastItem {
	id: string
	title: string
	message?: string
	variant?: ToastVariant
	/** Auto-dismiss duration in ms. Set to 0 or undefined for persistent. */
	duration?: number
}
```

**Update ToastViewportProps** (after line 19):
```typescript
// Before
export type ToastViewportProps = Omit<JSX.IntrinsicElements["box"], "children"> & {
	toasts: ToastItem[]
	position?: ToastViewportPosition
	maxToasts?: number
}

// After
export type ToastViewportProps = Omit<JSX.IntrinsicElements["box"], "children"> & {
	toasts: ToastItem[]
	position?: ToastViewportPosition
	maxToasts?: number
	/** Default duration for toasts without explicit duration (ms). Default: 5000. Set to 0 for no auto-dismiss. */
	defaultDuration?: number
	/** Called when a toast should be dismissed */
	onDismiss?: (id: string) => void
}
```

**Update imports** (line 1):
```typescript
// Before
import type { JSX } from "@opentui/solid"
import { For, Show, splitProps } from "solid-js"

// After
import type { JSX } from "@opentui/solid"
import { createEffect, For, onCleanup, Show, splitProps } from "solid-js"
```

**Update ToastViewport function** (line 23-47):
```typescript
export function ToastViewport(props: ToastViewportProps): JSX.Element {
	const [local, rest] = splitProps(props, ["toasts", "position", "maxToasts", "defaultDuration", "onDismiss"])

	const position = () => local.position ?? "top-right"
	const maxToasts = () => local.maxToasts ?? 3
	const defaultDuration = () => local.defaultDuration ?? 5000

	// Auto-dismiss timers
	createEffect(() => {
		if (!local.onDismiss) return

		const timers: ReturnType<typeof setTimeout>[] = []

		for (const toast of local.toasts) {
			const duration = toast.duration ?? defaultDuration()
			if (duration > 0) {
				const timer = setTimeout(() => {
					local.onDismiss?.(toast.id)
				}, duration)
				timers.push(timer)
			}
		}

		onCleanup(() => {
			for (const timer of timers) {
				clearTimeout(timer)
			}
		})
	})

	const anchorProps = (): Pick<
		JSX.IntrinsicElements["box"],
		"top" | "right" | "bottom" | "left"
	> => {
		switch (position()) {
			case "top-left":
				return { top: 1, left: 2 }
			case "bottom-left":
				return { bottom: 1, left: 2 }
			case "bottom-right":
				return { bottom: 1, right: 2 }
			default:
				return { top: 1, right: 2 }
		}
	}

	return (
		<box
			position="absolute"
			zIndex={1000}
			flexDirection="column"
			gap={1}
			{...anchorProps()}
			{...rest}
		>
			<For each={local.toasts.slice(0, maxToasts())}>{(toast) => <Toast toast={toast} />}</For>
		</box>
	)
}
```

**Why**: Toasts should auto-dismiss by default. The `onDismiss` callback lets parent manage toast list state.

---

#### 2.4 Add Loader theme awareness
**File**: `packages/open-tui/src/components/loader.tsx`
**Location**: lines 1-15 and 25-30

**Update imports** (line 6):
```typescript
// Before
import { parseColor, type RGBA } from "@opentui/core"
import "opentui-spinner/solid"
import { Show } from "solid-js"

// After
import type { RGBA } from "@opentui/core"
import "opentui-spinner/solid"
import { Show } from "solid-js"
import { useTheme } from "../context/theme.js"
```

**Update component** (line 23-35):
```typescript
// Before
const DEFAULT_FRAMES = ["    ", ".   ", "..  ", "... ", "....", " ...", "  ..", "   ."]
const DEFAULT_COLOR = parseColor("#64b4ff")

export function Loader(props: LoaderProps) {
	const interval = () => props.interval ?? 120
	const color = () => props.color ?? DEFAULT_COLOR

	return (
		<box flexDirection="row" gap={1}>
			<spinner frames={DEFAULT_FRAMES} interval={interval()} color={color()} />
			<Show when={props.message && props.dimColor}>
				<text fg={props.dimColor!}>{props.message}</text>
			</Show>
			<Show when={props.message && !props.dimColor}>
				<text>{props.message}</text>
			</Show>
		</box>
	)
}

// After
const DEFAULT_FRAMES = ["    ", ".   ", "..  ", "... ", "....", " ...", "  ..", "   ."]

export function Loader(props: LoaderProps) {
	const { theme } = useTheme()
	const interval = () => props.interval ?? 120
	const color = () => props.color ?? theme.primary
	const dimColor = () => props.dimColor ?? theme.textMuted

	return (
		<box flexDirection="row" gap={1}>
			<spinner frames={DEFAULT_FRAMES} interval={interval()} color={color()} />
			<Show when={props.message}>
				<text fg={dimColor()}>{props.message}</text>
			</Show>
		</box>
	)
}
```

**Update LoaderProps** to document theme usage:
```typescript
export interface LoaderProps {
	/** Message to display alongside spinner */
	message?: string
	/** Spinner color. Defaults to theme.primary */
	color?: RGBA
	/** Message text color. Defaults to theme.textMuted */
	dimColor?: RGBA
	/** Animation interval in ms */
	interval?: number
	/** Custom spinner frames */
	frames?: string[]
}
```

**Add frames prop support**:
```typescript
const frames = () => props.frames ?? DEFAULT_FRAMES
// ...
<spinner frames={frames()} interval={interval()} color={color()} />
```

**Why**: Components should use theme colors by default for consistency. Also adds `frames` prop for customization.

---

### Edge Cases to Handle
- [ ] Editor value=undefined: falls back to initialValue behavior
- [ ] Dialog onClose=undefined: ESC does nothing (no crash)
- [ ] Toast duration=0: never auto-dismisses
- [ ] Loader no ThemeProvider: will throw (documented behavior)

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/open-tui
```

**Manual**:
- [ ] Editor with `value` prop updates when value changes externally
- [ ] Dialog closes on ESC press
- [ ] Toast disappears after 5 seconds (default)
- [ ] Loader uses theme.primary color when no color prop given

### Rollback
```bash
git restore -- packages/open-tui/src/components/editor.tsx \
               packages/open-tui/src/components/dialog.tsx \
               packages/open-tui/src/components/toast.tsx \
               packages/open-tui/src/components/loader.tsx
```

### Notes
_Space for implementer discoveries_

---

## Phase 3: Larger Work

### Overview
Image component overhaul, test coverage, and demo expansion. Highest effort but important for reliability.

### Prerequisites
- [ ] Codebase builds: `bun run typecheck` passes

### Change Checklist
- [x] 3.1 Image component overhaul
- [x] 3.2 Add autocomplete tests
- [x] 3.3 Expand demo with new components

### Changes

#### 3.1 Image component overhaul
**File**: `packages/open-tui/src/components/image.tsx`
**Location**: multiple sections

**Issues to fix**:
1. `maxHeight` prop is declared but unused
2. Width is hard-capped to 80 regardless of `maxWidth`
3. `renderedImages` dedupes by stable id, not content — image won't re-render if data changes
4. No terminal resize handling

**Update imports** (line 1-3):
```typescript
// Before
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"

// After
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTerminalDimensions } from "../context/terminal.js"
```

**Fix renderResult to use maxHeight and dynamic maxWidth** (line 206-232):

**Before**:
```typescript
const maxWidth = () => props.maxWidth ?? 60

// Render image or fallback
const renderResult = createMemo(() => {
	if (!caps.images) {
		return {
			type: "fallback" as const,
			text: imageFallback(props.mimeType, dimensions(), props.filename),
		}
	}

	const width = Math.min(maxWidth(), 80)
	const rows = calculateRows(dimensions(), width)
```

**After**:
```typescript
const termDimensions = useTerminalDimensions()
const maxWidth = () => Math.min(props.maxWidth ?? 60, termDimensions().width - 4)
const maxHeight = () => props.maxHeight ?? 24

// Render image or fallback
const renderResult = createMemo(() => {
	if (!caps.images) {
		return {
			type: "fallback" as const,
			text: imageFallback(props.mimeType, dimensions(), props.filename),
		}
	}

	const width = maxWidth()
	let rows = calculateRows(dimensions(), width)
	
	// Clamp to maxHeight
	if (rows > maxHeight()) {
		rows = maxHeight()
	}
```

**Fix image cache key to include dimensions** (line 198-202):

**Before**:
```typescript
// Generate unique ID for this image instance
const [imageId] = createSignal(`img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
```

**After**:
```typescript
// Generate content-based key for caching (re-render if data or size changes)
const imageKey = createMemo(() => {
	const dims = dimensions()
	const mw = maxWidth()
	const mh = maxHeight()
	// Use first 16 chars of data hash + dimensions for key
	const dataPrefix = props.data.slice(0, 32)
	return `img-${dataPrefix}-${dims.widthPx}x${dims.heightPx}-${mw}x${mh}`
})
```

**Update writeImageToStdout call** (line 240-245):

**Before**:
```typescript
createEffect(() => {
	const result = renderResult()
	if (result.type === "image") {
		// Small delay to ensure the box has been rendered and positioned
		setTimeout(() => {
			writeImageToStdout(result.sequence, result.rows, imageId())
		}, 50)
	}
})
```

**After**:
```typescript
createEffect(() => {
	const result = renderResult()
	const key = imageKey()
	if (result.type === "image") {
		// Small delay to ensure the box has been rendered and positioned
		setTimeout(() => {
			writeImageToStdout(result.sequence, result.rows, key)
		}, 50)
	}
})

// Cleanup: remove from rendered set when component unmounts or key changes
onCleanup(() => {
	renderedImages.delete(imageKey())
})
```

**Add resize effect** (after the existing createEffect):
```typescript
// Re-render on terminal resize
createEffect(() => {
	// Track terminal dimensions to trigger re-render
	const _ = termDimensions()
	const key = imageKey()
	// Remove from cache to force re-render
	renderedImages.delete(key)
})
```

**Update the reserved space box** (line 251-253):

**Before**:
```typescript
<box height={(renderResult() as { type: "image"; rows: number }).rows}>
	<text fg={theme.textMuted}>{`[Image: ${props.mimeType}]`}</text>
</box>
```

**After**:
```typescript
<box height={(renderResult() as { type: "image"; rows: number }).rows} width={maxWidth()}>
	<text fg={theme.textMuted}>{" ".repeat(maxWidth())}</text>
</box>
```

**Why**: The image component needs to respond to dimension changes and respect both width and height constraints.

---

#### 3.2 Add autocomplete tests
**File**: `packages/open-tui/tests/autocomplete.test.ts`
**Location**: new file

**Content**:
```typescript
import { describe, expect, it, beforeEach, mock } from "bun:test"
import { CombinedAutocompleteProvider } from "../src/autocomplete/autocomplete"

// Mock the file index to avoid filesystem dependencies
const mockSearch = mock(() => [
	{ path: "src/index.ts", isDirectory: false, score: 1 },
	{ path: "src/utils/", isDirectory: true, score: 0.9 },
	{ path: "package.json", isDirectory: false, score: 0.8 },
])

describe("CombinedAutocompleteProvider", () => {
	let provider: CombinedAutocompleteProvider

	beforeEach(() => {
		provider = new CombinedAutocompleteProvider(
			[
				{ name: "help", description: "Show help" },
				{ name: "quit", description: "Exit" },
			],
			"/test/path"
		)
		// @ts-expect-error - accessing private for testing
		provider.fileIndex.search = mockSearch
		// @ts-expect-error - mark as indexed
		provider.fileIndex.indexed = true
	})

	describe("slash commands", () => {
		it("completes command names starting with /", () => {
			const result = provider.getSuggestions(["/he"], 0, 3)
			expect(result).not.toBeNull()
			expect(result!.items).toHaveLength(1)
			expect(result!.items[0]!.value).toBe("help")
			expect(result!.prefix).toBe("/he")
		})

		it("returns all commands for just /", () => {
			const result = provider.getSuggestions(["/"], 0, 1)
			expect(result).not.toBeNull()
			expect(result!.items).toHaveLength(2)
		})

		it("returns null for non-matching command", () => {
			const result = provider.getSuggestions(["/xyz"], 0, 4)
			expect(result).toBeNull()
		})
	})

	describe("@ file attachments", () => {
		it("completes files with @ prefix", () => {
			const result = provider.getSuggestions(["@sr"], 0, 3)
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("@sr")
			// Values should have @ prefix
			for (const item of result!.items) {
				expect(item.value.startsWith("@")).toBe(true)
			}
		})

		it("completes @ after space", () => {
			const result = provider.getSuggestions(["hello @sr"], 0, 9)
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("@sr")
		})
	})

	describe("relative path completion (no @)", () => {
		it("completes relative paths without @ prefix", () => {
			const result = provider.getSuggestions(["src/"], 0, 4)
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("src/")
			// Values should NOT have @ prefix for path completion
			for (const item of result!.items) {
				expect(item.value.startsWith("@")).toBe(false)
			}
		})

		it("completes paths starting with ./", () => {
			const result = provider.getSuggestions(["./src"], 0, 5)
			expect(result).not.toBeNull()
			expect(result!.prefix).toBe("./src")
		})
	})

	describe("applyCompletion", () => {
		it("applies slash command with trailing space", () => {
			const result = provider.applyCompletion(
				["/he"],
				0,
				3,
				{ value: "help", label: "help" },
				"/he"
			)
			expect(result.lines[0]).toBe("/help ")
			expect(result.cursorCol).toBe(6)
		})

		it("applies @ file completion with trailing space", () => {
			const result = provider.applyCompletion(
				["@src"],
				0,
				4,
				{ value: "@src/index.ts", label: "index.ts" },
				"@src"
			)
			expect(result.lines[0]).toBe("@src/index.ts ")
			expect(result.cursorCol).toBe(14)
		})

		it("applies path completion without @", () => {
			const result = provider.applyCompletion(
				["src/"],
				0,
				4,
				{ value: "src/index.ts", label: "index.ts" },
				"src/"
			)
			expect(result.lines[0]).toBe("src/index.ts")
			expect(result.cursorCol).toBe(12)
		})
	})

	describe("edge cases", () => {
		it("handles empty input", () => {
			const result = provider.getSuggestions([""], 0, 0)
			expect(result).toBeNull()
		})

		it("handles multiline with cursor on different line", () => {
			const result = provider.getSuggestions(["first line", "/he"], 1, 3)
			expect(result).not.toBeNull()
			expect(result!.items[0]!.value).toBe("help")
		})

		it("does not trigger in middle of word", () => {
			const result = provider.getSuggestions(["hello/world"], 0, 8)
			// Should not treat hello/world as a path completion
			expect(result).toBeNull()
		})
	})
})
```

**Why**: Autocomplete is critical functionality with complex edge cases. Tests prevent regressions.

---

#### 3.3 Expand demo with new components
**File**: `packages/open-tui/examples/demo.tsx`
**Location**: replace entire file

**Content**:
```typescript
/**
 * Demo app showing open-tui components
 *
 * Run with: cd packages/open-tui && bun run demo
 */

import { TextAttributes } from "@opentui/core"
import { render, useKeyboard } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import {
	CodeBlock,
	Dialog,
	Diff,
	Editor,
	type EditorRef,
	Image,
	Loader,
	Markdown,
	SelectList,
	Spacer,
	ThemeProvider,
	Toast,
	ToastViewport,
	type ToastItem,
	useTheme,
	type SelectItem,
} from "../src/index.js"

const DEMO_MARKDOWN = `# OpenTUI Demo

This is **bold** and *italic* text.

## Features

- Markdown rendering
- Select lists  
- Loader animation

\`\`\`typescript
const hello = "world"
\`\`\`

> A blockquote
`

const DEMO_CODE = `function fibonacci(n: number): number {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}

// Calculate first 10 fibonacci numbers
const results = Array.from({ length: 10 }, (_, i) => fibonacci(i))
console.log(results)
`

const DEMO_DIFF = `--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,6 @@
 function greet(name: string) {
-  console.log("Hello, " + name)
+  const message = \`Hello, \${name}!\`
+  console.log(message)
+  return message
 }
`

const DEMO_ITEMS: SelectItem[] = [
	{ value: "markdown", label: "Markdown Demo", description: "Show markdown rendering" },
	{ value: "code", label: "Code Block Demo", description: "Show syntax highlighting" },
	{ value: "diff", label: "Diff Demo", description: "Show diff rendering" },
	{ value: "loader", label: "Loader Demo", description: "Show loading spinner" },
	{ value: "editor", label: "Editor Demo", description: "Show text editor" },
	{ value: "dialog", label: "Dialog Demo", description: "Show modal dialog" },
	{ value: "toast", label: "Toast Demo", description: "Show notifications" },
	{ value: "select", label: "Select List Demo", description: "Show this list" },
]

function DemoApp() {
	const { theme } = useTheme()
	const [currentView, setCurrentView] = createSignal<string>("select")
	const [selectedIndex, setSelectedIndex] = createSignal(0)
	const [dialogOpen, setDialogOpen] = createSignal(false)
	const [toasts, setToasts] = createSignal<ToastItem[]>([])
	const [editorValue, setEditorValue] = createSignal("")
	let editorRef: EditorRef | undefined

	const addToast = (variant: ToastItem["variant"]) => {
		const id = `toast-${Date.now()}`
		setToasts((prev) => [
			...prev,
			{
				id,
				title: `${variant?.toUpperCase() ?? "INFO"} Toast`,
				message: "This will auto-dismiss in 3 seconds",
				variant,
				duration: 3000,
			},
		])
	}

	const dismissToast = (id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id))
	}

	useKeyboard({
		onKey: (e) => {
			if (e.name === "escape") {
				if (dialogOpen()) {
					setDialogOpen(false)
				} else if (currentView() !== "select") {
					setCurrentView("select")
				}
				return
			}

			if (currentView() === "select") {
				if (e.name === "up") {
					setSelectedIndex((i) => (i === 0 ? DEMO_ITEMS.length - 1 : i - 1))
				} else if (e.name === "down") {
					setSelectedIndex((i) => (i === DEMO_ITEMS.length - 1 ? 0 : i + 1))
				} else if (e.name === "return") {
					const item = DEMO_ITEMS[selectedIndex()]
					if (item) {
						if (item.value === "dialog") {
							setDialogOpen(true)
						} else {
							setCurrentView(item.value)
						}
					}
				} else if (e.name === "q") {
					process.exit(0)
				}
			}

			// Toast demo controls
			if (currentView() === "toast") {
				if (e.name === "1") addToast("info")
				if (e.name === "2") addToast("success")
				if (e.name === "3") addToast("warning")
				if (e.name === "4") addToast("error")
			}
		},
	})

	return (
		<box flexDirection="column" padding={1}>
			<text fg={theme.primary} attributes={TextAttributes.BOLD}>
				OpenTUI Component Demo
			</text>
			<text fg={theme.textMuted}>Press ESC to go back, Q to quit</text>
			<box height={1} />

			<Show when={currentView() === "select"}>
				<SelectList
					items={DEMO_ITEMS}
					selectedIndex={selectedIndex()}
					maxVisible={10}
					onSelect={(item) => {
						if (item.value === "dialog") {
							setDialogOpen(true)
						} else {
							setCurrentView(item.value)
						}
					}}
				/>
			</Show>

			<Show when={currentView() === "markdown"}>
				<Markdown text={DEMO_MARKDOWN} />
			</Show>

			<Show when={currentView() === "code"}>
				<box flexDirection="column" gap={1}>
					<text fg={theme.text}>Code Block with TypeScript highlighting:</text>
					<CodeBlock content={DEMO_CODE} filetype="typescript" title="fibonacci.ts" />
				</box>
			</Show>

			<Show when={currentView() === "diff"}>
				<box flexDirection="column" gap={1}>
					<text fg={theme.text}>Unified Diff View:</text>
					<Diff diffText={DEMO_DIFF} filetype="typescript" />
				</box>
			</Show>

			<Show when={currentView() === "loader"}>
				<box flexDirection="column" gap={1}>
					<Loader message="Loading with theme colors..." />
					<text fg={theme.textMuted}>Press ESC to go back</text>
				</box>
			</Show>

			<Show when={currentView() === "editor"}>
				<box flexDirection="column" gap={1}>
					<text fg={theme.text}>Editor (type something, Cmd+Enter for newline):</text>
					<Editor
						ref={(r) => (editorRef = r)}
						value={editorValue()}
						onChange={setEditorValue}
						placeholder="Type here..."
						focused
						minHeight={3}
						maxHeight={10}
						width="80%"
					/>
					<text fg={theme.textMuted}>
						Current value: {editorValue() || "(empty)"} ({editorValue().length} chars)
					</text>
				</box>
			</Show>

			<Show when={currentView() === "toast"}>
				<box flexDirection="column" gap={1}>
					<text fg={theme.text}>Press number keys to show toasts:</text>
					<text fg={theme.textMuted}>1=Info 2=Success 3=Warning 4=Error</text>
					<box height={1} />
					<text fg={theme.textMuted}>Toasts appear in top-right and auto-dismiss after 3s</text>
				</box>
			</Show>

			{/* Toast Viewport - always rendered */}
			<ToastViewport
				toasts={toasts()}
				onDismiss={dismissToast}
				defaultDuration={3000}
			/>

			{/* Dialog */}
			<Dialog
				open={dialogOpen()}
				title="Example Dialog"
				onClose={() => setDialogOpen(false)}
			>
				<text fg={theme.text}>This is a modal dialog.</text>
				<box height={1} />
				<text fg={theme.textMuted}>Press ESC or click outside to close.</text>
			</Dialog>

			<Spacer />
			<text fg={theme.textMuted}>View: {currentView()}</text>
		</box>
	)
}

// Start the app
render(
	() => (
		<ThemeProvider mode="dark">
			<DemoApp />
		</ThemeProvider>
	),
	{
		targetFps: 60,
		exitOnCtrlC: true,
		useKittyKeyboard: {},
	},
)
```

**Why**: Comprehensive demo catches rendering regressions and serves as living documentation.

---

### Edge Cases to Handle
- [ ] Image with invalid data: falls back to text placeholder
- [ ] Image resize during render: cache invalidated, re-renders
- [ ] Autocomplete mock returns empty: handled gracefully
- [ ] Demo on small terminal: components should not overflow

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test packages/open-tui           # All tests including new ones pass
```

**Manual**:
- [ ] Image respects maxHeight prop
- [ ] Image re-renders when terminal is resized
- [ ] Demo shows all component types correctly
- [ ] Autocomplete tests cover the @ prefix fix from Phase 1

### Rollback
```bash
git restore -- packages/open-tui/src/components/image.tsx \
               packages/open-tui/examples/demo.tsx
rm packages/open-tui/tests/autocomplete.test.ts
```

### Notes
_Space for implementer discoveries_

---

## Testing Strategy

### Unit Tests to Add/Modify

**File**: `packages/open-tui/tests/autocomplete.test.ts` (new, detailed in Phase 3.2)

**File**: `packages/open-tui/tests/index.test.ts` (existing, extend)
```typescript
// Add to existing file
describe("clipboard", () => {
	it("returns false for empty string", () => {
		expect(copyToClipboard("")).toBe(false)
	})
})
```

### Integration Tests
- [ ] Demo runs without crashing: `timeout 5 bun run packages/open-tui/examples/demo.tsx || true`
- [ ] All imports resolve: `bun run packages/open-tui/src/index.ts`

### Manual Testing Checklist
1. [ ] Run demo, navigate through all views
2. [ ] Test @ completion vs path completion in coding-agent
3. [ ] Resize terminal while image is displayed
4. [ ] Toggle theme mode at runtime

## Anti-Patterns to Avoid
- Don't use `any` type - use `unknown` or proper types
- Don't create Solid signals outside components - use module-level variables for caches
- Don't forget `onCleanup` for timers/subscriptions
- Don't access `props.` directly in memos - destructure or use `()` accessor pattern

## Open Questions (must resolve before implementation)
- [x] Should copyToClipboard throw or return boolean? -> Return boolean (non-critical operation)
- [x] Should Dialog steal focus from parent? -> No, just handle ESC when open
- [x] Toast stacking direction? -> Column with gap (existing behavior is fine)

## References
- Similar impl: `packages/open-tui/src/context/theme.tsx:351-355` (effect pattern)
- Pattern source: `packages/open-tui/src/components/select-list.tsx` (keyboard handling pattern)
- OpenTUI docs: https://github.com/anthropics/opentui

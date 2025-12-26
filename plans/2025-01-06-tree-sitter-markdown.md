# Tree-sitter Markdown Implementation Plan

## Overview
Replace marked.js-based markdown rendering with @opentui/core's built-in tree-sitter `<code>` component for better syntax highlighting, conceal mode, and streaming support.

## Current State
- `packages/open-tui/src/components/markdown.tsx` uses marked.js lexer + custom JSX renderers
- Already depends on `@opentui/core@0.1.62` and `@opentui/solid@0.1.62`
- Theme has syntax colors but uses `SyntaxStyle.fromStyles()` (simple key-value)
- No tree-sitter parser configuration

### Key Discoveries
- `@opentui/core` has built-in `<code>` component with tree-sitter support
- Built-in parsers: markdown, javascript, typescript (no config needed)
- Other languages configured via `addDefaultParsers()` 
- opencode uses `SyntaxStyle.fromTheme()` with scope-based rules for full tree-sitter support
- Conceal mode hides markdown syntax (`**`, `#`, etc.) while showing styled text

## Desired End State
- Markdown renders via `<code filetype="markdown" conceal={true}>`
- Code blocks inside markdown get tree-sitter highlighting
- Conceal mode toggleable
- All major languages highlighted in code blocks
- Theme supports granular markdown colors (emph, strong, list enumeration, etc.)

**Verification:**
```bash
bun run typecheck   # No errors
bun run test        # All pass
# Manual: markdown with code blocks renders with syntax highlighting
# Manual: toggling conceal shows/hides markdown syntax chars
```

## Out of Scope
- Custom tree-sitter queries (use defaults from nvim-treesitter)
- Language injection for HTML script/style tags
- Custom theme JSON schema validation

---

## Phase 1: Update Dependencies

### Overview
Bump @opentui packages to latest version with full code component support.

### Prerequisites
- [ ] None

### Changes

#### 1. Update package.json
**File**: `packages/open-tui/package.json`

**Before**:
```json
"@opentui/core": "0.1.62",
"@opentui/solid": "0.1.62",
```

**After**:
```json
"@opentui/core": "0.1.63",
"@opentui/solid": "0.1.63",
```

#### 2. Update apps/coding-agent/package.json
**File**: `apps/coding-agent/package.json`

Check if it has direct @opentui deps and update similarly.

### Success Criteria

**Automated:**
```bash
bun install
bun run typecheck
```

---

## Phase 2: Add JSX Augmentation for `<code>`

### Overview
Register the `<code>` intrinsic element from @opentui/solid.

### Prerequisites
- [ ] Phase 1 complete

### Changes

#### 1. Update opentui-augmentations
**File**: `packages/open-tui/src/opentui-augmentations.ts`

**Before**:
```typescript
import type { DiffRenderable, LineNumberRenderable } from "@opentui/core"

declare module "@opentui/solid" {
	interface OpenTUIComponents {
		diff: typeof DiffRenderable
		line_number: typeof LineNumberRenderable
	}
}
```

**After**:
```typescript
import type { CodeRenderable, DiffRenderable, LineNumberRenderable } from "@opentui/core"

declare module "@opentui/solid" {
	interface OpenTUIComponents {
		code: typeof CodeRenderable
		diff: typeof DiffRenderable
		line_number: typeof LineNumberRenderable
	}
}
```

### Success Criteria

**Automated:**
```bash
bun run typecheck  # code element recognized in JSX
```

---

## Phase 3: Add Tree-sitter Parser Configuration

### Overview
Configure tree-sitter WASM parsers for common languages used in code blocks.

### Prerequisites
- [ ] Phase 2 complete

### Changes

#### 1. Create parsers config
**File**: `packages/open-tui/src/parsers-config.ts` (new file)

```typescript
/**
 * Tree-sitter parser configuration for code syntax highlighting.
 * 
 * NOTE: markdown, javascript, typescript use @opentui/core built-in parsers.
 * These configs add support for other languages in fenced code blocks.
 */
export const parsersConfig = {
	parsers: [
		{
			filetype: "python",
			wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
			queries: {
				highlights: [
					"https://github.com/tree-sitter/tree-sitter-python/raw/refs/heads/master/queries/highlights.scm",
				],
			},
		},
		{
			filetype: "rust",
			wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.0/tree-sitter-rust.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/rust/highlights.scm",
				],
			},
		},
		{
			filetype: "go",
			wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/highlights.scm",
				],
			},
		},
		{
			filetype: "bash",
			wasm: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.0/tree-sitter-bash.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/bash/highlights.scm",
				],
			},
		},
		{
			filetype: "json",
			wasm: "https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/json/highlights.scm",
				],
			},
		},
		{
			filetype: "yaml",
			wasm: "https://github.com/tree-sitter-grammars/tree-sitter-yaml/releases/download/v0.7.2/tree-sitter-yaml.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/yaml/highlights.scm",
				],
			},
		},
		{
			filetype: "c",
			wasm: "https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.1/tree-sitter-c.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c/highlights.scm",
				],
			},
		},
		{
			filetype: "cpp",
			wasm: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/cpp/highlights.scm",
				],
			},
		},
		{
			filetype: "java",
			wasm: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/java/highlights.scm",
				],
			},
		},
		{
			filetype: "ruby",
			wasm: "https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ruby/highlights.scm",
				],
			},
		},
		{
			filetype: "html",
			wasm: "https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.23.2/tree-sitter-html.wasm",
			queries: {
				highlights: [
					"https://github.com/tree-sitter/tree-sitter-html/raw/refs/heads/master/queries/highlights.scm",
				],
			},
		},
		{
			filetype: "css",
			wasm: "https://github.com/tree-sitter/tree-sitter-css/releases/download/v0.25.0/tree-sitter-css.wasm",
			queries: {
				highlights: [
					"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/css/highlights.scm",
				],
			},
		},
	],
}
```

#### 2. Export from index
**File**: `packages/open-tui/src/index.ts`

**Add** (near other exports):
```typescript
export { parsersConfig } from "./parsers-config.js"
```

### Success Criteria

**Automated:**
```bash
bun run typecheck
```

---

## Phase 4: Update Theme with Tree-sitter Scope Rules

### Overview
Replace `SyntaxStyle.fromStyles()` with `SyntaxStyle.fromTheme()` using tree-sitter scope selectors, and add granular markdown theme colors.

### Prerequisites
- [ ] Phase 3 complete

### Changes

#### 1. Add markdown theme colors to ThemeColors interface
**File**: `packages/open-tui/src/context/theme.tsx`

**Add to ThemeColors interface** (after existing markdown colors ~line 120):
```typescript
	// Extended markdown colors for tree-sitter
	markdownStrong: RGBA
	markdownEmph: RGBA
	markdownListEnumeration: RGBA
	markdownImage: RGBA
	markdownStrikethrough: RGBA
```

#### 2. Add to defaultDarkTheme
**File**: `packages/open-tui/src/context/theme.tsx`

**Add** (after markdownListBullet in defaultDarkTheme ~line 185):
```typescript
	markdownStrong: parseColor("#c8c8c8"),
	markdownEmph: parseColor("#d4c48a"),
	markdownListEnumeration: parseColor("#7d9bba"),
	markdownImage: parseColor("#9090a0"),
	markdownStrikethrough: parseColor("#6b6b6b"),
```

#### 3. Add to defaultLightTheme
**File**: `packages/open-tui/src/context/theme.tsx`

**Add** (after markdownListBullet in defaultLightTheme ~line 240):
```typescript
	markdownStrong: parseColor("#4c4f69"),
	markdownEmph: parseColor("#df8e1d"),
	markdownListEnumeration: parseColor("#1e66f5"),
	markdownImage: parseColor("#ea76cb"),
	markdownStrikethrough: parseColor("#9ca0b0"),
```

#### 4. Update mapToThemeColors
**File**: `packages/open-tui/src/context/theme.tsx`

**Add** (in mapToThemeColors, after markdownListBullet mapping ~line 330):
```typescript
		markdownStrong: get("markdownStrong", "text"),
		markdownEmph: get("markdownEmph", "warning"),
		markdownListEnumeration: get("markdownListEnumeration", "markdownListBullet"),
		markdownImage: get("markdownImage", "markdownLink"),
		markdownStrikethrough: get("markdownStrikethrough", "textMuted"),
```

#### 5. Replace createSyntaxStyle with scope-based rules
**File**: `packages/open-tui/src/context/theme.tsx`

**Before** (~line 340):
```typescript
export function createSyntaxStyle(theme: Theme, variant: SyntaxVariant = "normal"): SyntaxStyle {
	const dim = variant === "subtle"
	return SyntaxStyle.fromStyles({
		comment: { fg: theme.syntaxComment, italic: true, ...(dim ? { dim: true } : {}) },
		string: { fg: theme.syntaxString, ...(dim ? { dim: true } : {}) },
		// ... etc
	})
}
```

**After**:
```typescript
export function createSyntaxStyle(theme: Theme, variant: SyntaxVariant = "normal"): SyntaxStyle {
	const rules = getSyntaxRules(theme)
	if (variant === "subtle") {
		return SyntaxStyle.fromTheme(
			rules.map((rule) => {
				if (rule.style.foreground) {
					const fg = rule.style.foreground
					return {
						...rule,
						style: {
							...rule.style,
							foreground: RGBA.fromInts(
								Math.round(fg.r * 255),
								Math.round(fg.g * 255),
								Math.round(fg.b * 255),
								Math.round(0.6 * 255), // 60% opacity for subtle
							),
						},
					}
				}
				return rule
			}),
		)
	}
	return SyntaxStyle.fromTheme(rules)
}

type SyntaxRule = {
	scope: string[]
	style: {
		foreground?: RGBA
		background?: RGBA
		bold?: boolean
		italic?: boolean
		underline?: boolean
	}
}

function getSyntaxRules(theme: Theme): SyntaxRule[] {
	return [
		// Default text
		{ scope: ["default"], style: { foreground: theme.text } },
		
		// Comments
		{ scope: ["comment", "comment.documentation"], style: { foreground: theme.syntaxComment, italic: true } },
		
		// Strings
		{ scope: ["string", "symbol"], style: { foreground: theme.syntaxString } },
		{ scope: ["string.escape", "string.regexp"], style: { foreground: theme.syntaxKeyword } },
		{ scope: ["character", "character.special"], style: { foreground: theme.syntaxString } },
		
		// Numbers and constants
		{ scope: ["number", "boolean", "float"], style: { foreground: theme.syntaxNumber } },
		{ scope: ["constant", "constant.builtin"], style: { foreground: theme.syntaxConstant } },
		
		// Keywords
		{ scope: ["keyword"], style: { foreground: theme.syntaxKeyword, italic: true } },
		{ scope: ["keyword.function", "keyword.return", "keyword.conditional", "keyword.repeat"], style: { foreground: theme.syntaxKeyword, italic: true } },
		{ scope: ["keyword.operator", "operator"], style: { foreground: theme.syntaxOperator } },
		{ scope: ["keyword.import", "keyword.export"], style: { foreground: theme.syntaxKeyword } },
		{ scope: ["keyword.type"], style: { foreground: theme.syntaxType, bold: true, italic: true } },
		
		// Functions
		{ scope: ["function", "function.call", "function.method", "function.method.call", "function.builtin"], style: { foreground: theme.syntaxFunction } },
		{ scope: ["constructor"], style: { foreground: theme.syntaxFunction } },
		
		// Variables and parameters
		{ scope: ["variable", "variable.parameter", "parameter"], style: { foreground: theme.syntaxVariable } },
		{ scope: ["variable.member", "property", "field"], style: { foreground: theme.syntaxProperty } },
		{ scope: ["variable.builtin", "variable.super"], style: { foreground: theme.error } },
		
		// Types
		{ scope: ["type", "type.builtin", "type.definition"], style: { foreground: theme.syntaxType } },
		{ scope: ["class", "module", "namespace"], style: { foreground: theme.syntaxType } },
		
		// Punctuation
		{ scope: ["punctuation", "punctuation.bracket", "punctuation.delimiter"], style: { foreground: theme.syntaxPunctuation } },
		{ scope: ["punctuation.special"], style: { foreground: theme.syntaxOperator } },
		
		// Tags (HTML/XML)
		{ scope: ["tag"], style: { foreground: theme.syntaxTag } },
		{ scope: ["tag.attribute"], style: { foreground: theme.syntaxAttribute } },
		{ scope: ["tag.delimiter"], style: { foreground: theme.syntaxOperator } },
		
		// Attributes and annotations
		{ scope: ["attribute", "annotation"], style: { foreground: theme.warning } },
		
		// Markdown specific
		{ scope: ["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"], style: { foreground: theme.markdownHeading, bold: true } },
		{ scope: ["markup.bold", "markup.strong"], style: { foreground: theme.markdownStrong, bold: true } },
		{ scope: ["markup.italic"], style: { foreground: theme.markdownEmph, italic: true } },
		{ scope: ["markup.strikethrough"], style: { foreground: theme.markdownStrikethrough } },
		{ scope: ["markup.link", "markup.link.url"], style: { foreground: theme.markdownLink, underline: true } },
		{ scope: ["markup.link.label", "label"], style: { foreground: theme.markdownLinkUrl } },
		{ scope: ["markup.raw", "markup.raw.inline", "markup.raw.block"], style: { foreground: theme.markdownCode } },
		{ scope: ["markup.list"], style: { foreground: theme.markdownListBullet } },
		{ scope: ["markup.list.checked"], style: { foreground: theme.success } },
		{ scope: ["markup.list.unchecked"], style: { foreground: theme.textMuted } },
		{ scope: ["markup.quote"], style: { foreground: theme.markdownBlockQuote, italic: true } },
		
		// Diff
		{ scope: ["diff.plus"], style: { foreground: theme.diffAdded, background: theme.diffAddedBg } },
		{ scope: ["diff.minus"], style: { foreground: theme.diffRemoved, background: theme.diffRemovedBg } },
		{ scope: ["diff.delta"], style: { foreground: theme.diffContext, background: theme.diffContextBg } },
		
		// Conceal (for hidden markdown syntax)
		{ scope: ["conceal"], style: { foreground: theme.textMuted } },
		
		// Misc
		{ scope: ["spell", "nospell"], style: { foreground: theme.text } },
		{ scope: ["error"], style: { foreground: theme.error, bold: true } },
		{ scope: ["warning"], style: { foreground: theme.warning, bold: true } },
		{ scope: ["info"], style: { foreground: theme.info } },
	]
}
```

### Success Criteria

**Automated:**
```bash
bun run typecheck
bun run test
```

---

## Phase 5: Create New Markdown Component

### Overview
Replace the marked.js-based Markdown component with one using `<code filetype="markdown">`.

### Prerequisites
- [ ] Phase 4 complete

### Changes

#### 1. Rewrite markdown.tsx
**File**: `packages/open-tui/src/components/markdown.tsx`

**Replace entire file with**:
```typescript
/**
 * Markdown renderer using @opentui/core's tree-sitter based <code> component
 */

import type { JSX } from "solid-js"
import { useTheme } from "../context/theme.js"

export interface MarkdownProps {
	/** Markdown text to render */
	text: string
	/** Enable conceal mode (hides markdown syntax like **, #, etc.) */
	conceal?: boolean
	/** Whether content is actively streaming */
	streaming?: boolean
}

/**
 * Markdown component that renders markdown text with tree-sitter syntax highlighting
 *
 * @example
 * ```tsx
 * <Markdown text="# Hello\n\nThis is **bold** text." />
 * ```
 */
export function Markdown(props: MarkdownProps): JSX.Element {
	const { theme, syntaxStyle } = useTheme()

	return (
		<code
			filetype="markdown"
			content={props.text ?? ""}
			syntaxStyle={syntaxStyle}
			conceal={props.conceal ?? true}
			streaming={props.streaming ?? false}
			drawUnstyledText={false}
			fg={theme.markdownText}
		/>
	)
}

// Re-export for backwards compatibility
export interface MarkdownTheme {
	text?: string
	heading?: string
	// Note: granular theming now handled via ThemeColors
}
```

#### 2. Update exports
**File**: `packages/open-tui/src/index.ts`

**Update Markdown export** (should already be correct, verify):
```typescript
export { Markdown, type MarkdownProps, type MarkdownTheme } from "./components/markdown.js"
```

### Success Criteria

**Automated:**
```bash
bun run typecheck
bun run test
```

**Manual:**
- [ ] Basic markdown renders (headings, bold, italic, links)
- [ ] Code blocks get syntax highlighting
- [ ] Lists render correctly
- [ ] Conceal mode hides markdown syntax

---

## Phase 6: Initialize Parsers in coding-agent

### Overview
Call `addDefaultParsers()` at app startup to register tree-sitter parsers.

### Prerequisites
- [ ] Phase 5 complete

### Changes

#### 1. Add parser initialization
**File**: `apps/coding-agent/src/index.ts`

**Add** (near top, after imports):
```typescript
import { addDefaultParsers } from "@opentui/core"
import { parsersConfig } from "@marvin-agents/open-tui"

// Initialize tree-sitter parsers for code syntax highlighting
addDefaultParsers(parsersConfig.parsers)
```

### Success Criteria

**Automated:**
```bash
bun run typecheck
cd apps/coding-agent && bun run build
```

**Manual:**
- [ ] Python code blocks highlight correctly
- [ ] Rust code blocks highlight correctly
- [ ] Go code blocks highlight correctly

---

## Phase 7: Add Conceal Toggle

### Overview
Add keyboard shortcut to toggle conceal mode in the TUI.

### Prerequisites
- [ ] Phase 6 complete

### Changes

#### 1. Add conceal state to tui-app
**File**: `apps/coding-agent/src/tui-app.tsx`

Find where `diffWrapMode` state is defined and add:
```typescript
const [concealMarkdown, setConcealMarkdown] = createSignal(true)
```

#### 2. Pass conceal to MessageList
Where MessageList is rendered, add `concealMarkdown={concealMarkdown()}` prop.

#### 3. Update MessageList to accept and pass conceal
**File**: `apps/coding-agent/src/components/MessageList.tsx`

Add to props interface and pass to Markdown component.

#### 4. Add keybinding
Add `c` or similar key to toggle conceal in the keybindings section.

### Success Criteria

**Automated:**
```bash
bun run typecheck
```

**Manual:**
- [ ] Pressing toggle key shows/hides markdown syntax
- [ ] `**bold**` shows as "bold" with conceal on, "**bold**" with conceal off

---

## Testing Strategy

### Manual Testing Checklist
1. [ ] Simple markdown: `# Heading`, `**bold**`, `*italic*`, `[link](url)`
2. [ ] Code blocks with language hints: ```python, ```rust, ```typescript
3. [ ] Nested lists with code blocks (the original bug)
4. [ ] Task lists: `- [ ]` and `- [x]`
5. [ ] Images: `![alt](url)`
6. [ ] Blockquotes: `> quote`
7. [ ] Tables (if supported by tree-sitter markdown)
8. [ ] Toggle conceal mode and verify syntax chars show/hide
9. [ ] Streaming content renders progressively
10. [ ] Theme switching preserves markdown colors

## Anti-Patterns to Avoid
- Don't cache SyntaxStyle objects - let memos handle recomputation
- Don't call `addDefaultParsers()` multiple times
- WASM files are downloaded on first use - expect initial delay

## References
- opencode implementation: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/cli/cmd/tui/`
- opencode theme: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- opencode parsers: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/parsers-config.ts`
- @opentui/core docs: https://github.com/sst/opentui

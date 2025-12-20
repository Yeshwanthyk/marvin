# UI Plan: OpenTUI visual overhaul (marvin)

## Reference: how OpenCode structures its TUI (what to copy)

**Entry + providers**
- `packages/opencode/src/cli/cmd/tui/app.tsx`: one root `<box>`; nested providers for route/sync/theme/local/keybind/dialog/command/prompt-history/toast; global mouse-up copies selection (OSC52 + clipboard); terminal-title updates per route.

**Routes + layout**
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`: main session layout is `Header` + `ScrollBox` (sticky bottom) + `Prompt` + `Footer`; optional `Sidebar` appears only when terminal is wide.
- Uses explicit breakpoints: `wide = width > 120`, `sidebarWidth = 42`, `contentWidth = termWidth - (sidebar?42:0) - 4`.

**Theme system (semantic tokens + syntax)**
- `packages/opencode/src/cli/cmd/tui/context/theme.tsx`: semantic tokens (panel/element/menu, subtle/active borders, diff bg + line-number bg, markdown tokens, syntax tokens).
- Theme JSON supports refs + dark/light variants; can also generate a “system” theme from terminal palette.
- `selectedForeground(theme)` accounts for transparent backgrounds.

**Prompt UX**
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`: input is a panel with a left accent bar; shows agent + model; supports shell mode (`!`), command palette, history, autocomplete popover, and “virtual” extmarks (file refs/agents/paste summaries).

**Tool rendering model**
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`:
  - `ToolRegistry`: per-tool renderer + container mode (`inline` vs `block`).
  - Progressive disclosure: hide completed tools when “details” is off; always show errors/permissions.
  - Tool blocks are visually distinct (panel bg + border) only when they need space.

**Diff rendering (key details)**
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`:
  - Use built-in `<diff>` renderer with:
    - `view = split` when wide, else `unified` (config can override).
    - `wrapMode = word|none` toggle.
    - per-theme colors: `addedBg/removedBg/contextBg`, sign colors, line-number fg/bg + added/removed line-number bg.
  - Result: readable, line-numbered, syntax-highlighted diffs; wide terminals get side-by-side.

---

## Current state (marvin)

**OpenTUI library**
- `packages/open-tui/src/context/theme.tsx`: basic tokens (missing diff backgrounds/line-number colors, menu bg, subtle borders, selected item text rules, syntax styles).
- `packages/open-tui/src/components/editor.tsx`: hard-coded 80-col borders; no adaptive width; no panel styling.
- `packages/open-tui/src/components/select-list.tsx`: selection is fg-only (no bg/invert); uncontrolled mode is effectively broken (`internalIndex` never updates).
- No `Toast`, `Dialog`, `Panel`, `Badge`, `Diff`, `Code`/syntax helpers.

**App UI**
- `apps/coding-agent/src/tui-app-open.tsx`: functional but visually sparse; no panel/background hierarchy; assistant text is raw `<text>` (no markdown); scrollbox has no sticky-bottom/scrollbar/auto-scroll guarantees.
- `apps/coding-agent/src/tui-open-rendering.tsx`: custom diff is line-oriented + word-diff only; no line numbers; no split view; no syntax highlight; tool blocks have no consistent “container” semantics.
- Mixed theming: OpenTUI `ThemeProvider` is used, but parts still use legacy hex palette from `apps/coding-agent/src/tui/themes.ts`.

---

## Visual goals (what “good” looks like)

- Clear hierarchy: background → panel → element; minimal but consistent borders/dividers.
- Dense but scannable timeline: user vs assistant vs tools visually distinct; stable spacing.
- Diffs: line-numbered, syntax-highlighted, split/unified responsive; word-level emphasis on change.
- Progressive disclosure: tool details collapsible; huge outputs truncated with explicit expand affordance.
- Consistent theming: single semantic token set, multiple themes, light/dark, optional terminal-derived “system” theme.

---

## Proposed UI spec (marvin OpenTUI)

### Layout (responsive)
- **Wide (>120 cols)**: `Sidebar(40–44)` + `Main`.
- **Narrow**: hide sidebar; show a compact header.
- `Main` structure:
  - Header (session/meta) (optional on narrow)
  - ScrollBox timeline (sticky bottom, optional scrollbar)
  - Prompt (accent left bar + model/agent row + status line)
  - Footer (project/branch, model, thinking, context %, git diff stats, queue, activity)

### Message blocks
- User message: left border = accent; panel bg; “You” + timestamp row.
- Assistant message:
  - Markdown renderer (preferred: OpenTUI `<code filetype="markdown">` or improved `Markdown` component).
  - Thinking (optional): subdued style (`theme.textMuted` + opacity), visually separated.

### Tool blocks
- Registry-based per-tool renderers (inline vs block), matching OpenCode:
  - Inline: title-only line (“Read …”, “Glob …”).
  - Block: panel bg + border + content (bash output, diffs, file previews).
- Error state: borderColor = `theme.error`, keep tool visible even when details off.
- Expand/collapse: per-tool (not global) with stable truncation rules.

### Diffs (edit/write/patch)
- Replace custom `EditDiff` with OpenTUI `<diff>` when given unified diff text.
- View selection:
  - `auto`: split if width>120 else unified.
  - config override: `diff_style = unified|split|auto`.
  - wrap toggle: `diff_wrap = word|none`.
- Color tokens required (match OpenCode):
  - `diffAddedBg`, `diffRemovedBg`, `diffContextBg`
  - `diffLineNumber`, `diffAddedLineNumberBg`, `diffRemovedLineNumberBg`
  - `diffHighlightAdded`, `diffHighlightRemoved`

---

## Work plan (scoped to visual/UX)

### Phase 1 — Design system + primitives (packages/open-tui)
- Expand `Theme` tokens to cover:
  - menu bg, subtle borders, selected list item text, diff bgs/line-number colors, markdown link text, syntax tokens.
- Add `createSyntaxStyle(theme)` (and optionally “subtleSyntax” for thinking) similar to OpenCode.
- Add primitives:
  - `Panel` (bg + border + padding presets)
  - `Divider` / `SplitBorder` helpers
  - `Badge` (small label chip)
  - `Toast` (absolute positioned overlay)
  - `Dialog` (modal overlay + focus trap conventions)
  - `Diff` wrapper around `<diff>` with “auto” sizing + theme defaults
  - `CodeBlock` wrapper around `<code>` + optional `LineNumbers`
- Fix `Editor` width: accept `width`/`maxWidth`; no hard-coded 80 columns.
- Fix/upgrade `SelectList` visuals: background highlight/invert, consistent spacing, correct uncontrolled state.

### Phase 2 — App-level rendering overhaul (apps/coding-agent)
- Replace legacy hex palette usage inside OpenTUI app; render everything via `useTheme()` tokens.
- Replace `apps/coding-agent/src/tui-open-rendering.tsx` tool/diff rendering with new open-tui primitives:
  - `ToolRegistry` pattern (inline vs block)
  - `Diff` for edits
  - `CodeBlock + LineNumbers` for writes
  - consistent truncation/expand per tool
- Render assistant text via markdown/code renderer (stream-friendly).
- Upgrade timeline styling:
  - message panels w/ left border colors
  - optional timestamps
  - conceal toggle (hide large code blocks by default)

### Phase 3 — Responsive chrome + polish
- Sidebar (wide only) with: context %, cost/tokens, git diff summary, queue, and quick toggles.
- Scroll improvements: sticky bottom by default; optional scrollbar; “jump to bottom” when user submits.
- Toasts for errors/copy confirmations.
- Selection-to-clipboard (OSC52 + clipboard fallback) on mouse selection.

---

## Verification

- `bun run check`
- Manual: run `bun run marvin` (OpenTUI mode) and validate:
  - diff readability in both 100-col and 160-col terminals
  - long tool outputs don’t blow up layout; expand/collapse is stable
  - theme consistency (no stray legacy hex colors)

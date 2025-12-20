# UI Plan: OpenTUI visual overhaul (marvin)

## Reference: how OpenCode structures its TUI (what to copy)

**Entry + providers**
- `packages/opencode/src/cli/cmd/tui/app.tsx`: one root `<box>`; nested providers for route/sync/theme/local/keybind/dialog/command/prompt-history/toast; global mouse-up copies selection (OSC52 + clipboard); terminal-title updates per route.

**Routes + layout**
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`: main session layout is `Header` + `ScrollBox` (sticky bottom) + `Prompt` + `Footer`; optional `Sidebar` appears only when terminal is wide.
- Uses explicit breakpoints: `wide = width > 120`, `sidebarWidth = 42`, `contentWidth = termWidth - (sidebar?42:0) - 4`.

**Theme system (semantic tokens + syntax)**
- `packages/opencode/src/cli/cmd/tui/context/theme.tsx`: semantic tokens (panel/element/menu, subtle/active borders, diff bg + line-number bg, markdown tokens, syntax tokens).
- Theme JSON supports refs + dark/light variants; can also generate a "system" theme from terminal palette.
- `selectedForeground(theme)` accounts for transparent backgrounds.

**Prompt UX**
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`: input is a panel with a left accent bar; shows agent + model; supports shell mode (`!`), command palette, history, autocomplete popover, and "virtual" extmarks (file refs/agents/paste summaries).

**Tool rendering model**
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`:
  - `ToolRegistry`: per-tool renderer + container mode (`inline` vs `block`).
  - Progressive disclosure: hide completed tools when "details" is off; always show errors/permissions.
  - Tool blocks are visually distinct (panel bg + border) only when they need space.

**Diff rendering (key details)**
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`:
  - Use built-in `<diff>` renderer with:
    - `view = split` when wide, else `unified` (config can override).
    - `wrapMode = word|none` toggle.
    - per-theme colors: `addedBg/removedBg/contextBg`, sign colors, line-number fg/bg + added/removed line-number bg.
  - Result: readable, line-numbered, syntax-highlighted diffs; wide terminals get side-by-side.

---

## Work plan (scoped to visual/UX)

### Phase 1 — Design system + primitives (packages/open-tui) ✅ DONE
- [x] Expand `Theme` tokens: menu bg, subtle borders, selection colors, diff bgs/line-numbers, markdown tokens, syntax tokens
- [x] Add `createSyntaxStyle(theme)` for syntax highlighting
- [x] Add primitives:
  - [x] `Panel` (bg + border + padding presets + accent bar)
  - [x] `Divider` (horizontal/vertical)
  - [x] `Badge` (label chip with variants)
  - [x] `Toast` + `ToastViewport` (absolute positioned overlay)
  - [x] `Dialog` (modal overlay)
  - [x] `Diff` wrapper around `<diff>` with auto split/unified + theme
  - [x] `CodeBlock` wrapper around `<code>` + line numbers
- [x] Fix `Editor` width: accept `width`/`maxWidth`, no hard-coded 80 cols
- [x] Fix `SelectList` visuals: bg highlight, correct uncontrolled state

### Phase 2 — App-level rendering overhaul (apps/coding-agent) ✅ DONE
- [x] Replace legacy hex palette in footer with `useTheme()` tokens
- [x] Per-tool expand/collapse state (Ctrl+O toggles last tool)
- [x] Use `Diff` component for edit tool output
- [x] Use `CodeBlock` for write/bash tool output
- [x] Use `Badge` for tool type indicators
- [x] Render assistant text via `<Markdown>` component
- [x] Message panels with left accent colors (user=primary, assistant=secondary)
- [x] Timestamps on messages (stored, not yet displayed)
- [x] Fix solid-js version conflict (pinned to 1.9.9 with overrides)

### Phase 3 — Responsive chrome + polish ✅ DONE
- [x] ~~Sidebar (wide only)~~ — skipped, footer already has the info
- [x] Scroll improvements: sticky bottom (auto-scroll on new content)
- [x] Toast viewport added (ready for errors/copy confirmations)
- [x] Selection-to-clipboard via OSC52 (auto-copy on mouse release, Ctrl+Y)

---

## Verification

- `bun run check`
- Manual: run `bun run marvin` (OpenTUI mode) and validate:
  - diff readability in both 100-col and 160-col terminals
  - long tool outputs don't blow up layout; expand/collapse is stable
  - theme consistency (no stray legacy hex colors)

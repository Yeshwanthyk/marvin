# Plan: Create `packages/open-tui` with OpenTUI

## Overview

Replace the custom TUI renderer in `packages/tui` with OpenTUI's solid-based reactive renderer. OpenTUI provides:
- Yoga layout engine (flexbox)
- Native zig-based rendering pipeline
- SolidJS reactive component model
- Built-in components (Box, Text, Input, ScrollBox, Select, etc.)
- Mouse/keyboard handling, selection, focus management

## Architecture Comparison

| Current TUI | OpenTUI |
|-------------|---------|
| Line-based differential rendering | Buffer-based with Yoga layout |
| `Component.render(width) → string[]` | `Renderable.renderSelf(buffer)` |
| Manual ANSI codes | Structured styling via `parseColor`, `TextAttributes` |
| Imperative input handling | Declarative keybindings + event system |
| Custom `Container` class | `Renderable` tree with SolidJS reconciler |

## Key References

| File | Purpose |
|------|---------|
| `/Users/yesh/Documents/personal/reference/opentui/packages/core/src/Renderable.ts` | Base Renderable class, layout, events |
| `/Users/yesh/Documents/personal/reference/opentui/packages/core/src/renderer.ts` | CliRenderer, main render loop |
| `/Users/yesh/Documents/personal/reference/opentui/packages/solid/index.ts` | SolidJS integration, `render()` entry |
| `/Users/yesh/Documents/personal/reference/opentui/packages/solid/src/reconciler.ts` | DOM-like operations for Solid |
| `/Users/yesh/Documents/personal/reference/opentui/packages/core/src/renderables/Box.ts` | Box component |
| `/Users/yesh/Documents/personal/reference/opentui/packages/core/src/renderables/Text.ts` | Text component |
| `/Users/yesh/Documents/personal/reference/opentui/packages/core/src/renderables/Input.ts` | Input component |
| `/Users/yesh/Documents/personal/reference/opentui/packages/core/src/renderables/ScrollBox.ts` | ScrollBox component |
| `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/cli/cmd/tui/app.tsx` | Example app using opentui+solid |
| `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | Complex component example |

## Implementation Plan

### Phase 1: Package Setup ✅

```
packages/open-tui/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # exports
│   ├── jsx-runtime.d.ts      # JSX types
│   ├── app.tsx               # main app wrapper
│   ├── hooks/
│   │   ├── use-keyboard.ts
│   │   ├── use-terminal.ts
│   │   └── use-theme.ts
│   ├── components/
│   │   ├── box.tsx
│   │   ├── text.tsx
│   │   ├── markdown.tsx      # port from current tui
│   │   ├── editor.tsx        # port from current tui
│   │   ├── select-list.tsx
│   │   ├── image.tsx
│   │   ├── loader.tsx
│   │   └── spacer.tsx
│   ├── context/
│   │   ├── theme.tsx
│   │   └── terminal.tsx
│   └── utils/
│       ├── text-width.ts     # port visibleWidth, truncateToWidth
│       └── markdown-parser.ts
```

### Phase 2: Core Infrastructure ✅

**2.1 Package Configuration** ✅
- Add dependencies: `@opentui/core`, `@opentui/solid`, `solid-js`
- Configure Babel preset for Solid JSX
- Setup tsconfig with `jsxImportSource: "@opentui/solid"`

**2.2 App Entry Point** ✅ (ref: `opencode/tui/app.tsx`)
```tsx
import { render } from "@opentui/solid"
import { createCliRenderer } from "@opentui/core"

export function startApp(rootComponent: () => JSX.Element, config?: CliRendererConfig) {
  return render(rootComponent, {
    targetFps: 60,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    ...config
  })
}
```

**2.3 Terminal Context** ✅
```tsx
// Provides: dimensions, renderer, clipboard
const TerminalContext = createContext<{
  width: Accessor<number>
  height: Accessor<number>
  renderer: CliRenderer
}>()
```

### Phase 3: Component Migration

**3.1 Direct Mappings** ✅

| Current | OpenTUI | Status |
|---------|---------|--------|
| `Box` | `<box>` (BoxRenderable) | ✅ Native |
| `Text` | `<text>` (TextRenderable) | ✅ Native |
| `Spacer` | `<box flexGrow={1} />` | ✅ `components/spacer.tsx` |
| `TruncatedText` | `<text>` with width constraint | ✅ Native |
| `Loader` | Custom spinner via opentui-spinner | ✅ `components/loader.tsx` |
| `Image` | Custom via `OptimizedBuffer.drawImage` | ⏳ Pending |

**3.2 Complex Components to Port**

1. **Markdown** (`packages/tui/src/components/markdown.ts`) ✅
   - Keep marked.js parsing logic
   - Replace ANSI output with `<text>` nodes with style props
   - Use `TextAttributes` for bold/italic/underline
   - Code blocks via opentui's `Code` component or styled boxes

2. **Editor** (`packages/tui/src/components/editor.ts`) ✅
   - Wrapper around `TextareaRenderable`
   - Standard keybindings for navigation/editing
   - Submit/escape/change callbacks

3. **SelectList** (`packages/tui/src/components/select-list.ts`) ✅
   - Custom component using SolidJS primitives
   - Filtering, scrolling, keyboard navigation utilities

### Phase 4: Feature Parity

| Feature | Current Implementation | OpenTUI Approach |
|---------|------------------------|------------------|
| Differential rendering | Manual line diffing | Native buffer diffing in zig |
| Cursor positioning | ANSI escape codes | `setCursorPosition(x,y,visible)` |
| Mouse support | Not implemented | Built-in via `onMouseDown`, etc. |
| Selection | Not implemented | Built-in selection API |
| Focus management | Manual | `focusable`, `focus()`, `blur()` |
| Scrolling | Not implemented | `ScrollBoxRenderable` |
| Image support | iTerm2/Kitty protocols | Same, via `terminal-image.ts` |

### Phase 5: Integration with coding-agent

**5.1 Update imports in `apps/coding-agent`**
```ts
// Before
import { TUI, Editor, Markdown } from "@marvin-agents/tui"

// After  
import { startApp, Editor, Markdown } from "@marvin-agents/open-tui"
```

**5.2 Migrate tui-app.ts**
- Convert to TSX
- Replace Container/Component tree with JSX
- Use Solid reactivity instead of imperative updates

## File-by-File Migration

| Current File | Action | Notes |
|--------------|--------|-------|
| `tui.ts` | Replace | Use `render()` from @opentui/solid |
| `terminal.ts` | Replace | Use CliRenderer from @opentui/core |
| `terminal-image.ts` | Keep/Port | Image encoding logic can be reused |
| `utils.ts` | Port | `visibleWidth` from opentui's wcwidth |
| `autocomplete.ts` | Port | Reuse with SelectRenderable |
| `file-index.ts` | Keep | Standalone, no TUI dependency |
| `components/box.ts` | Replace | `<box>` intrinsic |
| `components/text.ts` | Replace | `<text>` intrinsic |
| `components/editor.ts` | Port | Wrap TextareaRenderable |
| `components/markdown.ts` | Port | Reuse parser, new renderer |
| `components/select-list.ts` | Port | Wrap SelectRenderable |
| `components/loader.ts` | Replace | opentui-spinner |
| `components/image.ts` | Port | Keep protocol logic |
| `components/spacer.ts` | Replace | `<box flexGrow={1}>` |
| `components/truncated-text.ts` | Replace | `<text>` with maxWidth |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Build complexity (Babel, Solid) | Follow opencode's exact build setup |
| Performance regression | OpenTUI uses native zig renderer, should be faster |
| Breaking API changes | New package, old one remains for transition |
| Missing features | OpenTUI is more feature-complete |

## Verification

1. `bun run typecheck` passes ✅
2. Existing tests adapted and passing ✅
3. `bun run marvin` works with new TUI ⏳ (Phase 5)
4. Visual parity with current rendering ⏳ (Phase 5)
5. Input handling works (editor, shortcuts) ⏳ (Phase 5)

### Testing Components

Run the demo app:
```bash
cd packages/open-tui && bun run demo
```

This shows:
- SelectList with keyboard navigation (↑/↓/Enter)
- Markdown rendering
- Editor input
- Loader animation
- Theme colors

Press ESC to go back, Q to quit.

## Recommended Approach

**Option A: Incremental** (lower risk, slower)
- Create open-tui package
- Port components one at a time
- Run both in parallel during transition

**Option B: Full replacement** (faster, more risk)
- Create complete open-tui package
- Switch coding-agent in one PR
- Delete old tui package

**Recommendation: Option A** - allows validation at each step and rollback capability.

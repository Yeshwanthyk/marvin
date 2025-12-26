# Header Migration Implementation Plan

## Overview
Move status bar items from Footer to a new sticky Header component. Restructure as 2-row, 4-section layout. Simplify Footer to borderless minimal input area.

## Current State

**Footer.tsx (lines 1-150)** renders a single-row status bar:
- Left side: proj/branch · model · thinking · context bar · queue · lsp · lsp-iter · cache
- Right side: activity/retry

**tui-app.tsx MainView (lines 618-634)** layout order:
```
<scrollbox> → <autocomplete?> → <textarea> → <Footer> → <ToastViewport>
```

### Items to Move to Header
| Item | Source | Destination Section |
|------|--------|---------------------|
| projectBranch | `createMemo` line 42 | proj context (row 1) |
| contextBar | `createMemo` line 48 | proj context (row 2) |
| shortModel | `createMemo` line 46 | model thinking (row 1) |
| thinking level | prop | model thinking (row 2) |
| lspStatus | `createMemo` line 97 | tools cache (row 1) |
| cacheIndicator | `createMemo` line 86 | tools cache (row 2) |
| activityData | `createMemo` line 68 | activity (row 1) |
| retryStatus | prop | activity (row 2) |

### Items to Remove
- `queueIndicator` (queue count)
- `lspIterationCount` (⟳ count)

### Cache Indicator Change
Current: single `⚡` when hitRate ≥ 50%
New: tiered bolts based on hitRate:
- 50-70% → `⚡`
- 70-85% → `⚡⚡`
- 85%+ → `⚡⚡⚡`

## Desired End State

```
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ proj/branch      │ opus-4           │ ⬢✦ψ (2/1)       │ · streaming      │
│ ▰▰▰▱▱ 72%        │ high             │ ⚡⚡⚡            │                  │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘

[ scrollable messages ]

> |
```

**Verification:**
```bash
bun run typecheck
bun test apps/coding-agent/tests
```
Manual: run `bun run marvin`, verify header is sticky, footer is minimal.

## Out of Scope
- Keybinding changes
- New functionality beyond layout restructure
- Theme changes

---

## Phase 1: Create Header Component

### Overview
Create new Header.tsx with 2-row, 4-section layout containing all migrated status items.

### Prerequisites
- [ ] None

### Changes

- [x] New Header Component

#### 1. New Header Component
**File**: `apps/coding-agent/src/components/Header.tsx`
**Lines**: new file

```typescript
/**
 * Header component showing sticky status bar with model, context, LSP, activity.
 * 2-row, 4-section layout.
 */

import { Show, createMemo } from "solid-js"
import { useTheme } from "@marvin-agents/open-tui"
import type { ThinkingLevel } from "@marvin-agents/agent-core"
import type { LspManager, LspServerId } from "@marvin-agents/lsp"
import type { ActivityState } from "../types.js"

/** LSP server symbols - [idle, active] pairs for pulse effect */
const LSP_SYMBOLS: Record<LspServerId, [string, string]> = {
  typescript: ["⬡", "⬢"],
  biome: ["✧", "✦"],
  basedpyright: ["ψ", "Ψ"],
  ruff: ["△", "▲"],
  ty: ["τ", "Τ"],
  gopls: ["◎", "◉"],
  "rust-analyzer": ["⛭", "⚙"],
}

export interface HeaderProps {
  modelId: string
  thinking: ThinkingLevel
  branch: string | null
  contextTokens: number
  contextWindow: number
  cacheStats: { cacheRead: number; input: number } | null
  activityState: ActivityState
  retryStatus: string | null
  lspActive: boolean
  spinnerFrame: number
  lsp: LspManager
}

export function Header(props: HeaderProps) {
  const { theme } = useTheme()

  // --- Memos (migrated from Footer) ---

  const projectBranch = createMemo(() => {
    const cwd = process.cwd()
    const project = cwd.split("/").pop() || cwd
    return project + (props.branch ? ` ⎇${props.branch}` : "")
  })

  const shortModel = createMemo(() => {
    return props.modelId.replace(/^claude-/, "")
  })

  const contextBar = createMemo(() => {
    if (props.contextWindow <= 0 || props.contextTokens <= 0) return null
    const pct = (props.contextTokens / props.contextWindow) * 100
    const pctStr = pct < 10 ? pct.toFixed(1) : Math.round(pct).toString()
    const color = pct > 90 ? theme.error : pct > 70 ? theme.warning : theme.success
    const filled = Math.min(5, Math.round(pct / 20))
    const filledBar = "▰".repeat(filled)
    const emptyBar = "▱".repeat(5 - filled)
    return { filledBar, emptyBar, pct: pctStr, color }
  })

  const activityData = createMemo(() => {
    if (props.activityState === "idle") return null
    const spinners = ["·", "•", "·", "•"]
    const spinner = spinners[props.spinnerFrame % spinners.length]
    const labels: Record<ActivityState, string> = {
      thinking: "thinking",
      streaming: "streaming",
      tool: "running",
      compacting: "compacting",
      idle: "",
    }
    const stateColors: Record<ActivityState, typeof theme.text> = {
      thinking: theme.secondary,
      streaming: theme.info,
      tool: theme.warning,
      compacting: theme.warning,
      idle: theme.textMuted,
    }
    return {
      text: `${spinner} ${labels[props.activityState]}`,
      color: stateColors[props.activityState],
    }
  })

  // Cache indicator with tiered bolts
  const cacheIndicator = createMemo(() => {
    const stats = props.cacheStats
    if (!stats || stats.input === 0) return null
    const total = stats.cacheRead + stats.input
    if (total === 0) return null
    const hitRate = stats.cacheRead / total
    if (hitRate < 0.5) return null
    // Tiered bolts: 50-70% = 1, 70-85% = 2, 85%+ = 3
    const bolts = hitRate >= 0.85 ? "⚡⚡⚡" : hitRate >= 0.7 ? "⚡⚡" : "⚡"
    return { hitRate, display: bolts }
  })

  const lspStatus = createMemo(() => {
    void props.spinnerFrame
    void props.activityState
    const servers = props.lsp.activeServers()
    if (servers.length === 0) return null

    const uniqueIds = [...new Set(servers.map((s) => s.serverId))]
    const symbolIndex = props.lspActive ? 1 : 0
    const symbols = uniqueIds.map((id) => LSP_SYMBOLS[id]?.[symbolIndex] ?? id).join(" ")

    const counts = props.lsp.diagnosticCounts()
    const hasIssues = counts.errors > 0 || counts.warnings > 0

    return { symbols, errors: counts.errors, warnings: counts.warnings, hasIssues, isActive: props.lspActive }
  })

  return (
    <box flexDirection="column" flexShrink={0} borderBottom borderColor={theme.border}>
      {/* Row 1 */}
      <box flexDirection="row" paddingLeft={1} paddingRight={1}>
        {/* Section 1: proj context */}
        <box flexGrow={1} flexBasis={0}>
          <text fg={theme.textMuted}>{projectBranch()}</text>
        </box>
        {/* Section 2: model thinking */}
        <box flexGrow={1} flexBasis={0}>
          <text fg={theme.text}>{shortModel()}</text>
        </box>
        {/* Section 3: tools cache */}
        <box flexGrow={1} flexBasis={0}>
          <Show when={lspStatus()} fallback={<text> </text>}>
            <Show when={lspStatus()!.hasIssues} fallback={
              <text fg={lspStatus()!.isActive ? theme.accent : theme.success}>{lspStatus()!.symbols}</text>
            }>
              <text>
                <span style={{ fg: lspStatus()!.isActive ? theme.accent : theme.success }}>{lspStatus()!.symbols}</span>
                <span style={{ fg: theme.textMuted }}> (</span>
                <Show when={lspStatus()!.errors > 0}>
                  <span style={{ fg: theme.error }}>{lspStatus()!.errors}</span>
                </Show>
                <Show when={lspStatus()!.errors > 0 && lspStatus()!.warnings > 0}>
                  <span style={{ fg: theme.textMuted }}>/</span>
                </Show>
                <Show when={lspStatus()!.warnings > 0}>
                  <span style={{ fg: theme.warning }}>{lspStatus()!.warnings}</span>
                </Show>
                <span style={{ fg: theme.textMuted }}>)</span>
              </text>
            </Show>
          </Show>
        </box>
        {/* Section 4: activity */}
        <box flexGrow={1} flexBasis={0} justifyContent="flex-end">
          <Show when={props.retryStatus} fallback={
            <Show when={activityData()}>
              <text fg={activityData()!.color}>{activityData()!.text}</text>
            </Show>
          }>
            <text fg="#ebcb8b">{props.retryStatus}</text>
          </Show>
        </box>
      </box>
      {/* Row 2 */}
      <box flexDirection="row" paddingLeft={1} paddingRight={1}>
        {/* Section 1: context bar */}
        <box flexGrow={1} flexBasis={0}>
          <Show when={contextBar()} fallback={<text> </text>}>
            <text>
              <span style={{ fg: contextBar()!.color }}>{contextBar()!.filledBar}</span>
              <span style={{ fg: theme.textMuted }}>{contextBar()!.emptyBar}</span>
              <span style={{ fg: theme.textMuted }}>{` ${contextBar()!.pct}%`}</span>
            </text>
          </Show>
        </box>
        {/* Section 2: thinking level */}
        <box flexGrow={1} flexBasis={0}>
          <Show when={props.thinking !== "off"} fallback={<text> </text>}>
            <text fg={theme.textMuted}>{props.thinking}</text>
          </Show>
        </box>
        {/* Section 3: cache */}
        <box flexGrow={1} flexBasis={0}>
          <Show when={cacheIndicator()} fallback={<text> </text>}>
            <text fg={theme.success}>{cacheIndicator()!.display}</text>
          </Show>
        </box>
        {/* Section 4: empty (retry already in row 1) */}
        <box flexGrow={1} flexBasis={0}>
          <text> </text>
        </box>
      </box>
    </box>
  )
}
```

**Why**: Creates the new 2-row header with all migrated status items in 4 sections.

### Success Criteria

**Automated:**
```bash
bun run typecheck  # Header.tsx compiles without errors
```

**Manual:**
- [ ] File exists at correct path

---

## Phase 2: Integrate Header into MainView

### Overview
Add Header component to tui-app.tsx before scrollbox, pass required props.

### Prerequisites
- [ ] Phase 1 complete

### Changes

- [x] Add Header Import
- [x] Add Header to MainView Layout

#### 1. Add Header Import
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: 29

**Before:**
```typescript
import { Footer } from "./components/Footer.js"
```

**After:**
```typescript
import { Footer } from "./components/Footer.js"
import { Header } from "./components/Header.js"
```

#### 2. Add Header to MainView Layout
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: 618-634 (inside MainView return)

**Before:**
```typescript
	return (
		<box flexDirection="column" width={dimensions().width} height={dimensions().height}
			onMouseUp={() => { const sel = renderer.getSelection(); if (sel && sel.getSelectedText()) copySelectionToClipboard() }}>
			<scrollbox ref={(r: ScrollBoxRenderable) => { scrollRef = r }} flexGrow={props.messages.length > 0 ? 1 : 0} flexShrink={1}>
				<MessageList messages={props.messages} toolBlocks={props.toolBlocks} thinkingVisible={props.thinkingVisible} diffWrapMode={props.diffWrapMode} concealMarkdown={props.concealMarkdown}
					isToolExpanded={isToolExpanded} toggleToolExpanded={toggleToolExpanded} isThinkingExpanded={isThinkingExpanded} toggleThinkingExpanded={toggleThinkingExpanded} />
			</scrollbox>
```

**After:**
```typescript
	return (
		<box flexDirection="column" width={dimensions().width} height={dimensions().height}
			onMouseUp={() => { const sel = renderer.getSelection(); if (sel && sel.getSelectedText()) copySelectionToClipboard() }}>
			<Header modelId={props.modelId} thinking={props.thinking} branch={branch()} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
				cacheStats={props.cacheStats} activityState={props.activityState} retryStatus={props.retryStatus} lspActive={props.lspActive} spinnerFrame={spinnerFrame()} lsp={props.lsp} />
			<scrollbox ref={(r: ScrollBoxRenderable) => { scrollRef = r }} flexGrow={props.messages.length > 0 ? 1 : 0} flexShrink={1}>
				<MessageList messages={props.messages} toolBlocks={props.toolBlocks} thinkingVisible={props.thinkingVisible} diffWrapMode={props.diffWrapMode} concealMarkdown={props.concealMarkdown}
					isToolExpanded={isToolExpanded} toggleToolExpanded={toggleToolExpanded} isThinkingExpanded={isThinkingExpanded} toggleThinkingExpanded={toggleThinkingExpanded} />
			</scrollbox>
```

**Why**: Header before scrollbox with `flexShrink={0}` makes it sticky.

### Success Criteria

**Automated:**
```bash
bun run typecheck
```

**Manual:**
- [ ] Run app, header visible at top
- [ ] Scroll messages, header stays fixed

---

## Phase 3: Simplify Footer to Borderless Minimal

### Overview
Strip Footer.tsx to minimal version — just the separator line for the input area. All status items now in Header.

### Prerequisites
- [ ] Phase 2 complete and verified

### Changes

- [x] Simplify Footer Component
- [x] Update Footer Props in MainView
- [x] Update MainViewProps (optional cleanup)
- [x] Clean up unused state in App

#### 1. Simplify Footer Component
**File**: `apps/coding-agent/src/components/Footer.tsx`

**Before:** (entire file, 150 lines)

**After:**
```typescript
/**
 * Minimal footer - just visual separation for input area.
 */

import { useTheme } from "@marvin-agents/open-tui"

export function Footer() {
  const { theme } = useTheme()

  return (
    <box flexShrink={0} minHeight={1} paddingLeft={1}>
      <text fg={theme.textMuted}>›</text>
    </box>
  )
}
```

**Why**: Borderless minimal design per user request. Just a prompt indicator.

#### 2. Update Footer Props in MainView
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: ~634 (Footer usage)

**Before:**
```typescript
			<Footer modelId={props.modelId} thinking={props.thinking} branch={branch()} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
				cacheStats={props.cacheStats} queueCount={props.queueCount} activityState={props.activityState} retryStatus={props.retryStatus} lspIterationCount={props.lspIterationCount} lspActive={props.lspActive} spinnerFrame={spinnerFrame()} lsp={props.lsp} />
```

**After:**
```typescript
			<Footer />
```

#### 3. Update MainViewProps (optional cleanup)
**File**: `apps/coding-agent/src/tui-app.tsx`

Remove from MainViewProps interface (lines ~477-490):
- `queueCount` (was for removed queue indicator)
- `lspIterationCount` (was for removed ⟳ indicator)

And remove from MainView component call in App (lines ~468).

**Note**: These props are still used by Header via direct prop passing, but queueCount and lspIterationCount are being removed entirely.

#### 4. Clean up unused state in App
**File**: `apps/coding-agent/src/tui-app.tsx`

Remove or comment out:
- `queueCount` signal and `setQueueCount` (if no longer needed anywhere)
- `lspIterationCount` signal usage in MainView props

**Why**: queueIndicator and lspIterationCount removed per user request.

### Success Criteria

**Automated:**
```bash
bun run typecheck
bun test apps/coding-agent/tests
```

**Manual:**
- [ ] Footer shows only `›` prompt indicator
- [ ] No status items in footer
- [ ] Input area still functional

---

## Phase 4: Final Cleanup

### Overview
Remove dead code, verify no regressions.

### Prerequisites
- [ ] Phase 3 complete

### Changes

- [x] Remove FooterProps Interface
- [x] Review unused imports in tui-app.tsx (no changes needed)

#### 1. Remove FooterProps Interface
**File**: `apps/coding-agent/src/components/Footer.tsx`

Already handled in Phase 3 rewrite - FooterProps removed.

#### 2. Remove Unused Imports from tui-app.tsx
Check and remove any imports only used by old Footer props:
- If `LspManager` only passed to Footer, keep for Header
- If `ActivityState` only for Footer, keep for Header

Likely no changes needed since Header uses same types.

### Success Criteria

**Automated:**
```bash
bun run typecheck
bun run test
bun run marvin --help  # binary still works
```

**Manual:**
- [ ] Full flow test: start app, send message, see header update, scroll works
- [ ] Context bar updates on response
- [ ] LSP symbols appear when editing code
- [ ] Cache bolts appear and tier up with usage

---

## Testing Strategy

### Manual Testing Checklist
1. [ ] Start app — header visible at top with 2 rows, 4 sections
2. [ ] Header shows: proj/branch, model, thinking level, context bar
3. [ ] Send message — activity spinner shows in header
4. [ ] Response received — context % updates
5. [ ] Multiple responses — cache ⚡ appears, tiers up with usage
6. [ ] Edit a .ts file — LSP symbols appear in header
7. [ ] Scroll long conversation — header stays fixed
8. [ ] Footer shows minimal `›` prompt
9. [ ] Input still works normally

## Anti-Patterns to Avoid
- Don't use absolute positioning (TUI uses flexbox only)
- Don't add new props without updating MainViewProps interface
- Keep `flexShrink={0}` on Header to prevent compression

## Open Questions
- [x] Section separators — visible borders or just spacing? → **Answer: spacing only (flexGrow with flexBasis={0})**
- [x] Widths — equal quarters or weighted? → **Answer: equal quarters via flexGrow={1} flexBasis={0}**
- [x] Items to remove — queue, lsp-iter → **Answer: confirmed removed**

## References
- Current Footer: `apps/coding-agent/src/components/Footer.tsx`
- MainView layout: `apps/coding-agent/src/tui-app.tsx:618-634`
- TUI box primitives: `@opentui/core`

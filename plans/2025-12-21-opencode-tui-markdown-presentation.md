# TUI Markdown Presentation (Minimal + Performant) Implementation Plan

**Target repo**: `/Users/yesh/Documents/personal/reference/opencode`

## Overview
Improve Markdown readability in the opencode TUI while keeping implementation minimal and performant by (1) hardening/sanitizing model text and (2) rendering fenced code blocks as dedicated code panels after message completion, while preserving current streaming behavior.

## Current State
- Assistant text parts are rendered as a single OpenTUI `<code>` buffer with `filetype="markdown"` and `streaming={true}`.
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1197`
- Reasoning (“thinking”) is also rendered as `filetype="markdown"` streaming.
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1164`
- Markdown “styling” is purely Tree-sitter highlight scopes mapped in the theme.
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx:784`
- Inline code (`markup.raw.inline`) uses `background: theme.background`, effectively no visual separation.
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx:868`
- Parsers are registered once at startup via `addDefaultParsers(parsers.parsers)`; markdown/js/ts are noted as OpenTUI built-ins.
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:51`
  - `packages/opencode/parsers-config.ts:2`

### Key Discoveries
- OpenTUI `CodeRenderable` supports `conceal`, `drawUnstyledText`, and async Tree-sitter highlighting; `drawUnstyledText=false` avoids temporarily showing un-concealed content.
- `strip-ansi` is already a dependency and used for tool output (`bash` tool render).
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1380`

## Desired End State
- Markdown prose remains syntax-highlighted as today.
- Fenced code blocks inside assistant markdown are displayed as separate “code panels” with:
  - background panel tint + left border
  - optional language label
  - syntax highlighting based on fence info string (best-effort mapping)
  - `conceal=false` inside code panels (don’t mutate code)
- Streaming remains **unchanged**: while the message is still being generated, render the current single `<code filetype="markdown" streaming>` buffer.
- Model text is sanitized (strip ANSI + normalize newlines/tabs) before rendering to prevent layout breakage / terminal control injection.

### How to Verify
**Automated**:
```bash
cd packages/opencode
bun run typecheck
bun test
```

**Manual**:
```bash
cd packages/opencode
bun dev
```
- In TUI, view an assistant message containing:
  - headings + bullet lists
  - inline code (e.g. `` `Type.Object(...)` ``)
  - a fenced code block (```ts … ```)
- Confirm:
  - inline code has a subtle background tint
  - fenced blocks appear as a distinct panel with readable syntax highlighting
  - no flicker/leak of concealed content during highlight

## Out of Scope
- Full structural markdown renderer (tables/layout, list hanging indents, admonitions).
- Interactive affordances (copy-code, collapse blocks, link opening).
- Horizontal scrolling inside code blocks.

## Error Handling Strategy
- Never throw in render paths.
- Fence parsing must be tolerant:
  - If a fence is unclosed, treat it as plain markdown (no block split) to avoid losing content.
  - Unknown/unsupported fence languages fall back to `text` (no highlight) rather than erroring.

## Implementation Approach
Choose “minimal + performant” approach:
- Keep current Tree-sitter markdown highlighting for prose.
- Add a small, dependency-free fence splitter that runs only when a message is completed (non-streaming).
- Render code fences as separate `<code>` blocks using existing OpenTUI primitives and theme colors.

### Alternative Considered (Not chosen)
**Full markdown AST renderer** (e.g., `marked`/`micromark`) for proper block layout.
- Pros: correct markdown layout (tables, lists, blockquotes).
- Cons: more code, streaming complexity, higher CPU due to repeated parsing.

---

## Phase 1: Add Markdown Sanitization + Fence Splitting Utility

### Overview
Create a reusable utility for:
- sanitizing model markdown text (ANSI stripping, newline normalization, tab normalization)
- splitting completed markdown into prose blocks + fenced code blocks
- mapping fence info-string languages to Tree-sitter filetypes

### Prerequisites
- [ ] No local edits pending (clean working tree recommended)

### Changes

#### 1. Add `splitMarkdownCodeFences` + `sanitizeTuiMarkdown`
**File**: `packages/opencode/src/cli/cmd/tui/util/markdown.ts` (new file)

**Add**:
```ts
import stripAnsi from "strip-ansi"

export type MarkdownRenderBlock =
  | {
      type: "markdown"
      text: string
    }
  | {
      type: "code"
      lang?: string
      code: string
    }

export function sanitizeTuiMarkdown(input: string): string {
  // Security + stability: prevent ANSI escapes from breaking layout / injecting control sequences.
  // Normalize newlines/tabs so highlight/wrapping behaves consistently.
  return stripAnsi(input).replace(/\r\n?/g, "\n").replace(/\t/g, "  ")
}

export function fenceLangToFiletype(lang?: string): string {
  const raw = (lang ?? "").trim().toLowerCase()
  if (!raw) return "text"

  // Common aliases → OpenTUI parsers filetypes
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
  }

  return map[raw] ?? raw
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function splitMarkdownCodeFences(input: string): MarkdownRenderBlock[] {
  const text = input.replace(/\r\n?/g, "\n")
  const lines = text.split("\n")

  const blocks: MarkdownRenderBlock[] = []
  let markdownLines: string[] = []

  let inFence = false
  let fenceIndent = ""
  let fenceMarker = ""
  let fenceLang: string | undefined
  let fenceOpenLine = ""
  let codeLines: string[] = []

  function flushMarkdown() {
    const md = markdownLines.join("\n").trim()
    markdownLines = []
    if (md) blocks.push({ type: "markdown", text: md })
  }

  for (const line of lines) {
    if (!inFence) {
      const open = line.match(/^(\s*)(```|~~~)\s*([^\s`~]+)?\s*$/)
      if (open) {
        flushMarkdown()
        inFence = true
        fenceIndent = open[1] ?? ""
        fenceMarker = open[2] ?? "```"
        fenceLang = open[3]
        fenceOpenLine = line
        codeLines = []
        continue
      }
      markdownLines.push(line)
      continue
    }

    const closeRe = new RegExp(`^${escapeRegExp(fenceIndent)}${escapeRegExp(fenceMarker)}\\s*$`)
    if (closeRe.test(line)) {
      const code = codeLines.join("\n").replace(/\n+$/g, "")
      blocks.push({ type: "code", lang: fenceLang, code })
      inFence = false
      fenceIndent = ""
      fenceMarker = ""
      fenceLang = undefined
      fenceOpenLine = ""
      codeLines = []
      continue
    }

    // If the fence was indented (e.g. inside list), remove that indentation from code lines when present.
    if (fenceIndent && line.startsWith(fenceIndent)) {
      codeLines.push(line.slice(fenceIndent.length))
    } else {
      codeLines.push(line)
    }
  }

  // Unclosed fence: treat as markdown (preserve content)
  if (inFence) {
    markdownLines.push(fenceOpenLine)
    markdownLines.push(...codeLines)
  }

  flushMarkdown()
  return blocks
}
```

**Why**: keeps all parsing logic small, deterministic, testable, and only used post-completion.

### Edge Cases to Handle
- [ ] Unclosed fence: render as markdown (no splitting)
- [ ] Indented fence inside list: remove indent from code lines when present
- [ ] Unknown language tag: fallback to `text`

### Success Criteria
- [ ] Utility compiles and is importable from TUI

### Rollback
```bash
git checkout HEAD -- packages/opencode/src/cli/cmd/tui/util/markdown.ts
```

---

## Phase 2: Render Completed Messages With Fenced Code Panels

### Overview
Keep current streaming renderer, but once `message.time.completed` is set, render as:
- markdown prose blocks via `<code filetype="markdown">`
- fenced blocks via a styled container + `<code filetype={mapped}>`

### Prerequisites
- [ ] Phase 1 complete

### Changes

#### 1. Import new util
**File**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

**Add imports** (near other imports):
```ts
import { fenceLangToFiletype, sanitizeTuiMarkdown, splitMarkdownCodeFences } from "../../util/markdown"
```

#### 2. Update `TextPart` rendering
**File**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
**Lines**: 1197-1215

**Before**:
```tsx
function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={syntax()}
          content={props.part.text.trim()}
          conceal={ctx.conceal()}
          fg={theme.text}
        />
      </box>
    </Show>
  )
}
```

**After**:
```tsx
function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const text = createMemo(() => sanitizeTuiMarkdown(props.part.text).trim())
  const completed = createMemo(() => !!props.message.time.completed)
  const blocks = createMemo(() => splitMarkdownCodeFences(text()))

  return (
    <Show when={text()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column" gap={1}>
        <Show
          when={completed()}
          fallback={
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={text()}
              conceal={ctx.conceal()}
              fg={theme.text}
            />
          }
        >
          <For each={blocks()}>
            {(block) => {
              if (block.type === "markdown") {
                return (
                  <code
                    filetype="markdown"
                    drawUnstyledText={false}
                    streaming={false}
                    syntaxStyle={syntax()}
                    content={block.text}
                    conceal={ctx.conceal()}
                    fg={theme.text}
                  />
                )
              }

              return (
                <box
                  backgroundColor={theme.backgroundPanel}
                  border={["left"]}
                  customBorderChars={SplitBorder.customBorderChars}
                  borderColor={theme.borderSubtle}
                  paddingLeft={2}
                  paddingTop={1}
                  paddingBottom={1}
                  flexDirection="column"
                  gap={1}
                >
                  <Show when={block.lang}>
                    <text fg={theme.textMuted}>{block.lang}</text>
                  </Show>
                  <code
                    filetype={fenceLangToFiletype(block.lang)}
                    drawUnstyledText={true}
                    streaming={false}
                    syntaxStyle={syntax()}
                    content={block.code}
                    conceal={false}
                    fg={theme.text}
                  />
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}
```

**Why**: huge readability win for code fences without touching streaming path (no repeated parsing).

### Edge Cases to Handle
- [ ] Message with only code fence: renders as a single panel
- [ ] Multiple fences: renders multiple panels in order
- [ ] Empty markdown chunks between fences: no empty blocks rendered

### Success Criteria
**Automated**:
```bash
cd packages/opencode
bun run typecheck
bun test
```

**Manual**:
- [ ] Streaming output still appears while model is generating
- [ ] After completion, the same message re-renders into markdown + code panels (no missing content)

### Rollback
```bash
git checkout HEAD -- packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
```

---

## Phase 3: Improve Inline Code Readability (Theme)

### Overview
Give inline code a subtle background tint to visually separate it from prose.

### Prerequisites
- [ ] Phase 2 complete

### Changes

#### 1. Update `markup.raw.inline` background
**File**: `packages/opencode/src/cli/cmd/tui/context/theme.tsx`
**Lines**: 868-873

**Before**:
```ts
{
  scope: ["markup.raw.inline"],
  style: {
    foreground: theme.markdownCode,
    background: theme.background,
  },
},
```

**After**:
```ts
{
  scope: ["markup.raw.inline"],
  style: {
    foreground: theme.markdownCode,
    background: theme.backgroundElement,
  },
},
```

**Why**: makes inline code pop without adding new theme tokens or dependencies.

### Success Criteria
- [ ] Inline code is visually distinct across themes

### Rollback
```bash
git checkout HEAD -- packages/opencode/src/cli/cmd/tui/context/theme.tsx
```

---

## Phase 4: Tests

### Overview
Add unit tests for fence splitting + sanitization to prevent regressions.

### Prerequisites
- [ ] Phase 1 complete

### Changes

#### 1. Add fence splitter tests
**File**: `packages/opencode/test/util/markdown-fences.test.ts` (new file)

**Add**:
```ts
import { describe, expect, test } from "bun:test"
import { fenceLangToFiletype, sanitizeTuiMarkdown, splitMarkdownCodeFences } from "../../src/cli/cmd/tui/util/markdown"

describe("tui.markdown", () => {
  test("sanitizes ansi + normalizes newlines/tabs", () => {
    const input = "hello\u001b[31mred\u001b[0m\r\n\tworld"
    expect(sanitizeTuiMarkdown(input)).toBe("hellored\n  world")
  })

  test("splits a single fenced block", () => {
    const input = "A\n\n```ts\nconst x = 1\n```\n\nB"
    expect(splitMarkdownCodeFences(input)).toEqual([
      { type: "markdown", text: "A" },
      { type: "code", lang: "ts", code: "const x = 1" },
      { type: "markdown", text: "B" },
    ])
  })

  test("unclosed fence is treated as markdown", () => {
    const input = "A\n```ts\nconst x = 1"
    expect(splitMarkdownCodeFences(input)).toEqual([{ type: "markdown", text: input }])
  })

  test("strips fence indent from code lines when present", () => {
    const input = "- item\n  ```js\n  console.log(1)\n  ```"
    expect(splitMarkdownCodeFences(input)).toEqual([
      { type: "markdown", text: "- item" },
      { type: "code", lang: "js", code: "console.log(1)" },
    ])
  })

  test("maps common fence language aliases", () => {
    expect(fenceLangToFiletype("ts")).toBe("typescript")
    expect(fenceLangToFiletype("py")).toBe("python")
    expect(fenceLangToFiletype("yml")).toBe("yaml")
    expect(fenceLangToFiletype("unknown")).toBe("unknown")
    expect(fenceLangToFiletype("")).toBe("text")
  })
})
```

### Success Criteria
```bash
cd packages/opencode
bun test test/util/markdown-fences.test.ts
```

### Rollback
```bash
git checkout HEAD -- packages/opencode/test/util/markdown-fences.test.ts
```

---

## Testing Strategy
- Unit tests: cover sanitizer + fence splitting behavior and tricky edge cases.
- Manual: validate visually in TUI on real model output (headings + bullet lists + code fences).

## Anti-Patterns to Avoid
- Parsing markdown repeatedly while `streaming={true}` (will cause reflow + CPU churn).
- Setting `drawUnstyledText={true}` while `conceal={true}` for markdown blocks (can briefly leak un-concealed text).
- Trying to fully implement markdown layout inside this change (scope creep).

## Open Questions (must resolve before implementation)
- None.

## References
- Text rendering: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1197`
- Theme markdown scopes: `packages/opencode/src/cli/cmd/tui/context/theme.tsx:784`
- Parser config note: `packages/opencode/parsers-config.ts:2`

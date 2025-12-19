# Split plan: `packages/tui/src/components/editor.ts`

## Goal
- Keep public API stable (`Editor`, `EditorTheme`, callbacks, keybindings).
- Reduce cognitive load + make behavior “local”: each concern owns its own state + invariants.
- Preserve current semantics (cursor/backspace in code-units; wrapping via `visibleWidth` + `Intl.Segmenter`).

## Current concerns (mixed in one class)
- Document model: `lines[]`, `cursorLine/Col`, insert/delete/move.
- Visual layout: wrapping + “visual line map” for Up/Down.
- Input routing: giant `handleInput` with many early-returns.
- Bracketed paste buffering + large paste marker store/substitution.
- History browsing state machine.
- Autocomplete UI (provider + `SelectList`) and trigger/update rules.

## Options
### A) Minimal extraction (lowest risk)
**Approach**: keep `Editor` state as-is; move blocks of methods into `components/editor/*.ts` as functions that operate on an `Editor` instance.
- Pros: fastest; almost no behavioral risk.
- Cons: still hard to reason about (implicit coupling via `this`), limited AI/human benefit.

### B) Controller split (recommended)
**Approach**: keep `Editor` as a thin facade; extract stateful sub-objects with explicit APIs.
- Pros: boundaries/invariants become explicit; easier to test; fewer “spooky action at a distance” edits.
- Cons: small amount of wiring + signature churn internally.

### C) Command router (highest ROI, most change)
**Approach**: parse `data` → typed `EditorCommand` union; `applyCommand(state)`; side-effects (callbacks) in shell.
- Pros: extremely readable/testable; great for agents.
- Cons: bigger refactor; more surface area touched.

## Recommended target structure (Option B)
Create `packages/tui/src/components/editor/`:
- `types.ts`: `EditorState`, `LayoutLine`, small shared types.
- `document.ts`: `EditorDocument` (lines + cursor) + edit ops (insert/newline/backspace/delete-word/etc).
- `layout.ts`: `layoutText`, `buildVisualLineMap`, `findCurrentVisualLine` (pure, state-in → mapping/out).
- `history.ts`: `HistoryNavigator` (history array + index) + `navigate()` returning the text to load.
- `paste.ts`: `PasteController` (bracketed paste buffering + large paste store) + `substitutePasteMarkers()`.
- `autocomplete.ts`: `AutocompleteController` (provider/list/prefix) + `handleInput()`/`maybeTrigger()`.
- `keys.ts` (optional): normalize key predicates/constants to shrink branching in `handleInput`.

Keep `packages/tui/src/components/editor.ts` as the only exported entry:
- wires controllers
- owns callbacks (`onSubmit`, `onChange`, …)
- delegates `render()` to `layout.ts` + cursor rendering helper
- delegates `handleInput()` to: paste → global shortcuts → autocomplete → document edits → submit

## Step-by-step
- [x] 1. **Baseline safety**: add 1–2 characterization tests for paste marker substitution + bracketed paste buffering (currently untested).
- [x] 2. Extract `types.ts` + move `layoutText`/visual-line mapping into `layout.ts` (pure functions; no behavior change).
- [ ] 3. Extract `document.ts` (text ops + cursor movement). Keep exact semantics; only relocate code.
- [ ] 4. Extract `history.ts`; remove repeated `historyIndex = -1` by centralizing “exit history mode” in one call site.
- [ ] 5. Extract `paste.ts`; remove stray dead comment; make paste marker regex generation unit-testable.
- [ ] 6. Extract `autocomplete.ts`; remove `as any` casts where avoidable; keep trigger rules identical.
- [ ] 7. Shrink `Editor.handleInput` into a small staged pipeline; ensure each stage returns `{handled, remaining}` (prevents nested conditionals).
- [ ] 8. Run typecheck + editor tests; ensure no public export/import changes.

## Risks
- ESM pathing (`.js` extensions) when moving files; avoid runtime cycles by using `import type`.
- Cursor/wrapping off-by-one behavior; keep `EditorDocument` invariants explicit and covered by existing `packages/tui/test/editor.test.ts`.
- Paste buffering split across chunks; add characterization test before refactor.

## Verification
- `bun run typecheck`
- `bun test packages/tui/test/editor.test.ts`
- (after adding paste tests) `bun test packages/tui/test/editor.test.ts` should stay green + new cases pass

# OpenTUI parity checklist (coding-agent)

## Baseline
- Legacy TUI (source of truth): `apps/coding-agent/src/tui-app.ts` + `apps/coding-agent/src/tui/*`
- OpenTUI candidate: `apps/coding-agent/src/run-open.ts` → `apps/coding-agent/src/tui-app-open.tsx` (+ `apps/coding-agent/src/tui-open-rendering.tsx`)

Legend: **P0** must-have to dogfood, **P1** parity/UX, **P2** maintainability.

---

## P0 — Core workflow parity

### CLI + entry wiring
- [x] **OpenTUI runner accepts CLI flags**: `--provider/--model/--thinking/--config-dir/--config`, plus `-c/--continue`, `-r/--resume`.
  - Legacy path: `apps/coding-agent/src/index.ts` → `runTui({...})`
  - Current OpenTUI runner ignores args: `apps/coding-agent/src/run-open.ts` calls `runTuiOpen()` with no args.
- [x] **Pick UI implementation from main CLI** (flag or config): allow selecting legacy vs OpenTUI without separate entrypoint.

### Session persistence + restore
- [x] **Start+append sessions** like legacy `SessionManager` (`apps/coding-agent/src/session-manager.ts`).
  - Start on first user prompt (legacy: `ensureSession()`)
  - Append user + assistant messages (legacy: `sessionManager.appendMessage()` in both submit + `message_end` handler)
- [x] **Continue latest session** (`-c/--continue`) for current cwd (legacy: `handleContinueSession()` in `apps/coding-agent/src/tui/session-restore.ts`).
- [x] **Resume from picker** (`-r/--resume`) (legacy: `selectSession()` in `apps/coding-agent/src/tui/session-picker.ts`).
  - Currently uses legacy picker (OpenTUI render() lacks cleanup/exit mechanism for pre-app modals).
  - TODO: Implement as dialog within main app instead of separate render.
- [x] **Restore provider/model/thinking from session metadata** (legacy: `restoreSession()` in `apps/coding-agent/src/tui/session-restore.ts`).

### Slash commands
- [x] **Built-in slash commands parity** (legacy: `apps/coding-agent/src/tui/command-handlers.ts`):
  - `/exit`, `/quit`
  - `/clear`
  - `/abort`
  - `/model ...`
  - `/thinking ...`
  - `/compact [custom-instructions...]`

### Model switching + thinking switching
- [x] **Ctrl+P model cycling** using comma-separated `--model` list (legacy: `cycleModels` logic in `apps/coding-agent/src/tui-app.ts`).
  - Support `provider/modelId` entries.
  - Update agent model + footer + persist config (`updateAppConfig()` in `apps/coding-agent/src/config.ts`).
- [x] **Shift+Tab thinking level cycling** (legacy: `thinkingLevels` in `apps/coding-agent/src/tui-app.ts`).
  - Update agent thinking level + footer + persist config.

### Queue + retry
- [x] **Queue messages while responding** (legacy: `queuedMessages` + `agent.queueMessage()` in `apps/coding-agent/src/tui-app.ts`).
  - UI indicator (legacy footer shows `Nq`)
  - When queued message starts processing, render it immediately (legacy: `createAgentEventHandler()` handles `message_start` for `user`).
  - `Esc` abort should restore queued text back into the editor (legacy behavior).
- [x] **Retry/backoff on transient provider errors** (legacy: retry logic inside `apps/coding-agent/src/tui/agent-events.ts`).
  - Exponential backoff, max retries, `Esc` cancels retry
  - Uses `agent.continue()` after removing the last assistant error message.

### Tool output expansion
- [x] **Ctrl+O expand/collapse actually works** for completed tool outputs.
  - Legacy: stores full output per `toolCallId` and rerenders all tool blocks on toggle (`toolBlocks` map + `renderToolWithExpand()` in `apps/coding-agent/src/tui/message-rendering.ts`).
  - Fixed: expanded prop now passed through ToolBlockComponent → ToolBody → BashBody/WriteBody.

### Clear/abort/exit key semantics
- [x] **Ctrl+C behavior parity**:
  - If responding: abort
  - If idle: clear input; double Ctrl+C exits (legacy: `apps/coding-agent/src/tui-app.ts`)
- [x] **Esc behavior parity**:
  - If responding: abort
  - If retry backoff scheduled: cancel retry

---

## P1 — Rendering + UX parity

### Markdown + formatting
- [ ] **Render assistant text as Markdown** (legacy uses `Markdown` component + `markdownTheme`).
  - OpenTUI should use `packages/open-tui/src/components/markdown.tsx`.
  - [ ] Wire code-block highlighting using `apps/coding-agent/src/syntax-highlighting.ts` (legacy uses it for `write` tool rendering).

### Tool rendering parity (and current bugs)
- [ ] **`write` tool syntax highlighting** (legacy: `renderToolWithExpand()` in `apps/coding-agent/src/tui/message-rendering.ts`).
- [ ] **`edit` tool without diff renders something** (current OpenTUI bug):
  - In `apps/coding-agent/src/tui-open-rendering.tsx`, `ToolBody` explicitly excludes `edit`, so edit-with-error/no-diff shows an empty body.
- [ ] **Bash/tool output expanded mode** should show full (or at least last N lines) when expanded, not always head+tail truncation.
- [ ] **Read tool**: consider legacy's single-line summary (no multi-line body) for density.

### Footer parity
- [x] **Queue count indicator** (`Nq`)
- [x] **Retry status takes over footer line** (legacy: `Footer.setRetryStatus()`)
- [ ] **`waiting` activity state** (legacy footer supports it)
- [x] **Footer layout fixed** - uses terminal dimensions to stay at bottom

### Autocomplete parity
- [ ] **Slash command autocomplete** (+ argument completion)
  - Legacy: `createAutocompleteCommands()` in `apps/coding-agent/src/tui/autocomplete-commands.ts`.
- [ ] **File path + `@` fuzzy file attachment autocomplete**
  - Legacy: `packages/tui/src/autocomplete.ts` (CombinedAutocompleteProvider).
- [ ] **UI for suggestions**: popover list using OpenTUI `SelectList`.

### Shutdown/signal handling
- [ ] **Graceful stop**: ensure renderer teardown + watcher cleanup on exit.
- [ ] **Handle SIGINT** similar to legacy (`process.on('SIGINT', ...)`).

---

## P2 — Maintainability / avoiding divergence
- [ ] **Extract UI-agnostic core** for:
  - slash command parsing/execution
  - session IO/restore
  - retry policy
  - tool output collapsing/expansion policy
  so both UIs share behavior and only rendering differs.
- [ ] **Tests** for core behaviors (only where repo already has tests; likely `apps/coding-agent/tests`).

---

## Current OpenTUI gaps/bugs (quick list)
- [x] Ctrl+O toggles state but tool rendering ignores it (misleading "Ctrl+O to expand" hints exist).
- [ ] `edit` tool without diff produces blank body.
- [x] No submit while responding (no queue).
- [x] No built-in slash commands.
- [x] No session continue/resume.
- [x] No Ctrl+P model cycling / Shift+Tab thinking cycling.
- [x] `apps/coding-agent/src/run-open.ts` ignores CLI args entirely.

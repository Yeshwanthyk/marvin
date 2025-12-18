# Plan: `pi` QOL parity for `marvin`

## Remaining Features

### 1. Sessions (`-c`, `-r`)
Persist/resume conversations via JSONL files.

**CLI flags:**
- `--continue` / `-c` — load most recent session for cwd
- `--resume` / `-r` — picker UI to select session

**Storage:** `~/.config/marvin/sessions/--<safe-cwd>--/<timestamp>_<uuid>.jsonl`

**Format:**
```jsonl
{type:"session", id, timestamp, cwd, provider, modelId, thinkingLevel}
{type:"message", timestamp, message: AppMessage}
```

**Reference:** `reference/pi-mono/packages/coding-agent/src/core/session-manager.ts`

---

### 2. Message Queueing
Submit while streaming; queue shows count; `Esc` restores queued to editor.

**Changes to `tui-app.ts`:**
- Keep editor enabled while streaming
- `let queuedMessages: string[] = []`
- On submit while responding: push to queue, call `agent.queueMessage()`, update footer
- On `message_start` for user msg: remove from queue
- On `Esc` abort: restore queued messages to editor via `agent.clearMessageQueue()`

**Reference:** `reference/pi-mono/packages/coding-agent/src/core/agent-session.ts`

---

### 3. Tool Output Ctrl+O Toggle
Currently: always collapsed with fixed maxLines. Need: toggle to expand/collapse.

**Changes:**
- Add `let toolOutputExpanded = false`
- Track tool output in `Map<toolCallId, { fullText, ... }>`
- `Ctrl+O` (`\x0f`) toggles state and re-renders tool blocks
- Collapsed: last N lines + "... (N earlier lines)"
- Expanded: full output

**Reference:** `reference/pi-mono/packages/coding-agent/src/modes/interactive/components/tool-execution.ts`

---

### 4. Streaming/Running Indicator
Show visual feedback when tool is executing or response is streaming. Currently no indicator between submit and first token.

---

### 5. Auto Retry/Backoff
Retry 429/5xx with exponential backoff, UI status, `Esc` to cancel.

**Config:** `{ enabled: true, maxRetries: 3, baseDelayMs: 2000 }`

**Retryable pattern:**
```ts
/overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error/i
```

**Flow on `agent_end` with retryable error:**
1. Increment attempt, compute delay (`baseDelayMs * 2^(attempt-1)`)
2. Show status: `Retrying (1/3) in 2s... (esc to cancel)`
3. Remove trailing error message: `agent.replaceMessages(messages.slice(0,-1))`
4. Abortable sleep
5. Call `agent.continue()`

**Esc during retry:** cancel sleep, clear status, reset state

**Reference:** `reference/pi-mono/packages/coding-agent/src/core/agent-session.ts`

---

## Completed ✓

- **Token % indicator** — Footer shows `xx.x%/contextWindow`, color-coded
- **Global AGENTS.md** — Loads `~/.config/marvin/agents.md`, `~/.codex/agents.md`, `~/.claude/CLAUDE.md` + project-level
- **Tool collapse (partial)** — Shows tail + "earlier lines", but no toggle yet
- **Fuzzy file picker** — `@` triggers autocomplete with ripgrep + fuzzysort, respects gitignore
- **Sessions (`-c`, `-r`)** — JSONL persistence in `~/.config/marvin/sessions/`, `-c` loads latest, `-r` shows list + loads latest
- **Message queueing** — Submit while streaming queues message, shows `[N queued]` in footer, Esc restores to editor
- **Ctrl+O toggle** — Toggles tool output between collapsed (last N lines) and full expanded view
- **Auto retry/backoff** — Retries 429/5xx errors with exponential backoff, shows status in footer, Esc cancels
- **Streaming indicator** — Loader component shows "Thinking..." / "Retrying..." during requests

---

## Implementation Order

1. ~~Sessions (`-c`, `-r`)~~ ✓
2. ~~Message queueing~~ ✓
3. ~~Ctrl+O toggle~~ ✓
4. ~~Streaming/running indicator~~ ✓ (already had Loader)
5. ~~Auto retry/backoff~~ ✓

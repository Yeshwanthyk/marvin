# pi-mono Reference Documentation

Reference documentation for [pi-mono](https://github.com/badlogic/pi-mono), the original codebase that marvin is derived from. This document tracks key structures, patterns, and implementations for reference when implementing similar features in marvin.

---

## Repository Structure

```
pi-mono/
├── packages/
│   ├── ai/              # LLM provider abstraction (multi-provider, tool calling)
│   ├── agent/           # Agent runtime with event streams and transports
│   ├── tui/             # Terminal UI framework (differential rendering)
│   ├── coding-agent/    # Main CLI app ("pi")
│   ├── web-ui/          # Web chat components
│   ├── proxy/           # CORS/OAuth proxy for browser clients
│   ├── mom/             # Slack bot using coding-agent
│   └── pods/            # GPU pod + vLLM deployment CLI
├── scripts/
│   └── sync-versions.js # Lockstep version synchronizer
├── AGENTS.md            # Development rules
├── package.json         # Workspace config
├── tsconfig.base.json   # Shared TS config
└── biome.json           # Lint/format rules
```

---

## Core Packages

### @mariozechner/pi-ai

**Purpose**: Unified multi-provider LLM API with automatic model discovery, tool calling, and token/cost tracking.

**Key Features**:
- Supports: OpenAI, Anthropic, Google, Mistral, Groq, Cerebras, xAI, OpenRouter, GitHub Copilot, OpenAI-compatible APIs
- TypeBox schemas for type-safe tool definitions with AJV validation
- Cross-provider handoffs (messages transform automatically between providers)
- OAuth support for Anthropic, GitHub Copilot, Gemini CLI
- Streaming events: `start`, `text_delta`, `thinking_delta`, `toolcall_delta`, `done`, `error`
- Context serialization (JSON-compatible for persistence)

**Key Exports**:
- `getModel(provider, modelId)` - Get typed model
- `stream(model, context, options)` - Stream LLM response
- `complete(model, context, options)` - Get complete response
- `agentLoop(userMessage, context, config)` - Full agent loop with tool execution

**Location**: `packages/ai/`

---

### @mariozechner/pi-agent-core

**Purpose**: Stateful agent abstraction with reactive event system and pluggable transports.

**Key Features**:
- `Agent` class manages conversation state, emits granular events
- Message queue for injecting messages at next turn
- Transport abstraction: `ProviderTransport` (direct), `AppTransport` (proxy)
- Custom message types via declaration merging

**Events**:
| Event | Description |
|-------|-------------|
| `agent_start` / `agent_end` | Agent lifecycle |
| `turn_start` / `turn_end` | Turn boundaries (LLM response + tool executions) |
| `message_start` / `message_update` / `message_end` | Message lifecycle |
| `tool_execution_start` / `tool_execution_update` / `tool_execution_end` | Tool execution |

**Location**: `packages/agent/`

---

### @mariozechner/pi-tui

**Purpose**: Minimal TUI framework with differential rendering.

**Key Features**:
- Three-strategy rendering (first render, width change, normal update)
- Synchronized output using CSI 2026 (atomic, flicker-free)
- Bracketed paste mode with markers for >10 line pastes
- Components: Text, Input, Editor, Markdown, Loader, SelectList, Spacer, Image, Box, Container
- Autocomplete for slash commands and file paths
- Inline images (Kitty/iTerm2 protocols)

**Location**: `packages/tui/`

---

## coding-agent Architecture

### Directory Structure

```
packages/coding-agent/src/
├── cli.ts                    # CLI entry point
├── main.ts                   # Main orchestration, mode routing
├── config.ts                 # APP_NAME, paths (getAgentDir, etc.)
│
├── cli/                      # CLI utilities
│   ├── args.ts               # Argument parsing
│   ├── file-processor.ts     # @file argument handling
│   ├── list-models.ts        # --list-models
│   └── session-picker.ts     # Session resume UI
│
├── core/                     # Business logic (mode-agnostic)
│   ├── agent-session.ts      # ** CENTRAL ABSTRACTION **
│   ├── session-manager.ts    # JSONL persistence
│   ├── settings-manager.ts   # User preferences
│   ├── compaction.ts         # Context compaction
│   ├── bash-executor.ts      # Bash with streaming/abort
│   ├── slash-commands.ts     # Custom command loading
│   ├── skills.ts             # On-demand capabilities
│   ├── system-prompt.ts      # System prompt building
│   ├── hooks/                # Hook system
│   ├── custom-tools/         # Custom tool loading
│   └── tools/                # Built-in tools (read, write, edit, bash, grep, find, ls)
│
├── modes/                    # Run modes
│   ├── interactive/          # TUI mode
│   │   ├── interactive-mode.ts
│   │   ├── components/       # UI components
│   │   └── theme/            # Theming
│   ├── print-mode.ts         # Non-interactive
│   └── rpc/                  # JSON stdin/stdout protocol
│
└── utils/                    # Generic utilities
```

### Key Abstractions

#### AgentSession (`core/agent-session.ts`)

**The central abstraction** wrapping low-level `Agent` with:
- Session persistence via SessionManager
- Settings persistence via SettingsManager
- Model cycling (scoped models from `--models` flag)
- **Context compaction** (auto and manual)
- **Bash execution** with streaming output
- **Branching** from any user message
- **Auto-retry** for transient errors (429, 5xx, overloaded)
- Hook integration
- Custom tool loading

All three modes (interactive, print, rpc) use AgentSession.

#### SessionManager (`core/session-manager.ts`)

JSONL-based session persistence:

```typescript
// Session entry types
interface SessionHeader {
  type: 'session';
  id: string;
  timestamp: string;
  cwd: string;
  branchedFrom?: string;  // Parent session for branches
}

interface SessionMessageEntry {
  type: 'message';
  timestamp: string;
  message: AppMessage;
}

interface CompactionEntry {
  type: 'compaction';
  timestamp: string;
  summary: string;
  firstKeptEntryIndex: number;
  tokensBefore: number;
}

type SessionEntry = SessionHeader | SessionMessageEntry | ThinkingLevelChangeEntry | ModelChangeEntry | CompactionEntry;
```

**Key Methods**:
- `create(cwd, sessionDir?)` - New session
- `open(path, sessionDir?)` - Open existing session
- `continueRecent(cwd, sessionDir?)` - Continue most recent
- `inMemory(cwd?)` - No file persistence
- `createBranchedSessionFromEntries(entries, branchBeforeIndex)` - **Creates branched session**
- `buildSessionContext()` - Get messages for LLM (handles compaction)

---

## /branch Command System

### Overview

The `/branch` command creates a new session from any previous user message, allowing exploration of alternative conversation paths.

### Implementation Flow

1. **User invokes `/branch`** (or double-Escape with empty editor)
   - `interactive-mode.ts:643` - handles `/branch` command
   - `interactive-mode.ts:571` - double-Escape triggers branch selector

2. **Show user message selector**
   - `showUserMessageSelector()` in interactive-mode.ts
   - Uses `UserMessageSelectorComponent` (`components/user-message-selector.ts`)
   - Gets messages via `session.getUserMessagesForBranching()`

3. **AgentSession.getUserMessagesForBranching()** (`agent-session.ts:1429`)
   - Scans session entries for user messages
   - Returns `Array<{ entryIndex: number; text: string }>`

4. **User selects a message**
   - Selector calls `onSelect(entryIndex)`

5. **AgentSession.branch(entryIndex)** (`agent-session.ts:1361`)
   ```typescript
   async branch(entryIndex: number): Promise<{ selectedText: string; cancelled: boolean }> {
     // 1. Get entries and validate
     const entries = this.sessionManager.getEntries();
     const selectedEntry = entries[entryIndex];
     
     // 2. Emit before_branch hook (cancellable)
     if (this._hookRunner?.hasHandlers('session')) {
       const result = await this._hookRunner.emit({
         type: 'session',
         reason: 'before_branch',
         targetTurnIndex: entryIndex,
         // ...
       });
       if (result?.cancel) return { selectedText, cancelled: true };
     }
     
     // 3. Create branched session (JSONL file with entries BEFORE selected message)
     const newSessionFile = this.sessionManager.createBranchedSessionFromEntries(entries, entryIndex);
     
     // 4. Update session file reference
     if (newSessionFile !== null) {
       this.sessionManager.setSessionFile(newSessionFile);
     }
     
     // 5. Reload messages from new session
     const sessionContext = this.sessionManager.buildSessionContext();
     
     // 6. Emit branch hook (after completion)
     await this._hookRunner.emit({
       type: 'session',
       reason: 'branch',
       targetTurnIndex: entryIndex,
       // ...
     });
     
     // 7. Replace agent messages
     this.agent.replaceMessages(sessionContext.messages);
     
     return { selectedText, cancelled: false };
   }
   ```

6. **SessionManager.createBranchedSessionFromEntries()** (`session-manager.ts:376`)
   ```typescript
   createBranchedSessionFromEntries(entries: SessionEntry[], branchBeforeIndex: number): string | null {
     const newSessionId = uuidv4();
     const newSessionFile = join(this.getSessionDir(), `${timestamp}_${newSessionId}.jsonl`);
     
     // Copy entries BEFORE the branch point
     const newEntries: SessionEntry[] = [];
     for (let i = 0; i < branchBeforeIndex; i++) {
       const entry = entries[i];
       if (entry.type === 'session') {
         newEntries.push({
           ...entry,
           id: newSessionId,
           timestamp: new Date().toISOString(),
           branchedFrom: this.persist ? this.sessionFile : undefined,  // Link to parent
         });
       } else {
         newEntries.push(entry);
       }
     }
     
     // Write to new file (if persisting)
     if (this.persist) {
       for (const entry of newEntries) {
         appendFileSync(newSessionFile, `${JSON.stringify(entry)}\n`);
       }
       return newSessionFile;
     }
     
     // In-memory mode: just update entries
     this.inMemoryEntries = newEntries;
     this.sessionId = newSessionId;
     return null;
   }
   ```

7. **Post-branch UI update** (`interactive-mode.ts:1504`)
   - Chat is cleared
   - Re-rendered from new session state
   - Editor is pre-filled with selected user message text

### UserMessageSelectorComponent (`components/user-message-selector.ts`)

```typescript
class UserMessageList implements Component {
  private messages: UserMessageItem[] = [];
  private selectedIndex: number = 0;
  
  constructor(messages: UserMessageItem[]) {
    this.messages = messages;
    this.selectedIndex = Math.max(0, messages.length - 1);  // Start at most recent
  }
  
  handleInput(keyData: string): void {
    if (isArrowUp(keyData)) {
      this.selectedIndex = this.selectedIndex === 0 ? this.messages.length - 1 : this.selectedIndex - 1;
    } else if (isArrowDown(keyData)) {
      this.selectedIndex = this.selectedIndex === this.messages.length - 1 ? 0 : this.selectedIndex + 1;
    } else if (isEnter(keyData)) {
      this.onSelect?.(this.messages[this.selectedIndex].index);
    } else if (isEscape(keyData) || isCtrlC(keyData)) {
      this.onCancel?.();
    }
  }
}
```

### Hook Events for Branching

```typescript
// Before branch (cancellable)
{
  type: 'session',
  reason: 'before_branch',
  entries: SessionEntry[],
  sessionFile: string | null,
  targetTurnIndex: number,
}

// After branch
{
  type: 'session',
  reason: 'branch',
  entries: SessionEntry[],  // New session entries
  sessionFile: string | null,  // New session file
  previousSessionFile: string | null,  // Original session
  targetTurnIndex: number,
}
```

---

## Slash Command System

### Built-in Commands (UI-only)

Handled in `interactive-mode.ts` `setupEditorSubmitHandler()`:
- `/settings`, `/model`, `/export`, `/copy`, `/session`
- `/changelog`, `/hotkeys`, `/branch`, `/login`, `/logout`
- `/new`, `/compact`, `/resume`

### File-based Custom Commands

**Locations**:
- Global: `~/.pi/agent/commands/*.md`
- Project: `.pi/commands/*.md`

**Format** (`slash-commands.ts`):
```markdown
---
description: Short description for autocomplete
---
Command content here with $1 $2 $@ for argument substitution
```

**Loading**: `loadSlashCommands(options)` scans directories recursively.

**Expansion**: `expandSlashCommand(text, fileCommands)` substitutes arguments:
- `$1`, `$2`, etc. for positional args
- `$@` for all args

---

## Other Key Systems

### Context Compaction (`core/compaction.ts`)

- Summarizes older messages to reduce context size
- Triggered by:
  1. Manual `/compact` command
  2. Auto on context overflow error
  3. Auto when context exceeds threshold
- Creates `CompactionEntry` with summary text
- `buildSessionContext()` reconstructs messages: summary + kept messages

### Hook System (`core/hooks/`)

- Lifecycle events: `session`, `tool_call`, `tool_result`, `message`, `error`
- Location: `~/.pi/agent/hooks/*.ts` and `.pi/hooks/*.ts`
- Events can be cancelled via `{ cancel: true }` return

### Custom Tools (`core/custom-tools/`)

- Location: `~/.pi/agent/tools/*.ts` and `.pi/tools/*.ts`
- Loaded via `loadCustomTools()`
- Receive session events: `new`, `switch`, `branch`, etc.

### Skills (`core/skills.ts`)

- On-demand capability packages (SKILL.md files)
- Loaded when task matches description

---

## Key Differences from Marvin

| Feature | pi-mono | marvin |
|---------|---------|--------|
| Package structure | `packages/` | `apps/` + `packages/` |
| Central abstraction | `AgentSession` | Split: tui-app.tsx + session-manager |
| TUI framework | `@mariozechner/pi-tui` | `@anthropic-ai/claude-code-sdk` (Ink/React) |
| Session format | JSONL with types | JSONL (simpler, no branching metadata) |
| Branching | Full `/branch` with UI | Not implemented |
| Compaction | Full auto + manual | Manual only |
| Hooks | Full hook system | Simplified hooks |
| Custom tools | Full custom tool system | Basic custom tools |
| Modes | interactive, print, rpc | TUI, headless, ACP |

---

## Files Reference

### Crucial Files for Understanding Branch System

1. **`packages/coding-agent/src/core/agent-session.ts`** - `branch()` method, `getUserMessagesForBranching()`
2. **`packages/coding-agent/src/core/session-manager.ts`** - `createBranchedSessionFromEntries()`, `branchedFrom` metadata
3. **`packages/coding-agent/src/modes/interactive/components/user-message-selector.ts`** - Branch selector UI
4. **`packages/coding-agent/src/modes/interactive/interactive-mode.ts`** - `/branch` command handler, `showUserMessageSelector()`
5. **`packages/coding-agent/src/core/hooks/types.ts`** - Hook event types including `before_branch`, `branch`

### Architecture Documentation

- **`packages/coding-agent/DEVELOPMENT.md`** - Full architecture overview, directory structure, development workflow

### Package READMEs

- `packages/ai/README.md` - LLM provider API
- `packages/agent/README.md` - Agent runtime
- `packages/tui/README.md` - TUI framework

---

## Implementing /branch in Marvin

To implement `/branch` in marvin, you would need:

1. **SessionManager changes**:
   - Add `branchedFrom?: string` to `SessionMetadata`
   - Add `createBranchedSession(entries, branchBeforeIndex)` method
   - Store entries array for random access (currently only appends)

2. **New command handler**:
   - Add `/branch` to `commands.ts`
   - Get user messages from session
   - Show selector UI

3. **User message selector component**:
   - React/Ink component listing user messages
   - Keyboard navigation (↑↓ to navigate, Enter to select, Esc to cancel)

4. **Branch execution**:
   - Create new session file with entries before selected message
   - Update session manager to point to new file
   - Reset agent messages from new session
   - Pre-fill editor with selected message text

5. **Session picker update** (optional):
   - Show branched sessions with parent relationship indicator

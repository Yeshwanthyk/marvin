# Architecture

This document explains the system design, data flow, and component interactions in marvin-agent.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              coding-agent (CLI)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │   Commands   │  │    Hooks     │  │ Custom Tools │  │  Session Mgmt    │ │
│  │  (builtin +  │  │ (lifecycle   │  │  (user .ts   │  │  (persistence)   │ │
│  │   custom)    │  │   events)    │  │   files)     │  │                  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                              TUI Layer (open-tui)                            │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  @opentui/solid → Components (Markdown, Diff, CodeBlock, Editor, etc) │ │
│  │  Theme System → multiple themes with semantic color tokens             │ │
│  │  Autocomplete → File paths, slash commands, tool names                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                         Agent Core (@marvin-agents/agent-core)               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Agent State Machine → messages, model, tools, streaming state         │ │
│  │  Event Emitter → granular events for UI binding                        │ │
│  │  Transport Layer → ProviderTransport, RouterTransport, CodexTransport  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                              AI Package (@marvin-agents/ai)                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Provider Adapters → Anthropic, OpenAI, Google, Mistral                │ │
│  │  Agent Loop → streaming, tool execution, multi-turn                    │ │
│  │  Token Tracking → usage, cost estimation                               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                   Base Tools + LSP (base-tools, lsp)                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  read, write, edit, bash → file operations with validation             │ │
│  │  LSP Manager → TypeScript server, diagnostics injection                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────┐
                    │       LLM Provider APIs         │
                    │  (Anthropic, OpenAI, Google...) │
                    └─────────────────────────────────┘
```

## Package Structure

```
packages/
├── agent/         @marvin-agents/agent-core - Agent state machine, transports
├── ai/            @marvin-agents/ai - LLM provider abstraction, streaming
├── base-tools/    @marvin-agents/base-tools - read, write, edit, bash tools
├── lsp/           @marvin-agents/lsp - Language server protocol integration
└── open-tui/      @marvin-agents/open-tui - TUI components and utilities

apps/
└── coding-agent/  @marvin-agents/coding-agent - Main CLI application
```

## Request Flow

A typical user interaction flows through these stages:

```
User Input                 Agent Core                  LLM Provider
    │                          │                           │
    │  "fix the bug in x.ts"   │                           │
    ├─────────────────────────►│                           │
    │                          │                           │
    │                    ┌─────┴─────┐                     │
    │                    │  prompt() │                     │
    │                    └─────┬─────┘                     │
    │                          │                           │
    │                    ┌─────┴─────┐                     │
    │                    │ Transport │                     │
    │                    │   .run()  │                     │
    │                    └─────┬─────┘                     │
    │                          │   HTTP stream             │
    │                          ├──────────────────────────►│
    │                          │                           │
    │                          │◄─ message_start ──────────│
    │◄── message_start ────────│                           │
    │                          │                           │
    │                          │◄─ message_update (text) ──│
    │◄── message_update ───────│                           │
    │    (streaming tokens)    │                           │
    │                          │                           │
    │                          │◄─ message_update (tool) ──│
    │◄── tool_execution_start ─│                           │
    │                          │                           │
    │                    ┌─────┴─────┐                     │
    │                    │  Execute  │                     │
    │                    │   Tool    │                     │
    │                    └─────┬─────┘                     │
    │                          │                           │
    │◄── tool_execution_end ───│                           │
    │                          │                           │
    │                          │   tool result             │
    │                          ├──────────────────────────►│
    │                          │                           │
    │                          │◄─ next response ──────────│
    │◄── message_end ──────────│                           │
    │                          │                           │
    │◄── agent_end ────────────│                           │
    │                          │                           │
```

## Event System

The agent emits events at each stage of processing. The TUI subscribes to these events to update the display in real-time.

```
AgentEvent Types (defined in packages/ai/src/agent/types.ts)
────────────────────────────────────────────────────────────────────

agent_start          Fired once when agent loop begins
   │
   ├─► turn_start    Fired at start of each LLM turn
   │      │
   │      ├─► message_start   New message (user or assistant)
   │      │
   │      ├─► message_update  Streaming content chunks
   │      │
   │      ├─► message_end     Message complete
   │      │
   │      ├─► tool_execution_start   Tool invoked
   │      │      │
   │      │      ├─► tool_execution_update  Streaming output
   │      │      │
   │      │      └─► tool_execution_end     Tool complete
   │      │
   │      └─► turn_end        Turn complete (with tool results)
   │
   └─► agent_end     Fired when all turns complete
```

### Event Handler Flow (TUI)

```
┌─────────────────────────────────────────────────────────────────┐
│              createAgentEventHandler() in agent-events.ts        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  agent_start ──► Reset turn index, clear extraction cache       │
│                                                                  │
│  message_start ──► Create streaming message placeholder         │
│                    (if assistant)                                │
│                                                                  │
│  message_update ──► Throttled incremental extraction            │
│                     Extract text/thinking/toolCalls              │
│                     Update streaming message                     │
│                                                                  │
│  message_end ──► Final extraction, clear streaming flag         │
│                  Persist to session                              │
│                  Update context token count                      │
│                                                                  │
│  tool_execution_start ──► Add tool block to message              │
│                           Set activity state to "tool"           │
│                                                                  │
│  tool_execution_update ──► Throttled update                      │
│                            Update tool output preview            │
│                                                                  │
│  tool_execution_end ──► Final tool result                        │
│                         Update diff preview if edit              │
│                         Set isComplete flag                      │
│                                                                  │
│  agent_end ──► Clear streaming state                             │
│               Set activity to "idle"                             │
│               Handle retry logic if error                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Agent State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│               AgentState (packages/agent/src/types.ts)           │
├─────────────────────────────────────────────────────────────────┤
│  systemPrompt: string        System prompt for context           │
│  model: Model                Current LLM model                   │
│  thinkingLevel: ThinkingLevel  off|minimal|low|medium|high|xhigh │
│  tools: AgentTool[]          Available tools                     │
│  messages: AppMessage[]      Conversation history                │
│  isStreaming: boolean        Response in progress                │
│  streamMessage: Message|null Current partial response            │
│  pendingToolCalls: Set<id>   Tools currently executing           │
│  error: string|undefined     Last error message                  │
└─────────────────────────────────────────────────────────────────┘

State Transitions:
──────────────────

    idle ──prompt()──► streaming
              │
              ▼
    ┌─────────────────────┐
    │   Turn Loop         │
    │   ┌─────────────┐   │
    │   │ Stream LLM  │   │
    │   └──────┬──────┘   │
    │          ▼          │
    │   ┌─────────────┐   │
    │   │ Tool Calls? │   │──no──► turn complete
    │   └──────┬──────┘   │
    │          │yes       │
    │          ▼          │
    │   ┌─────────────┐   │
    │   │Execute Tools│   │
    │   └──────┬──────┘   │
    │          │          │
    │          └──────────┘
    │                │
    └────────────────┘
              │
              ▼
          agent_end ──► idle
```

## Transport Layer

Transports abstract the communication with LLM backends:

```
┌─────────────────────────────────────────────────────────────────┐
│          AgentTransport Interface (packages/agent/src/transports/types.ts)
├─────────────────────────────────────────────────────────────────┤
│  run(messages, userMessage, config, signal)                      │
│    → AsyncIterable<AgentEvent>                                   │
│                                                                  │
│  continue(messages, config, signal)                              │
│    → AsyncIterable<AgentEvent>                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ProviderTransport │ │ RouterTransport  │ │ CodexTransport   │
├──────────────────┤ ├──────────────────┤ ├──────────────────┤
│ Direct API calls │ │ Routes between   │ │ OAuth + Codex    │
│ to providers     │ │ codex & provider │ │ API integration  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### ProviderTransport

Direct calls to LLM provider APIs:
1. Retrieves API key via `getApiKey(provider)`
2. Builds context with system prompt and messages
3. Calls `agentLoop()` from the `ai` package
4. Yields events as they stream from the provider

### RouterTransport

Routes to correct transport based on model.provider:
- If provider is "codex" → uses CodexTransport
- Otherwise → uses ProviderTransport

### CodexTransport

Integrates with OpenAI Codex for OAuth-based authentication:
1. Manages OAuth token flow (loadTokens, saveTokens, clearTokens)
2. Handles token refresh
3. Routes to Codex API endpoints

## Tool Pipeline

Tools are wrapped in multiple layers for interception and enhancement:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tool Execution                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│          wrapToolsWithLspDiagnostics() (packages/lsp)            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  For write/edit tools:                                     │  │
│  │  1. Execute original tool                                  │  │
│  │  2. Touch file with LSP manager                            │  │
│  │  3. Wait for diagnostics                                   │  │
│  │  4. Inject diagnostics into result                         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│           wrapToolsWithHooks() (apps/coding-agent/src/hooks)     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  1. Emit tool.execute.before                               │  │
│  │  2. Check if hook returned { block: true }                 │  │
│  │  3. Execute tool (or return blocked result)                │  │
│  │  4. Emit tool.execute.after                                │  │
│  │  5. Apply any result modifications from hooks              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Original Tool                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  read: file content, image base64                          │  │
│  │  write: create/overwrite file                              │  │
│  │  edit: surgical text replacement                           │  │
│  │  bash: command execution with timeout                      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## LSP Integration

The LSP package provides language server integration for TypeScript:

```
┌─────────────────────────────────────────────────────────────────┐
│                 LspManager (packages/lsp/src/manager.ts)         │
├─────────────────────────────────────────────────────────────────┤
│  touchFile(path, opts)     Notify server of file change         │
│  diagnostics()             Get all current diagnostics           │
│  shutdown()                Clean up all servers                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 LspClient (packages/lsp/src/client.ts)           │
├─────────────────────────────────────────────────────────────────┤
│  JSON-RPC communication with language server                     │
│  Tracks open files and their diagnostics                         │
│  Handles initialization handshake                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              typescript-language-server                          │
│  (auto-installed to ~/.config/marvin/lsp/)                       │
└─────────────────────────────────────────────────────────────────┘

Flow:
─────

1. File modified via write/edit tool
2. Tool wrapper calls lsp.touchFile(path)
3. LspManager finds/spawns appropriate server
4. Server analyzes file, emits diagnostics
5. LspClient collects diagnostics via JSON-RPC
6. Tool wrapper appends diagnostics to result

Diagnostic Format:
─────────────────

{
  "file": "src/index.ts",
  "line": 42,
  "severity": "error",
  "message": "Property 'foo' does not exist on type 'Bar'"
}
```

### LSP Registry (packages/lsp/src/registry.ts)

Maps file extensions to language servers:

```typescript
LANGUAGE_ID_BY_EXT: {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
}
```

## Hook System

Hooks allow users to intercept and extend agent behavior:

```
┌─────────────────────────────────────────────────────────────────┐
│          HookRunner (apps/coding-agent/src/hooks/runner.ts)      │
├─────────────────────────────────────────────────────────────────┤
│  handlers: Map<eventType, handler[]>                             │
│  messageCallback: (text) => void                                 │
├─────────────────────────────────────────────────────────────────┤
│  emit(event) → Promise<result>                                   │
│    Runs all handlers for event type                              │
│    Collects and merges results                                   │
│                                                                  │
│  register(hookAPI)                                               │
│    Called by hook factory with marvin.on(), marvin.send()        │
└─────────────────────────────────────────────────────────────────┘

Hook Loading:
─────────────

~/.config/marvin/hooks/
├── git-context.ts       ──► Loaded at startup
├── lint-check.ts        ──► Each exports default HookFactory
└── custom-policy.ts     ──► Factory receives HookAPI

HookAPI:
────────

marvin.on(event, handler)   Subscribe to lifecycle events
marvin.send(text)           Inject message into conversation
ctx.exec(cmd, args)         Execute shell command
ctx.cwd                     Current working directory
ctx.configDir               Config directory path
```

### Hook Event Types (apps/coding-agent/src/hooks/types.ts)

```
App Startup
    │
    ├─► app.start
    │
    ▼
Session Management
    │
    ├─► session.start    (new session)
    ├─► session.resume   (loaded session)
    ├─► session.clear    (/clear command)
    │
    ▼
Agent Loop
    │
    ├─► agent.start
    │      │
    │      ├─► turn.start
    │      │      │
    │      │      ├─► tool.execute.before ──┐
    │      │      │                         │ can block
    │      │      │◄────────────────────────┘
    │      │      │
    │      │      ├─► [tool executes]
    │      │      │
    │      │      ├─► tool.execute.after ───┐
    │      │      │                         │ can modify result
    │      │      │◄────────────────────────┘
    │      │      │
    │      │      └─► turn.end
    │      │
    │      └─► agent.end
    │
    ▼
```

## TUI Component Hierarchy

```
apps/coding-agent/src/
├── tui-app.tsx           Main app component
├── components/
│   ├── MessageList.tsx   Scrollable message container
│   └── Footer.tsx        Status bar with model/context
├── session-picker.tsx    Session selection dialog
├── tui-open-rendering.tsx  Tool block components
├── agent-events.ts       Event → UI state mapping
└── keyboard-handler.ts   Key bindings

packages/open-tui/src/
├── components/
│   ├── badge.tsx         Status badges
│   ├── code-block.tsx    Syntax highlighted code
│   ├── dialog.tsx        Modal dialogs
│   ├── diff.tsx          Diff rendering
│   ├── divider.tsx       Visual dividers
│   ├── editor.tsx        Text input
│   ├── image.tsx         Image display
│   ├── loader.tsx        Loading indicators
│   ├── markdown.tsx      Markdown rendering
│   ├── panel.tsx         Container panels
│   ├── select-list.tsx   Selection lists
│   ├── spacer.tsx        Layout spacers
│   └── toast.tsx         Toast notifications
├── context/
│   ├── terminal.tsx      Terminal context provider
│   └── theme.tsx         Theme context provider
├── autocomplete/
│   ├── autocomplete.ts   Autocomplete logic
│   └── file-index.ts     File path indexing
└── hooks/
    └── use-keyboard.ts   Keyboard handling hook
```

### Message Rendering Pipeline

```
AppMessage (from agent)
    │
    ├─► Extract content blocks
    │   └─► extractOrderedBlocks(content)
    │        ├─ text blocks
    │        ├─ thinking blocks
    │        └─ toolCall blocks
    │
    ├─► Convert to UIContentBlocks
    │   └─► Preserve order for mixed content
    │
    └─► Render in MessageList
        │
        ├─► Thinking → collapsible summary
        │
        ├─► Text → Markdown component
        │   └─► tree-sitter highlighting
        │
        └─► Tool → ToolBlock component
            │
            ├─► Header (tool name, path, status)
            │
            └─► Body (based on tool type)
                ├─ bash → CodeBlock (output)
                ├─ read → CodeBlock (file content)
                ├─ write → CodeBlock (new content)
                └─ edit → Diff (word-level)
```

## Session Persistence

Sessions are stored as JSON files with conversation history:

```
~/.local/share/marvin/sessions/
├── 2024-01-15T10-30-00-chat-about-bugs.json
├── 2024-01-15T14-45-00-refactor-auth.json
└── 2024-01-16T09-00-00-add-tests.json

Session Format:
───────────────

{
  "id": "uuid",
  "title": "chat-about-bugs",
  "startedAt": 1705312200000,
  "updatedAt": 1705313400000,
  "provider": "anthropic",
  "modelId": "claude-sonnet-4-20250514",
  "thinkingLevel": "medium",
  "messages": [
    { "role": "user", "content": [...], "timestamp": ... },
    { "role": "assistant", "content": [...], "usage": {...} },
    { "role": "toolResult", "toolCallId": "...", "content": [...] }
  ]
}

SessionManager (apps/coding-agent/src/session-manager.ts):
──────────────────────────────────────────────────────────

startSession(provider, model, thinking)
  → Creates new session file
  → Emits session.start hook

loadSession(id)
  → Reads session file
  → Populates agent state
  → Emits session.resume hook

appendMessage(message)
  → Appends to current session
  → Writes to disk (debounced)

listSessions()
  → Returns available sessions for picker
```

## Autocomplete System

```
┌─────────────────────────────────────────────────────────────────┐
│     CombinedAutocompleteProvider (apps/coding-agent/src/)        │
├─────────────────────────────────────────────────────────────────┤
│  Combines multiple providers with priority ordering              │
└─────────────────────────────────────────────────────────────────┘
        │
        ├─► SlashCommandProvider
        │   └─ /model, /thinking, /theme, /compact, /clear, /exit
        │   └─ Custom commands from ~/.config/marvin/commands/
        │
        ├─► FilePathProvider
        │   └─ Scans working directory
        │   └─ Respects .gitignore
        │   └─ Caches file index for speed
        │
        └─► ToolNameProvider
            └─ @tool_name prefix completion
            └─ Built-in + custom tools

Trigger Patterns:
─────────────────

/         → slash commands
./  ../   → file paths
@         → tool names
~         → home directory expansion
```

## Custom Commands

Custom slash commands are loaded from `~/.config/marvin/commands/*.md`:

```
loadCustomCommands(configDir)
    │
    ├─► Scan ~/.config/marvin/commands/*.md
    │
    ├─► For each file:
    │   ├─ Parse markdown content
    │   ├─ Extract $ARGUMENTS placeholder
    │   └─ Create command entry
    │
    └─► Return Map<name, CustomCommand>

Expansion:
──────────
- $ARGUMENTS in template is replaced with user args
- If no placeholder, args are appended
```

## Custom Tools

Custom tools are loaded from `~/.config/marvin/tools/*.ts`:

```
loadCustomTools(configDir, cwd, existingToolNames)
    │
    ├─► Scan ~/.config/marvin/tools/*.ts
    │
    ├─► For each file:
    │   ├─ Transpile TypeScript
    │   ├─ Dynamic import
    │   ├─ Call default export (factory) with API
    │   └─ Register tool(s)
    │
    └─► Return { tools, errors }

Tool API:
─────────
api.cwd          Current working directory
api.exec(...)    Execute shell commands
```

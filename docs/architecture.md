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
│  │  Solid Renderer → Components (Markdown, Diff, CodeBlock, Editor, etc) │ │
│  │  Theme System → 30+ themes with semantic color tokens                  │ │
│  │  Autocomplete → File paths, slash commands, tool names                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                           Agent Core (agent-core)                            │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Agent State Machine → messages, model, tools, streaming state         │ │
│  │  Event Emitter → granular events for UI binding                        │ │
│  │  Transport Layer → ProviderTransport, RouterTransport, CodexTransport  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                              AI Package (ai)                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Provider Adapters → Anthropic, OpenAI, Google, Mistral, etc.          │ │
│  │  Agent Loop → streaming, tool execution, multi-turn                    │ │
│  │  Token Tracking → usage, cost estimation                               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                     Base Tools + LSP (base-tools, lsp)                       │
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
AgentEvent Types
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
│                    createAgentEventHandler()                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  agent_start ──► Reset turn index, clear extraction cache       │
│                                                                  │
│  message_start ──► Create streaming message placeholder         │
│                    (if assistant)                                │
│                                                                  │
│  message_update ──► Throttled (80ms) incremental extraction     │
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
│  tool_execution_update ──► Throttled (50ms) update               │
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
│                          AgentState                              │
├─────────────────────────────────────────────────────────────────┤
│  systemPrompt: string        System prompt for context           │
│  model: Model                Current LLM model                   │
│  thinkingLevel: ThinkingLevel  Reasoning depth                   │
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
│                      AgentTransport Interface                    │
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
│ Direct API calls │ │ OpenRouter proxy │ │ OAuth + Codex    │
│ to providers     │ │ for any model    │ │ API integration  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### ProviderTransport

Direct calls to LLM provider APIs:
1. Retrieves API key via `getApiKey(provider)`
2. Builds context with system prompt and messages
3. Calls `agentLoop()` from the `ai` package
4. Yields events as they stream from the provider

### RouterTransport

Routes through OpenRouter for unified access to multiple models:
1. Uses OpenRouter API key
2. Maps model IDs to OpenRouter format
3. Handles provider-specific quirks

### CodexTransport

Integrates with OpenAI Codex for OAuth-based authentication:
1. Manages OAuth token flow
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
│              wrapToolsWithLspDiagnostics()                       │
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
│                   wrapToolsWithHooks()                           │
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
│                        LspManager                                │
├─────────────────────────────────────────────────────────────────┤
│  touchFile(path, opts)     Notify server of file change         │
│  diagnostics()             Get all current diagnostics           │
│  shutdown()                Clean up all servers                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        LspClient                                 │
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

## Hook System

Hooks allow users to intercept and extend agent behavior:

```
┌─────────────────────────────────────────────────────────────────┐
│                        HookRunner                                │
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

### Hook Event Flow

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
┌─────────────────────────────────────────────────────────────────┐
│                          TuiApp                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ThemeProvider                                              │  │
│  │ ┌─────────────────────────────────────────────────────┐   │  │
│  │ │ TerminalProvider                                     │   │  │
│  │ │ ┌─────────────────────────────────────────────────┐ │   │  │
│  │ │ │                                                  │ │   │  │
│  │ │ │  ┌────────────────────────────────────────────┐ │ │   │  │
│  │ │ │  │              MessageList                    │ │ │   │  │
│  │ │ │  │  ┌──────────────────────────────────────┐  │ │ │   │  │
│  │ │ │  │  │ UserMessage                          │  │ │ │   │  │
│  │ │ │  │  │   └─ Markdown                        │  │ │ │   │  │
│  │ │ │  │  ├──────────────────────────────────────┤  │ │ │   │  │
│  │ │ │  │  │ AssistantMessage                     │  │ │ │   │  │
│  │ │ │  │  │   ├─ Thinking (collapsible)          │  │ │ │   │  │
│  │ │ │  │  │   ├─ Markdown (text content)         │  │ │ │   │  │
│  │ │ │  │  │   └─ ToolBlock[]                     │  │ │ │   │  │
│  │ │ │  │  │        ├─ ToolHeader (collapsible)   │  │ │ │   │  │
│  │ │ │  │  │        └─ ToolBody                   │  │ │ │   │  │
│  │ │ │  │  │             ├─ CodeBlock (bash/read) │  │ │ │   │  │
│  │ │ │  │  │             └─ Diff (edit)           │  │ │ │   │  │
│  │ │ │  │  └──────────────────────────────────────┘  │ │ │   │  │
│  │ │ │  └────────────────────────────────────────────┘ │ │   │  │
│  │ │ │                                                  │ │   │  │
│  │ │ │  ┌────────────────────────────────────────────┐ │ │   │  │
│  │ │ │  │              Editor                         │ │ │   │  │
│  │ │ │  │   └─ Autocomplete overlay                   │ │ │   │  │
│  │ │ │  └────────────────────────────────────────────┘ │ │   │  │
│  │ │ │                                                  │ │   │  │
│  │ │ │  ┌────────────────────────────────────────────┐ │ │   │  │
│  │ │ │  │              Footer                         │ │ │   │  │
│  │ │ │  │   ├─ Model badge                            │ │ │   │  │
│  │ │ │  │   ├─ Context meter                          │ │ │   │  │
│  │ │ │  │   └─ Activity indicator                     │ │ │   │  │
│  │ │ │  └────────────────────────────────────────────┘ │ │   │  │
│  │ │ │                                                  │ │   │  │
│  │ │ └──────────────────────────────────────────────────┘ │   │  │
│  │ └──────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

Modal Overlays:
───────────────
  ├─ SessionPicker (dialog for session selection)
  ├─ Toast (ephemeral notifications)
  └─ Dialog (confirmation prompts)
```

## Message Rendering Pipeline

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

SessionManager:
───────────────

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

## Model Cycling (Overflow Recovery)

When context exceeds model limits, the agent can cycle to a larger model:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Context Overflow Flow                        │
└─────────────────────────────────────────────────────────────────┘

1. Request fails with overflow error (529, token limit exceeded)

2. Agent detects overflow via error pattern matching

3. ModelCycler checks for larger model in same provider:
   ┌──────────────────────────────────────────────────────┐
   │  gemini-2.5-flash (1M) → gemini-2.5-pro (1M+)       │
   │  claude-sonnet (200K) → claude-opus (200K)          │
   │  gpt-4o (128K) → gpt-4-turbo (128K)                 │
   └──────────────────────────────────────────────────────┘

4. If larger model found:
   - Emit model_cycle event
   - Switch model
   - Retry with agent.continue()

5. If no larger model:
   - Suggest /compact command
   - Or truncate older messages
```

## Autocomplete System

```
┌─────────────────────────────────────────────────────────────────┐
│                 CombinedAutocompleteProvider                     │
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

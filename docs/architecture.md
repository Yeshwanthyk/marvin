# Architecture

This document explains the system design, data flow, and component interactions in marvin-agent.

## High-Level Overview

Marvin supports a terminal UI and a headless SDK built on the same core agent infrastructure and Effect runtime:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            UI Layer (Surface)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                         ┌─────────────────────────┐                         │
│                         │    Terminal TUI         │                         │
│                         │   (apps/coding-agent)   │                         │
│                         │                         │                         │
│                         │  ┌───────────────────┐  │                         │
│                         │  │    open-tui       │  │                         │
│                         │  │   components      │  │                         │
│                         │  │   (terminal)      │  │                         │
│                         │  └───────────────────┘  │                         │
│                         │           │             │                         │
│                         │           ▼             │                         │
│                         │  ┌───────────────────┐  │                         │
│                         │  │  Agent (in-proc)  │  │                         │
│                         │  └───────────────────┘  │                         │
│                         └─────────────────────────┘                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Shared Core Packages                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │   Commands   │  │    Hooks     │  │ Custom Tools │  │  Session Mgmt    │ │
│  │  (builtin +  │  │ (lifecycle   │  │  (user .ts   │  │  (persistence)   │ │
│  │   custom)    │  │   events)    │  │   files)     │  │                  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                   Agent Core (@yeshwanthyk/agent-core)                    │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Agent State Machine → messages, model, tools, streaming state         │ │
│  │  Event Emitter → granular events for UI binding                        │ │
│  │  Transport Layer → ProviderTransport, RouterTransport, CodexTransport  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                       AI Package (@yeshwanthyk/ai)                        │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Provider Adapters → Anthropic, OpenAI, Google, Mistral                │ │
│  │  Agent Loop → streaming, tool execution, multi-turn                    │ │
│  │  Token Tracking → usage, cost estimation                               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                         Base Tools (base-tools)                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  read, write, edit, bash → file operations and command execution       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────┐
                    │       LLM Provider APIs         │
                    │  (Anthropic, OpenAI, Google...) │
                    └─────────────────────────────────┘
```

### Architecture Variants

| Surface | Agent Location | Tools Run | UI Framework | Communication |
|---------|---------------|-----------|--------------|---------------|
| **TUI** | In-process | Local | open-tui (terminal) | Direct function calls |
| **Headless** | In-process | Local | None (stdout) | Runtime-effect / SDK |

Both variants have **full local filesystem access** via the base tools.

## Package Structure

```
packages/
├── agent/         @yeshwanthyk/agent-core - Agent state machine, transports
├── ai/            @yeshwanthyk/ai - LLM provider abstraction, streaming
├── base-tools/    @yeshwanthyk/base-tools - read, write, edit, bash tools
├── open-tui/      @yeshwanthyk/open-tui - TUI components (terminal)
├── runtime-effect @yeshwanthyk/runtime-effect - Effect runtime composition
└── sdk/           @yeshwanthyk/sdk - Headless SDK on runtime-effect

apps/
└── coding-agent/  @yeshwanthyk/coding-agent - Terminal CLI/TUI
```

### Package Dependency Graph

```
                    @yeshwanthyk/ai
                           │
              ┌────────────┼────────────┐
              ▼            ▼
    @yeshwanthyk/    @yeshwanthyk/
       agent-core       base-tools
              │            │
              └────────────┘
                           │
                  @yeshwanthyk/
                   runtime-effect
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       apps/coding-agent          @yeshwanthyk/sdk
              │                         │
              ▼                         ▼
      open-tui (terminal)        headless SDK
```

## Request Flow

A typical user interaction flows through these stages:

```

## Runtime Layers & Boundaries

Source files under `apps/coding-agent/src` are grouped by responsibility:

| Layer | Path Alias | Responsibilities |
|-------|------------|------------------|
| **Domain** | `@domain/*` | Pure logic (commands, messaging helpers) with no side effects. |
| **Runtime** | `@runtime/*` | Agent factory, session services, transports, extensibility loaders. |
| **Extensibility** | `@ext/*` | Schema definitions, validation utilities, host adapters. |
| **UI** | `@ui/*` | Solid components, state stores, presentation only. |
| **Adapters** | `@adapters/*` | CLI/TUI/ACP entrypoints that wire runtime into each surface. |

An ESLint Boundaries rule (warn mode) blocks “uphill” imports so that, for example, domain code cannot reach into the UI or adapters. Adapters may depend on any lower layer, but the reverse is disallowed. This mirrors the containment enforced by the runtime factory and keeps APC/TUI surfaces swappable.

### Effect Runtime Components

The shared runtime lives in `packages/runtime-effect` and is composed entirely with Effect `Layer`s:

1. **Config + Session Layers** load `~/.config/marvin`, resolve API keys, and expose `SessionManager` (JSONL persistence, compaction metadata).
2. **Transport + Tools + Hooks** merge provider transports, lazy tool loading, custom tools/commands, and hook runners. Hooks execute through `HookEffects`, an Effect channel that serializes hook invocations and propagates results back to the agent loop.
3. **PromptQueueLayer** wraps `Effect.Queue` + `SubscriptionRef` so adapters can observe steer/follow-up counts and persist slash-script snapshots when aborting.
4. **ExecutionPlanBuilderLayer** constructs `Effect.ExecutionPlan`s describing retries/fallbacks for each provider/model entry in the user’s cycle.
5. **SessionOrchestratorLayer** drains the prompt queue, emits hook events, appends messages to the session log, executes the plan (retrying + replacing agent state on failure), and signals tmux instrumentation. It exposes:
   - `submitPrompt()` for asynchronous surfaces (TUI) that just enqueue work.
   - `submitPromptAndWait()` for synchronous surfaces (headless CLI, ACP) that need completion before responding.
   - `drainToScript()` to serialize outstanding queue items when aborting or persisting state.
6. **RuntimeLayer** wires everything together and hands adapters a scoped `RuntimeServices` bundle (agent, orchestrator, extensibility metadata, instrumentation handles, etc.).

All adapters—TUI, headless CLI, ACP, or future surfaces—call `createRuntime()` which builds `RuntimeLayer` under a managed Effect scope and returns both the services and a `close()` helper that shuts down hooks and the prompt loop deterministically. The SDK (`@yeshwanthyk/sdk`) wraps the same runtime and exposes `runAgent`, session, and streaming APIs without bypassing Effect.

## Slash Command Registry

Slash commands now live under `src/domain/commands/` as individual modules. Each module exports a `CommandDefinition` and registers itself via `commandRegistry`. The registry normalizes aliases, prefixes, and async handlers so adapters keep using the legacy `handleSlashCommand` API while gaining per-command tests (see `commands-registry.test.ts`). Custom commands from `~/.config/marvin/commands` are still expanded after the registry runs, so existing templates remain compatible.

## Extensibility Validation & CLI

TypeBox schemas in `src/extensibility/schema.ts` describe the contracts for hooks, custom tools, and custom commands. Loaders call the shared validation helpers and funnel all issues back through `createRuntime`. Adapters expose the aggregated list:

- **TUI**: first few issues appear as warning/error toasts plus stderr log lines.  
- **Headless**: JSON responses include a `validationIssues` field.  
- **CLI**: `marvin validate --config-dir ~/.config/marvin` runs the same pipeline without launching the UI and exits non-zero when blocking errors exist.

Because validation happens before tools or hooks execute, users see actionable errors (path, severity, hint) without crashing the agent, and CI can enforce healthy configs via the dedicated command.
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
│              createAgentEventHandler() in agent-events.ts       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  agent_start ──► Reset turn index, clear extraction cache       │
│                                                                 │
│  message_start ──► Create streaming message placeholder         │
│                    (if assistant)                               │
│                                                                 │
│  message_update ──► Throttled incremental extraction            │
│                     Extract text/thinking/toolCalls             │
│                     Update streaming message                    │
│                                                                 │
│  message_end ──► Final extraction, clear streaming flag         │
│                  Persist to session                             │
│                  Update context token count                     │
│                                                                 │
│  tool_execution_start ──► Add tool block to message             │
│                           Set activity state to "tool"          │
│                                                                 │
│  tool_execution_update ──► Throttled update                     │
│                            Update tool output preview           │
│                                                                 │
│  tool_execution_end ──► Final tool result                       │
│                         Update diff preview if edit             │
│                         Set isComplete flag                     │
│                                                                 │
│  agent_end ──► Clear streaming state                            │
│               Set activity to "idle"                            │
│               Handle retry logic if error                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Agent State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│               AgentState (packages/agent/src/types.ts)          │
├─────────────────────────────────────────────────────────────────┤
│  systemPrompt: string        System prompt for context          │
│  model: Model                Current LLM model                  │
│  thinkingLevel: ThinkingLevel  off|minimal|low|medium|high|xhigh│
│  tools: AgentTool[]          Available tools                    │
│  messages: AppMessage[]      Conversation history               │
│  isStreaming: boolean        Response in progress               │
│  streamMessage: Message|null Current partial response           │
│  pendingToolCalls: Set<id>   Tools currently executing          │
│  error: string|undefined     Last error message                 │
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
│AgentTransport Interface (packages/agent/src/transports/types.ts)│
├─────────────────────────────────────────────────────────────────┤
│  run(messages, userMessage, config, signal)                     │
│    → AsyncIterable<AgentEvent>                                  │
│                                                                 │
│  continue(messages, config, signal)                             │
│    → AsyncIterable<AgentEvent>                                  │
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
│                          Tool Execution                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│     wrapToolsWithHooks() (packages/runtime-effect/src/hooks)    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  1. Emit tool.execute.before                              │  │
│  │  2. Check if hook returned { block: true }                │  │
│  │  3. Execute tool (or return blocked result)               │  │
│  │  4. Emit tool.execute.after                               │  │
│  │  5. Apply any result modifications from hooks             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Original Tool                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  read: file content, image base64                         │  │
│  │  write: create/overwrite file                             │  │
│  │  edit: surgical text replacement                          │  │
│  │  bash: command execution with timeout                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Hook System

Hooks allow users to intercept and extend agent behavior:

```
┌─────────────────────────────────────────────────────────────────┐
│     HookRunner (packages/runtime-effect/src/hooks/runner.ts)    │
├─────────────────────────────────────────────────────────────────┤
│  handlers: Map<eventType, handler[]>                            │
│  ui/session context providers                                   │
├─────────────────────────────────────────────────────────────────┤
│  initialize(options)                                            │
│    Wires send/steer/followUp handlers and UI/session context    │
│                                                                 │
│  emit(event) → Promise<void>                                    │
│    Runs all handlers for event type                             │
│                                                                 │
│  emitToolExecuteBefore/After                                    │
│    Can block, modify input, or mutate tool results              │
│                                                                 │
│  getMessageRenderer / getRegisteredCommands / getRegisteredTools│
│                                                                 │
│  onError(listener)                                              │
└─────────────────────────────────────────────────────────────────┘

Hook Loading:
─────────────

~/.config/marvin/hooks/
├── git-context.ts       ──► Loaded at startup
├── lint-check.ts        ──► Each exports default HookFactory
└── custom-policy.ts     ──► Factory receives HookAPI

HookAPI:
────────

marvin.on(event, handler)     Subscribe to lifecycle events
marvin.send(text)             Inject assistant message
marvin.sendMessage(...)       Persist hook message + optional display
marvin.registerMessageRenderer(type, renderer)
ctx.exec(cmd, args)           Execute shell command
ctx.cwd                       Current working directory
ctx.configDir                 Config directory path
ctx.session                   Session helpers (summarize, toast, tokens)
ctx.ui                        UI helpers (confirm/input/select/editor)
```

### Hook Event Types (packages/runtime-effect/src/hooks/types.ts)

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

Sessions are stored as JSONL (JSON Lines) files by the shared SessionManager:

```
~/.config/marvin/sessions/
├── --Users--yesh--project-a--/           # Encoded cwd path
│   ├── 1705312200000_abc123.jsonl        # {timestamp}_{uuid}.jsonl
│   └── 1705313400000_def456.jsonl
└── --Users--yesh--project-b--/
    └── 1705400000000_ghi789.jsonl

Path Encoding:
──────────────
/Users/yesh/project-a → --Users--yesh--project-a--

Session File Format (JSONL):
────────────────────────────

Line 1 (metadata):
{"type":"session","id":"abc123","timestamp":1705312200000,"cwd":"/Users/yesh/project-a","provider":"anthropic","modelId":"claude-sonnet-4-20250514","thinkingLevel":"medium"}

Line 2+ (messages):
{"type":"message","timestamp":1705312201000,"message":{"role":"user","content":[{"type":"text","text":"fix the bug"}]}}
{"type":"message","timestamp":1705312205000,"message":{"role":"assistant","content":[...]}}
{"type":"message","timestamp":1705312210000,"message":{"role":"toolResult","toolCallId":"...","content":[...]}}

SessionManager (packages/runtime-effect/src/session-manager.ts):
──────────────────────────────────────────────────────────

startSession(provider, modelId, thinkingLevel)
  → Creates new session file
  → Returns session id

continueSession(path, sessionId)
  → Points at existing session file

loadSession(path)
  → Reads JSONL session file
  → Returns metadata + messages

appendMessage(message)
  → Appends JSONL entry asynchronously

appendEntry(customType, data)
  → Appends custom JSONL entry

listSessions()
  → Returns available sessions for picker
```

## Autocomplete System

```
┌─────────────────────────────────────────────────────────────────┐
│      CombinedAutocompleteProvider (apps/coding-agent/src/)      │
├─────────────────────────────────────────────────────────────────┤
│  Combines multiple providers with priority ordering             │
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

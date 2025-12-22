# Code Walkthrough

This guide walks through the marvin-agent codebase from entry points to internals. Use it to orient yourself when exploring or modifying the code.

## Entry Points

### 1. CLI Entry: `apps/coding-agent/src/index.ts`

The main entry point parses CLI arguments and dispatches to TUI or headless mode:

```typescript
// apps/coding-agent/src/index.ts
import { parseArgs } from "./args.js";
import { runTuiOpen } from "./tui-app.js";
import { runHeadless } from "./headless.js";

const args = parseArgs();

if (args.headless) {
  await runHeadless({ prompt: args.headless, ...args });
} else {
  await runTuiOpen({ ...args });
}
```

**Key files:**
- `args.ts` — CLI argument parsing with yargs-style patterns
- `tui-app.tsx` — Interactive TUI entry point
- `headless.ts` — Non-interactive single-prompt execution

### 2. TUI Initialization: `apps/coding-agent/src/tui-app.tsx`

The TUI mode sets up the reactive terminal application:

```
runTuiOpen()
    │
    ├─► loadAppConfig() ─────────────────► Config from ~/.config/marvin/
    │
    ├─► loadHooks() ─────────────────────► User hooks from hooks/
    │
    ├─► loadCustomTools() ───────────────► User tools from tools/
    │
    ├─► loadCustomCommands() ────────────► Slash commands from commands/
    │
    ├─► Create Transport ────────────────► ProviderTransport or RouterTransport
    │
    ├─► Create LspManager ───────────────► LSP integration
    │
    ├─► Wrap tools ──────────────────────► hooks → LSP → base tools
    │
    ├─► Create Agent ────────────────────► State machine with transport
    │
    ├─► Setup event handlers ────────────► agent.subscribe(handleEvent)
    │
    └─► render(<TuiApp />) ──────────────► SolidJS terminal rendering
```

**What to look at:**
- **Transport selection** (lines ~50-80): Router vs Provider based on API key availability
- **Tool wrapping** (lines ~90-100): `wrapToolsWithHooks(wrapToolsWithLspDiagnostics(...))`
- **Agent creation** (lines ~110-140): Agent options, initial state
- **Event subscription** (lines ~150-180): `createAgentEventHandler(ctx)`

### 3. Headless Mode: `apps/coding-agent/src/headless.ts`

Simpler path for scripted execution:

```
runHeadless()
    │
    ├─► Same config/tools/hooks loading
    │
    ├─► Create agent (no TUI)
    │
    ├─► Single prompt() call
    │
    ├─► Collect events, format output
    │
    └─► Exit with code based on success
```

## Configuration Loading

### Config Chain: `apps/coding-agent/src/config.ts`

```
loadAppConfig()
    │
    ├─► Find config file
    │   └─ ~/.config/marvin/config.json (or --config)
    │
    ├─► Parse JSON with defaults
    │   ├─ provider: "anthropic"
    │   ├─ model: "claude-sonnet-4-20250514"
    │   ├─ thinking: "off"
    │   ├─ theme: "marvin"
    │   └─ lsp: { enabled: true, autoInstall: true }
    │
    ├─► Load agents config (AGENTS.md)
    │   └─ Combines system + agents prompts
    │
    └─► Return LoadedAppConfig
```

**Key types:**
- `AppConfigFile` — Raw JSON structure
- `LoadedAppConfig` — Resolved with defaults, model object

### Hooks Loading: `apps/coding-agent/src/hooks/loader.ts`

```
loadHooks(configDir)
    │
    ├─► Scan ~/.config/marvin/hooks/*.ts
    │
    ├─► For each file:
    │   ├─ Transpile TypeScript
    │   ├─ Dynamic import
    │   ├─ Call default export (HookFactory)
    │   └─ Collect registrations
    │
    └─► Return { hooks, runner, errors }
```

### Custom Tools: `apps/coding-agent/src/custom-tools/loader.ts`

```
loadCustomTools(configDir, api)
    │
    ├─► Scan ~/.config/marvin/tools/*.ts
    │
    ├─► For each file:
    │   ├─ Transpile TypeScript
    │   ├─ Dynamic import
    │   ├─ Call factory(api) → AgentTool | AgentTool[]
    │   └─ Wrap with metadata
    │
    └─► Return { tools, errors }
```

## Agent Core

### Agent Class: `packages/agent/src/agent.ts`

The Agent manages conversation state and coordinates with transports:

```
class Agent
    │
    ├─► State
    │   ├─ systemPrompt, model, thinkingLevel
    │   ├─ tools: AgentTool[]
    │   ├─ messages: AppMessage[]
    │   ├─ isStreaming, streamMessage
    │   └─ pendingToolCalls, error
    │
    ├─► Methods
    │   ├─ prompt(text, attachments?) ── Main entry for user input
    │   ├─ continue() ────────────────── Resume after overflow
    │   ├─ abort() ───────────────────── Cancel current request
    │   ├─ reset() ───────────────────── Clear all state
    │   ├─ queueMessage(msg) ─────────── Queue for injection
    │   └─ subscribe(fn) ─────────────── Event listener
    │
    └─► Internal
        ├─ _runAgentLoop() ───────────── Start with user message
        ├─ _runAgentLoopContinue() ───── Continue without message
        ├─ _prepareRun() ─────────────── Setup before loop
        └─ _processEvents() ──────────── Handle transport events
```

**Flow for `prompt()`:**

```
prompt(input)
    │
    ├─► Build user message with attachments
    │
    ├─► Call _runAgentLoop(userMessage)
    │   │
    │   ├─► _prepareRun()
    │   │   ├─ Create AbortController
    │   │   ├─ Set isStreaming = true
    │   │   ├─ Build AgentRunConfig
    │   │   └─ Transform messages for LLM
    │   │
    │   ├─► transport.run(messages, userMessage, config, signal)
    │   │
    │   └─► _processEvents(events)
    │       │
    │       ├─► For each AgentEvent:
    │       │   ├─ message_start: streamMessage = msg
    │       │   ├─ message_update: streamMessage = msg
    │       │   ├─ message_end: appendMessage(msg)
    │       │   ├─ tool_*: update pendingToolCalls
    │       │   └─ agent_end: cleanup
    │       │
    │       └─► Emit events to subscribers
    │
    └─► State updated, events emitted
```

### Transport Interface: `packages/agent/src/transports/types.ts`

```typescript
interface AgentTransport {
  run(messages, userMessage, config, signal): AsyncIterable<AgentEvent>;
  continue(messages, config, signal): AsyncIterable<AgentEvent>;
}
```

**Implementations:**

| Transport | Purpose | File |
|-----------|---------|------|
| ProviderTransport | Direct API calls | `ProviderTransport.ts` |
| RouterTransport | OpenRouter proxy | `RouterTransport.ts` |
| CodexTransport | OAuth + Codex API | `CodexTransport.ts` |

### Agent Loop: `packages/ai/src/agent/agent-loop.ts`

The core loop that drives LLM interaction:

```
agentLoop(prompt, context, config, signal)
    │
    ├─► Push: agent_start, turn_start, message_start/end (user)
    │
    └─► runLoop(context, newMessages, config, signal, stream)
        │
        ├─► While hasMoreToolCalls OR queuedMessages:
        │   │
        │   ├─► Process queued messages (inject before response)
        │   │
        │   ├─► streamAssistantResponse()
        │   │   ├─ Call provider API
        │   │   ├─ Stream chunks via message_update
        │   │   └─ Return complete AssistantMessage
        │   │
        │   ├─► Check for toolCall content blocks
        │   │
        │   ├─► If tool calls exist:
        │   │   └─► executeToolCalls()
        │   │       ├─ Emit tool_execution_start
        │   │       ├─ Validate args, call tool.execute()
        │   │       ├─ Emit tool_execution_update (streaming)
        │   │       ├─ Emit tool_execution_end
        │   │       └─ Return ToolResultMessage[]
        │   │
        │   └─► Push: turn_end
        │
        └─► Push: agent_end
```

## LLM Providers

### Provider Selection: `packages/ai/src/stream.ts`

```
streamSimple(context, config, signal)
    │
    ├─► Select provider based on model.api:
    │   ├─ anthropic → streamAnthropic()
    │   ├─ google → streamGoogle()
    │   ├─ openai-completions → streamOpenAICompletions()
    │   └─ openai-responses → streamOpenAIResponses()
    │
    └─► Return AsyncIterable<StreamChunk>
```

### Provider Adapters

Each provider adapter handles API-specific details:

```
packages/ai/src/providers/
├── anthropic.ts      Messages API, tool_use blocks
├── google.ts         Gemini API, function calls
├── openai-completions.ts   Chat completions, function_call
└── openai-responses.ts     Responses API (newer)
```

**Common pattern:**

```typescript
async function* streamProvider(context, config, signal) {
  // Build provider-specific request
  const request = buildRequest(context, config);
  
  // Make streaming HTTP call
  const response = await fetch(url, { body: JSON.stringify(request), signal });
  
  // Parse SSE stream
  for await (const line of parseSSE(response.body)) {
    // Transform to common StreamChunk format
    yield transformChunk(line);
  }
}
```

### Message Transformation: `packages/ai/src/providers/transform-messages.ts`

Converts between internal format and provider-specific formats:

```
transformForAnthropic(messages)
    └─► { role, content: ContentBlock[] }

transformForOpenAI(messages)
    └─► { role, content, tool_calls?, function_call? }

transformForGoogle(messages)
    └─► { role, parts: Part[] }
```

## Tool System

### Base Tools: `packages/base-tools/src/`

```
packages/base-tools/src/
├── index.ts          Exports codingTools array
└── tools/
    ├── read.ts       File reading, image base64
    ├── write.ts      File creation/overwrite
    ├── edit.ts       Surgical text replacement
    ├── bash.ts       Command execution
    ├── path-utils.ts Path normalization
    └── truncate.ts   Large output handling
```

**Tool structure:**

```typescript
const readTool: AgentTool<ReadParams, ReadDetails> = {
  name: "read",
  description: "Read file contents...",
  parameters: ReadParamsSchema,  // TypeBox schema
  
  async execute({ path, offset, limit }, { signal }) {
    // Implementation
    return {
      content: [{ type: "text", text: fileContent }],
      details: { path, lines, bytes }
    };
  }
};
```

### Tool Wrapping Pipeline

Tools are wrapped in layers for extensibility:

```
codingTools (base)
    │
    ├─► wrapToolsWithHooks(tools, hookRunner)
    │   │
    │   └─► For each tool:
    │       └─► Wrap execute():
    │           ├─ Emit tool.execute.before
    │           ├─ Check for block
    │           ├─ Call original execute
    │           ├─ Emit tool.execute.after
    │           └─ Apply result modifications
    │
    └─► wrapToolsWithLspDiagnostics(tools, lsp, opts)
        │
        └─► For write/edit tools:
            └─► Wrap execute():
                ├─ Call original execute
                ├─ lsp.touchFile(path)
                ├─ Collect diagnostics
                └─ Append to result
```

## LSP Integration

### Manager: `packages/lsp/src/manager.ts`

```
createLspManager(options)
    │
    ├─► State
    │   ├─ clients: Map<key, LspClient>
    │   ├─ spawning: Map<key, Promise>
    │   └─ brokenUntil: Map<key, timestamp>
    │
    ├─► touchFile(path, opts)
    │   ├─ Check if enabled
    │   ├─ Find server definitions for file type
    │   ├─ Ensure server is installed
    │   ├─ Get or spawn client
    │   ├─ Notify file change
    │   └─ Wait for diagnostics if requested
    │
    ├─► diagnostics()
    │   └─ Collect all diagnostics from all clients
    │
    └─► shutdown()
        └─ Gracefully stop all servers
```

### Client: `packages/lsp/src/client.ts`

Handles JSON-RPC communication with language servers:

```
LspClient
    │
    ├─► Initialization
    │   ├─ Spawn server process
    │   ├─ Send initialize request
    │   └─ Send initialized notification
    │
    ├─► File operations
    │   ├─ openOrChangeFile(path, languageId)
    │   └─ waitForDiagnostics(path)
    │
    ├─► Diagnostic tracking
    │   ├─ Handle textDocument/publishDiagnostics
    │   └─ Store per-file diagnostic arrays
    │
    └─► Shutdown
        ├─ Send shutdown request
        └─ Kill process
```

### Server Registry: `packages/lsp/src/registry.ts`

Defines which servers handle which file types:

```typescript
const SERVERS: LspServerDefinition[] = [
  {
    id: "typescript-language-server",
    languages: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    detectRoot: async (file, cwd) => {
      // Find nearest package.json or tsconfig.json
    }
  }
];
```

## TUI Components

### Component Tree

```
apps/coding-agent/src/
├── tui-app.tsx          Main app component
├── components/
│   ├── MessageList.tsx  Scrollable message container
│   └── Footer.tsx       Status bar with model/context
├── session-picker.tsx   Session selection dialog
├── tui-open-rendering.tsx  Tool block components
├── agent-events.ts      Event → UI state mapping
└── keyboard-handler.ts  Key bindings
```

### Reactive State Flow

```
Agent Events ──► EventHandler ──► Solid Signals ──► Components

agent.subscribe(handler)
    │
    ├─► message_update
    │   └─► setMessages(prev => [...prev, updated])
    │       └─► <MessageList /> re-renders
    │
    ├─► tool_execution_end
    │   └─► setToolBlocks(prev => [...prev, tool])
    │       └─► <ToolBlock /> renders result
    │
    └─► agent_end
        └─► setActivityState("idle")
            └─► <Footer /> updates status
```

### Message Rendering: `tui-open-rendering.tsx`

Tool blocks use a registry pattern for custom rendering:

```typescript
const registry: Record<string, ToolRenderer> = {
  bash: {
    mode: (ctx) => ctx.expanded ? "block" : "inline",
    renderHeader: (ctx) => <ToolHeader label="BASH" detail={cmd} />,
    renderBody: (ctx) => <CodeBlock content={output} />
  },
  edit: {
    mode: () => "block",
    renderHeader: (ctx) => <ToolHeader label="EDIT" detail={path} />,
    renderBody: (ctx) => <Diff diffText={ctx.editDiff} />
  },
  // ... other tools
};
```

### Keyboard Handling: `keyboard-handler.ts`

```
useKeyboardHandler(opts)
    │
    ├─► Global keys (always active):
    │   ├─ Ctrl+C → abort() or exit
    │   ├─ Ctrl+L → clear screen
    │   └─ Esc → cancel retry/selection
    │
    ├─► Editor keys (when editing):
    │   ├─ Enter → submit prompt
    │   ├─ Shift+Enter → newline
    │   ├─ Up/Down → history navigation
    │   └─ Tab → autocomplete
    │
    └─► Modal keys (when dialog open):
        ├─ Up/Down → navigate options
        ├─ Enter → select
        └─ Esc → close
```

## Session Management

### SessionManager: `apps/coding-agent/src/session-manager.ts`

```
SessionManager
    │
    ├─► Storage
    │   └─ ~/.local/share/marvin/sessions/*.json
    │
    ├─► startSession(provider, model, thinking)
    │   ├─ Generate session ID
    │   ├─ Create file with metadata
    │   └─ Set as current session
    │
    ├─► loadSession(id)
    │   ├─ Read session file
    │   ├─ Populate agent.replaceMessages()
    │   └─ Return session metadata
    │
    ├─► appendMessage(message)
    │   ├─ Add to current session
    │   └─ Write to disk (debounced)
    │
    └─► listSessions()
        └─ Scan directory, sort by date
```

## Hook System

### HookRunner: `apps/coding-agent/src/hooks/runner.ts`

```
HookRunner
    │
    ├─► handlers: Map<eventType, handler[]>
    │
    ├─► register(hookAPI)
    │   └─ Hook calls marvin.on(event, handler)
    │       └─ handlers.get(event).push(handler)
    │
    ├─► emit(event)
    │   │
    │   ├─► Get handlers for event.type
    │   │
    │   ├─► Run each handler with event + context
    │   │   └─ ctx: { exec, cwd, configDir }
    │   │
    │   └─► Collect and merge results
    │       ├─ tool.execute.before: { block?, reason? }
    │       └─ tool.execute.after: { content?, details? }
    │
    └─► messageCallback
        └─ Set by TUI to handle marvin.send()
```

### Tool Wrapper: `apps/coding-agent/src/hooks/tool-wrapper.ts`

```typescript
function wrapToolsWithHooks(tools, runner) {
  return tools.map(tool => ({
    ...tool,
    execute: async (params, ctx) => {
      // Before hook - can block
      const beforeResult = await runner.emit({
        type: "tool.execute.before",
        toolName: tool.name,
        input: params
      });
      
      if (beforeResult?.block) {
        return { content: [{ type: "text", text: beforeResult.reason }] };
      }
      
      // Execute tool
      const result = await tool.execute(params, ctx);
      
      // After hook - can modify
      const afterResult = await runner.emit({
        type: "tool.execute.after",
        toolName: tool.name,
        input: params,
        content: result.content,
        details: result.details
      });
      
      return afterResult ?? result;
    }
  }));
}
```

## Command System

### Slash Commands: `apps/coding-agent/src/commands.ts`

```
handleSlashCommand(line, ctx)
    │
    ├─► Parse command and args
    │
    ├─► Dispatch to handler:
    │   ├─ /exit, /quit → process.exit()
    │   ├─ /clear → agent.reset(), clear UI
    │   ├─ /thinking <level> → setThinkingLevel()
    │   ├─ /model [provider] <id> → setModel()
    │   ├─ /theme [name] → setTheme()
    │   ├─ /compact [instructions] → doCompact()
    │   └─ /diffwrap → toggle mode
    │
    └─► Return true if handled
```

### Custom Commands: `apps/coding-agent/src/custom-commands.ts`

```
loadCustomCommands(configDir)
    │
    ├─► Scan ~/.config/marvin/commands/*.md
    │
    ├─► For each file:
    │   ├─ Parse markdown content
    │   ├─ Extract {{input}} placeholder
    │   └─ Create command entry
    │
    └─► Return Map<name, template>

executeCustomCommand(name, input, commands)
    │
    ├─► Get template from map
    │
    ├─► Replace {{input}} or append input
    │
    └─► Return expanded prompt
```

## Autocomplete

### Provider Chain: `apps/coding-agent/src/autocomplete-commands.ts`

```
CombinedAutocompleteProvider
    │
    ├─► SlashCommandProvider
    │   ├─ Builtin commands
    │   └─ Custom commands from config
    │
    ├─► FilePathProvider
    │   ├─ Scans cwd recursively
    │   ├─ Respects .gitignore
    │   └─ Caches index for speed
    │
    └─► ToolNameProvider
        └─ @tool_name completions
```

### File Indexing: `packages/open-tui/src/autocomplete/file-index.ts`

```
FileIndex
    │
    ├─► build(cwd)
    │   ├─ Walk directory tree
    │   ├─ Filter by .gitignore
    │   └─ Cache file paths
    │
    ├─► search(prefix)
    │   └─ Filter cached paths by prefix
    │
    └─► refresh()
        └─ Rebuild after file changes
```

## Package Boundaries

### What goes where:

| Concern | Package | Reason |
|---------|---------|--------|
| LLM API calls | `ai` | Provider-agnostic abstraction |
| Message streaming | `ai` | Tied to provider APIs |
| Agent state | `agent-core` | Stateful, UI-independent |
| Transport logic | `agent-core` | Backend abstraction |
| File operations | `base-tools` | Reusable across agents |
| LSP protocol | `lsp` | Isolated complexity |
| UI components | `open-tui` | Reusable TUI library |
| App logic | `coding-agent` | CLI-specific integration |

### Import Rules

```
coding-agent can import from:
  ├─ ai (types, models, streaming)
  ├─ agent-core (Agent, transports)
  ├─ base-tools (codingTools)
  ├─ lsp (LspManager)
  └─ open-tui (components, hooks)

agent-core can import from:
  └─ ai (types, agent-loop)

base-tools can import from:
  └─ ai (types only)

lsp cannot import from:
  └─ (standalone, only vscode-languageserver-types)

open-tui cannot import from:
  └─ (standalone UI library)
```

## Testing

### Test Locations

```
apps/coding-agent/tests/
├── config.test.ts        Config loading tests
└── ...

packages/ai/tests/
├── agent-loop.test.ts    Agent loop tests
├── overflow.test.ts      Context overflow tests
└── providers/*.test.ts   Provider-specific tests

packages/lsp/tests/
├── diagnostics.test.ts   Diagnostic formatting
└── tool-wrapper.test.ts  LSP tool wrapper
```

### Running Tests

```bash
# All tests
bun run test

# Specific package
bun test packages/ai/tests

# Specific file
bun test apps/coding-agent/tests/config.test.ts

# With coverage
bun test --coverage
```

## Common Modification Patterns

### Adding a New Tool

1. Create tool in `packages/base-tools/src/tools/new-tool.ts`
2. Export from `packages/base-tools/src/index.ts`
3. Add renderer in `apps/coding-agent/src/tui-open-rendering.tsx`

### Adding a New Provider

1. Create adapter in `packages/ai/src/providers/new-provider.ts`
2. Add to switch in `packages/ai/src/stream.ts`
3. Add models in `packages/ai/src/models.generated.ts`
4. Update `getProviders()` in `packages/ai/src/models.ts`

### Adding a New Hook Event

1. Add event type in `apps/coding-agent/src/hooks/types.ts`
2. Update `HookEventMap` and `HookResultMap`
3. Emit from appropriate location (agent-events.ts, tool-wrapper.ts)
4. Document in README

### Adding a Slash Command

1. Add handler in `apps/coding-agent/src/commands.ts`
2. Add to autocomplete in `apps/coding-agent/src/autocomplete-commands.ts`
3. Update help/docs

## Debugging Tips

### Enable Verbose Logging

```bash
DEBUG=* bun run marvin
```

### Inspect Agent State

Add to keyboard handler:

```typescript
if (key === "d" && ctrl) {
  console.log(JSON.stringify(agent.state, null, 2));
}
```

### Trace Events

```typescript
agent.subscribe((ev) => {
  console.log(`[${ev.type}]`, ev);
});
```

### Profile Performance

```bash
bun run marvin --profile
```

### Inspect LSP Communication

Set `DEBUG=lsp:*` or add logging in `packages/lsp/src/client.ts`.

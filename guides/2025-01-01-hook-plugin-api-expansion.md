# Hook Plugin API Expansion - Implementation Guide

> **Purpose**: Tutorial for implementing the expanded hook system that supports OpenCode-style plugins (supermemory, auth hooks) with tool registration, token tracking, and session operations.
> **Time estimate**: 8-12 hours of focused coding across 3 sessions
> **Difficulty**: Intermediate to Advanced
> **Prerequisites**: Understanding of TypeScript, async/await, event-driven patterns

## Background & Context

### Why Are We Doing This?

The current hook system is minimal—hooks can subscribe to events and send text messages, but they can't:
- **Register tools** (like supermemory's add/search/profile/list/forget)
- **Access token usage** for triggering compaction when context fills up
- **Show UI notifications** or trigger session operations
- **Inject context** before LLM calls (like memory injection on first message)

We want hooks like [opencode-supermemory](https://github.com/supermemory/opencode-supermemory) to work. This plugin:
1. Injects memory context on the first message of a session
2. Registers a `supermemory` tool for the agent to call
3. Watches token usage and triggers compaction at 80% threshold
4. Saves compaction summaries as memories

### How the Current System Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                           TUI App                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ User Input   │───▶│    Agent     │───▶│  ProviderTransport   │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│         │                   │                       │               │
│         │                   │                       ▼               │
│         │                   │              ┌──────────────────┐    │
│         │                   │              │   LLM Provider   │    │
│         │                   │              └──────────────────┘    │
│         │                   │                                       │
│  ┌──────▼───────────────────▼───────────────────────────────────┐  │
│  │                      HookRunner                                │  │
│  │  emit("app.start") → emit("agent.start") → emit("turn.end")  │  │
│  │                                                                │  │
│  │  LoadedHook[]                                                  │  │
│  │  ├── handlers: Map<EventType, Handler[]>                      │  │
│  │  └── setSendHandler: (handler) => void                        │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Current flow:**
1. `loadHooks()` discovers `.ts` files in `~/.config/marvin/hooks/`
2. Each hook exports a factory function that receives `HookAPI`
3. Hooks call `marvin.on("event", handler)` to register handlers
4. `HookRunner` emits events at lifecycle points
5. Handlers receive `(event, ctx)` where `ctx` has `exec()`, `cwd`, `configDir`

**What's missing for supermemory:**
- No `registerTool()` on HookAPI
- No `sessionId` or token usage in context/events
- No `ctx.session.summarize()` or `ctx.session.toast()`
- No way to mutate messages before LLM call

### Key Files to Understand

| File | Purpose | What We'll Do |
|------|---------|---------------|
| `apps/coding-agent/src/hooks/types.ts` | Type definitions for events, context, API | **Heavily modify** - add 15+ new types |
| `apps/coding-agent/src/hooks/loader.ts` | Loads hook files, creates HookAPI | **Modify** - add tool/command/renderer maps |
| `apps/coding-agent/src/hooks/runner.ts` | Executes hooks, emits events | **Heavily modify** - add transforms, accessors |
| `apps/coding-agent/src/hooks/tool-wrapper.ts` | Wraps tools with hook callbacks | **Modify** - add arg mutation, error emission |
| `apps/coding-agent/src/session-manager.ts` | Session persistence | **Modify** - add custom entries, readonly interface |
| `apps/coding-agent/src/tui-app.tsx` | Main TUI application | **Modify** - wire up new hook features |
| `apps/coding-agent/src/agent-events.ts` | Event handling for agent | **Modify** - add token tracking |
| `packages/agent/src/transports/types.ts` | Transport config types | **Modify** - add auth/routing overrides |

### Mental Model

Think of the hook system as having three layers:

```
┌─────────────────────────────────────────────────┐
│  Layer 3: Integration (tui-app, agent-events)  │
│  - Wire hooks into app lifecycle                │
│  - Provide session/UI context                   │
└─────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│  Layer 2: Runtime (runner.ts, tool-wrapper.ts) │
│  - Execute handlers                             │
│  - Apply transforms                             │
│  - Track state (tokens, session)                │
└─────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│  Layer 1: Types & Loading (types.ts, loader.ts)│
│  - Define event shapes                          │
│  - Define HookAPI surface                       │
│  - Load and validate hooks                      │
└─────────────────────────────────────────────────┘
```

We build bottom-up: types first, then runtime, then integration.

### Patterns to Follow

**Event mutation pattern** (from the plan):
```typescript
// Events with input/output allow hooks to mutate the output
export interface ChatMessageEvent {
  type: "chat.message"
  input: { sessionId: string | null; text: string }  // Read-only
  output: { parts: MessagePart[] }                    // Mutable
}

// Hook mutates output.parts
marvin.on("chat.message", (event) => {
  event.output.parts.unshift({ type: "text", text: "Memory context..." })
})
```

**Registration pattern** (similar to existing `on()`):
```typescript
// From loader.ts - how handlers are collected
const api: HookAPI = {
  on(event, handler): void {
    const list = handlers.get(event) ?? []
    list.push(handler)
    handlers.set(event, list)
  },
  // We'll add similar patterns:
  registerTool(tool): void { tools.set(tool.name, tool) },
  registerCommand(name, opts): void { commands.set(name, { name, ...opts }) },
}
```

---

## Milestone 1: Core Types & Data Structures

### Goal
Define all new types for events, contexts, and API extensions. After this milestone, you'll have a complete type system that describes the entire expanded hook API.

### Verification
```bash
bun run typecheck  # Should pass (types only, no implementation yet)
```

### Concepts

**Token Usage**: LLM providers return token counts after each request. We expose this to hooks so they can trigger compaction when usage approaches the context limit.

```typescript
export interface TokenUsage {
  input: number      // Tokens in the prompt
  output: number     // Tokens in the response
  cacheRead?: number // Tokens read from cache (Anthropic)
  cacheWrite?: number // Tokens written to cache
  total: number      // Total tokens used
}
```

**Session Facade**: Instead of exposing the full `SessionManager`, we give hooks a limited interface for session operations.

```typescript
export interface HookSessionContext {
  summarize(): Promise<void>  // Trigger compaction
  toast(title: string, message: string, variant?: string): void
  getTokenUsage(): TokenUsage | undefined
  getContextLimit(): number | undefined
}
```

### Steps

#### 1.1 Add Token Usage Type

**What we're doing**: Define the structure for token tracking that mirrors LLM provider responses.

**File**: `apps/coding-agent/src/hooks/types.ts`

Find the imports at the top and update them:

```typescript
// BEFORE (around line 7-8):
import type { AppMessage, ThinkingLevel } from "@yeshwanthyk/agent-core"
import type { AgentTool, ImageContent, TextContent, ToolResultMessage } from "@yeshwanthyk/ai"

// AFTER:
import type { AppMessage, ThinkingLevel } from "@yeshwanthyk/agent-core"
import type { 
  AgentTool, 
  Api, 
  ImageContent, 
  Message, 
  Model, 
  SimpleStreamOptions, 
  TextContent, 
  ToolResultMessage 
} from "@yeshwanthyk/ai"
import type { Theme } from "@yeshwanthyk/open-tui"
import type { JSX } from "solid-js"
```

Now add the TokenUsage type after the `ExecOptions` interface (around line 25):

```typescript
// ============================================================================
// Token Usage
// ============================================================================

/** Token usage statistics from LLM response */
export interface TokenUsage {
  /** Tokens in the prompt/input */
  input: number
  /** Tokens in the response/output */
  output: number
  /** Tokens read from cache (provider-specific) */
  cacheRead?: number
  /** Tokens written to cache (provider-specific) */
  cacheWrite?: number
  /** Total tokens used (input + output) */
  total: number
}
```

**Why this way**: We mirror the structure providers give us, but normalize it into a consistent interface. The optional cache fields handle provider differences (Anthropic has caching, OpenAI doesn't).

#### 1.2 Add Session Context Types

**What we're doing**: Define the limited session interface and UI context that hooks receive.

**File**: `apps/coding-agent/src/hooks/types.ts`

Add after TokenUsage (this is a new section):

```typescript
// ============================================================================
// Hook Contexts (UI, Session)
// ============================================================================

/** UI operations available to hooks (no-op in headless mode) */
export interface HookUIContext {
  /** Show a selection dialog */
  select(title: string, options: string[]): Promise<string | undefined>
  /** Show a confirmation dialog */
  confirm(title: string, message: string): Promise<boolean>
  /** Show an input dialog */
  input(title: string, placeholder?: string): Promise<string | undefined>
  /** Show a notification */
  notify(message: string, type?: "info" | "warning" | "error"): void
  /** Render a custom component (advanced) */
  custom<T>(factory: (done: (result: T) => void) => JSX.Element): Promise<T | undefined>
  /** Set the editor text */
  setEditorText(text: string): void
  /** Get current editor text */
  getEditorText(): string
}

/** Session operations available to hooks */
export interface HookSessionContext {
  /** Trigger session compaction/summarization */
  summarize(): Promise<void>
  /** Show toast notification (TUI only, no-op in headless) */
  toast(title: string, message: string, variant?: "info" | "warning" | "success" | "error"): void
  /** Get current token usage for the session */
  getTokenUsage(): TokenUsage | undefined
  /** Get model context limit */
  getContextLimit(): number | undefined
}
```

**Why this way**: The UI context is intentionally async—dialogs need user interaction. The session context provides the minimal operations hooks need without exposing internal session management.

#### 1.3 Add Hook Message & Registration Types

**What we're doing**: Define types for hook-generated messages, commands, tools, and renderers.

**File**: `apps/coding-agent/src/hooks/types.ts`

Add after HookSessionContext:

```typescript
// ============================================================================
// Hook Messages & Registration
// ============================================================================

/** Content part in a message (text or image) */
export type MessagePart = TextContent | ImageContent

/** Message generated by a hook (injected into conversation) */
export interface HookMessage<T = unknown> {
  role: "hookMessage"
  /** Custom type identifier for rendering */
  customType: string
  /** Message content */
  content: string | MessagePart[]
  /** Whether to display in UI (always sent to LLM) */
  display: boolean
  /** Optional custom data for renderers */
  details?: T
  /** Creation timestamp */
  timestamp: number
}

/** Registered slash command from a hook */
export interface RegisteredCommand {
  name: string
  description?: string
  handler: (args: string, ctx: HookEventContext) => Promise<void>
}

/** Custom message renderer from a hook */
export type HookMessageRenderer<T = unknown> = (
  message: HookMessage<T>,
  options: { expanded: boolean },
  theme: Theme
) => JSX.Element | undefined

/** JSON Schema subset for hook tool parameters */
export interface HookToolSchema {
  type: "object"
  properties: Record<string, {
    type: "string" | "number" | "boolean" | "array" | "object"
    description?: string
    enum?: string[]
    optional?: boolean
  }>
  required?: string[]
}

/** Tool registered by a hook */
export interface RegisteredTool {
  name: string
  description: string
  schema: HookToolSchema
  execute: (args: Record<string, unknown>, ctx: HookEventContext) => Promise<string>
}
```

**Why this way**: 
- `HookMessage` has `display: boolean` because some injected context shouldn't clutter the UI but must go to the LLM
- `RegisteredTool` returns `string` not a complex object—hooks serialize their results as JSON strings (matches OpenCode pattern)
- `HookToolSchema` is a simplified JSON Schema—full JSON Schema is overkill for hook tools

#### 1.4 Update HookEventContext

**What we're doing**: Expand the context object that handlers receive with session and UI access.

**File**: `apps/coding-agent/src/hooks/types.ts`

Find the `HookEventContext` interface (around line 28-36) and replace it:

```typescript
// BEFORE:
export interface HookEventContext {
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>
  cwd: string
  configDir: string
}

// AFTER:
/** Context passed to hook event handlers */
export interface HookEventContext {
  /** Execute a shell command */
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>
  /** Current working directory */
  cwd: string
  /** Config directory (~/.config/marvin) */
  configDir: string
  /** Current session ID (null if no session) */
  sessionId: string | null
  /** Read-only session manager for querying session state */
  sessionManager: ReadonlySessionManager
  /** UI operations (no-op in headless) */
  ui: HookUIContext
  /** Whether UI is available */
  hasUI: boolean
  /** Session operations (summarize, toast, token info) */
  session: HookSessionContext
}
```

**Watch out for**: We reference `ReadonlySessionManager` here but haven't defined it yet. We'll add it to session-manager.ts in Milestone 2. For now, add a forward declaration at the top of the file after imports:

```typescript
// Forward declaration - defined in session-manager.ts
export interface ReadonlySessionManager {
  sessionId: string | null
  sessionPath: string | null
  getCompactionState(): CompactionState | undefined
  getEntries(): SessionEntry[]
  listSessions(): SessionInfo[]
  loadSession(sessionPath: string): LoadedSession | null
  loadLatest(): LoadedSession | null
}

// These types come from session-manager.ts - we'll reference them
export interface CompactionState {
  lastSummary: string
  readFiles: string[]
  modifiedFiles: string[]
}
export interface SessionInfo {
  id: string
  timestamp: number
  path: string
  provider: string
  modelId: string
}
export interface SessionEntry {
  type: string
  timestamp: number
  [key: string]: unknown
}
export interface LoadedSession {
  metadata: unknown
  messages: AppMessage[]
}
```

**Note**: These forward declarations will be removed once we properly import from session-manager.ts in Phase 2. For now, they let us typecheck.

#### 1.5 Add New Event Types

**What we're doing**: Add all the new events for chat transforms, auth, session lifecycle.

**File**: `apps/coding-agent/src/hooks/types.ts`

Find the Events section (after existing event interfaces, around line 90). Add these new events:

```typescript
// ============================================================================
// New Events: Chat Transforms
// ============================================================================

/** Fired before processing user message - can mutate parts */
export interface ChatMessageEvent {
  type: "chat.message"
  input: { sessionId: string | null; text: string }
  output: { parts: MessagePart[] }
}

/** Fired before LLM call - can transform message history */
export interface ChatMessagesTransformEvent {
  type: "chat.messages.transform"
  messages: Message[]
}

/** Fired before LLM call - can mutate system prompt */
export interface ChatSystemTransformEvent {
  type: "chat.system.transform"
  input: { sessionId: string | null; systemPrompt: string }
  output: { systemPrompt: string }
}

/** Fired before LLM call - can add stream options */
export interface ChatParamsEvent {
  type: "chat.params"
  input: { sessionId: string | null }
  output: { streamOptions: SimpleStreamOptions }
}

// ============================================================================
// New Events: Auth & Routing
// ============================================================================

/** Fired to get auth credentials for a provider */
export interface AuthGetEvent {
  type: "auth.get"
  input: { sessionId: string | null; provider: string; modelId: string }
  output: { apiKey?: string; headers?: Record<string, string>; baseUrl?: string }
}

/** Fired to resolve/override model selection */
export interface ModelResolveEvent {
  type: "model.resolve"
  input: { sessionId: string | null; model: Model<Api> }
  output: { model: Model<Api> }
}

// ============================================================================
// New Events: Agent Lifecycle
// ============================================================================

/** Fired before agent starts processing (after chat.message) */
export interface BeforeAgentStartEvent {
  type: "agent.before_start"
  prompt: string
  images?: ImageContent[]
}

/** Result from before_agent_start handler */
export interface BeforeAgentStartResult {
  /** Optional message to inject before the prompt */
  message?: Pick<HookMessage, "customType" | "content" | "display" | "details">
}

// ============================================================================
// New Events: Session Lifecycle
// ============================================================================

/** Fired before compaction - can cancel or customize */
export interface SessionBeforeCompactEvent {
  type: "session.before_compact"
  input: { sessionId: string | null }
  output: { cancel?: boolean; prompt?: string; context?: string[] }
}

/** Fired after compaction completes */
export interface SessionCompactEvent {
  type: "session.compact"
  sessionId: string | null
  summary: string
}

/** Fired when session/app is shutting down */
export interface SessionShutdownEvent {
  type: "session.shutdown"
  sessionId: string | null
}
```

#### 1.6 Update Existing Events with sessionId and Tokens

**What we're doing**: Add sessionId to all events and token usage to turn/agent end events.

**File**: `apps/coding-agent/src/hooks/types.ts`

Find and update these existing events:

```typescript
// BEFORE:
export interface AgentStartEvent {
  type: "agent.start"
}

// AFTER:
export interface AgentStartEvent {
  type: "agent.start"
  sessionId: string | null
}
```

```typescript
// BEFORE:
export interface AgentEndEvent {
  type: "agent.end"
  messages: AppMessage[]
}

// AFTER:
export interface AgentEndEvent {
  type: "agent.end"
  sessionId: string | null
  messages: AppMessage[]
  /** Total tokens used across all turns */
  totalTokens: TokenUsage
  /** Model context window limit */
  contextLimit: number
}
```

```typescript
// BEFORE:
export interface TurnStartEvent {
  type: "turn.start"
  turnIndex: number
}

// AFTER:
export interface TurnStartEvent {
  type: "turn.start"
  sessionId: string | null
  turnIndex: number
}
```

```typescript
// BEFORE:
export interface TurnEndEvent {
  type: "turn.end"
  turnIndex: number
  message: AppMessage
  toolResults: ToolResultMessage[]
  usage?: ContextUsage
}

// AFTER:
export interface TurnEndEvent {
  type: "turn.end"
  sessionId: string | null
  turnIndex: number
  message: AppMessage
  toolResults: ToolResultMessage[]
  /** Token usage for this turn */
  tokens: TokenUsage
  /** Model context window limit */
  contextLimit: number
}
```

```typescript
// BEFORE:
export interface ToolExecuteBeforeEvent {
  type: "tool.execute.before"
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
}

// AFTER:
export interface ToolExecuteBeforeEvent {
  type: "tool.execute.before"
  sessionId: string | null
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
}
```

```typescript
// BEFORE:
export interface ToolExecuteAfterEvent {
  type: "tool.execute.after"
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
  content: (TextContent | ImageContent)[]
  details: unknown
  isError: boolean
}

// AFTER:
export interface ToolExecuteAfterEvent<TDetails = unknown> {
  type: "tool.execute.after"
  sessionId: string | null
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
  content: (TextContent | ImageContent)[]
  details: TDetails
  isError: boolean
}
```

Also update `ToolExecuteBeforeResult` to allow input mutation:

```typescript
// BEFORE:
export interface ToolExecuteBeforeResult {
  block?: boolean
  reason?: string
}

// AFTER:
export interface ToolExecuteBeforeResult {
  block?: boolean
  reason?: string
  /** Modified input arguments (replaces original if provided) */
  input?: Record<string, unknown>
}
```

#### 1.7 Update HookEvent Union and Maps

**What we're doing**: Register all new events in the type system.

**File**: `apps/coding-agent/src/hooks/types.ts`

Find and replace the `HookEvent` union type:

```typescript
// BEFORE:
export type HookEvent =
  | AppStartEvent
  | SessionEvent
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | ToolExecuteBeforeEvent
  | ToolExecuteAfterEvent

// AFTER:
export type HookEvent =
  | AppStartEvent
  | SessionEvent
  | SessionBeforeCompactEvent
  | SessionCompactEvent
  | SessionShutdownEvent
  | BeforeAgentStartEvent
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | ToolExecuteBeforeEvent
  | ToolExecuteAfterEvent
  | ChatMessageEvent
  | ChatMessagesTransformEvent
  | ChatSystemTransformEvent
  | ChatParamsEvent
  | AuthGetEvent
  | ModelResolveEvent
```

Find and replace `HookEventMap`:

```typescript
// BEFORE:
export interface HookEventMap {
  "app.start": AppStartEvent
  "session.start": SessionEvent
  "session.resume": SessionEvent
  "session.clear": SessionEvent
  "agent.start": AgentStartEvent
  "agent.end": AgentEndEvent
  "turn.start": TurnStartEvent
  "turn.end": TurnEndEvent
  "tool.execute.before": ToolExecuteBeforeEvent
  "tool.execute.after": ToolExecuteAfterEvent
}

// AFTER:
export interface HookEventMap {
  "app.start": AppStartEvent
  "session.start": SessionEvent
  "session.resume": SessionEvent
  "session.clear": SessionEvent
  "session.before_compact": SessionBeforeCompactEvent
  "session.compact": SessionCompactEvent
  "session.shutdown": SessionShutdownEvent
  "agent.before_start": BeforeAgentStartEvent
  "agent.start": AgentStartEvent
  "agent.end": AgentEndEvent
  "turn.start": TurnStartEvent
  "turn.end": TurnEndEvent
  "tool.execute.before": ToolExecuteBeforeEvent
  "tool.execute.after": ToolExecuteAfterEvent
  "chat.message": ChatMessageEvent
  "chat.messages.transform": ChatMessagesTransformEvent
  "chat.system.transform": ChatSystemTransformEvent
  "chat.params": ChatParamsEvent
  "auth.get": AuthGetEvent
  "model.resolve": ModelResolveEvent
}
```

Find and replace `HookResultMap`:

```typescript
// BEFORE:
export interface HookResultMap {
  "app.start": void
  "session.start": void
  "session.resume": void
  "session.clear": void
  "agent.start": void
  "agent.end": void
  "turn.start": void
  "turn.end": void
  "tool.execute.before": ToolExecuteBeforeResult | undefined
  "tool.execute.after": ToolExecuteAfterResult | undefined
}

// AFTER:
export interface HookResultMap {
  "app.start": void
  "session.start": void
  "session.resume": void
  "session.clear": void
  "session.before_compact": void
  "session.compact": void
  "session.shutdown": void
  "agent.before_start": BeforeAgentStartResult | undefined
  "agent.start": void
  "agent.end": void
  "turn.start": void
  "turn.end": void
  "tool.execute.before": ToolExecuteBeforeResult | undefined
  "tool.execute.after": ToolExecuteAfterResult | undefined
  "chat.message": void
  "chat.messages.transform": void
  "chat.system.transform": void
  "chat.params": void
  "auth.get": void
  "model.resolve": void
}
```

#### 1.8 Expand HookAPI Interface

**What we're doing**: Add all the new registration methods to the API that hooks receive.

**File**: `apps/coding-agent/src/hooks/types.ts`

Find and replace the `HookAPI` interface:

```typescript
// BEFORE:
export interface HookAPI {
  on<T extends HookEventType>(
    event: T,
    handler: HookHandler<HookEventMap[T], HookResultMap[T]>
  ): void
  
  send(text: string): void
}

// AFTER:
/**
 * HookAPI passed to hook factory functions.
 * Hooks use marvin.on() to subscribe to events and other methods to register capabilities.
 */
export interface HookAPI {
  /** Subscribe to an event */
  on<T extends HookEventType>(
    event: T,
    handler: HookHandler<HookEventMap[T], HookResultMap[T]>
  ): void
  
  /**
   * Send a message to the agent.
   * If agent is streaming, message is queued.
   * If agent is idle, triggers a new agent loop.
   */
  send(text: string): void

  /**
   * Send a hook-generated message (persisted and optionally displayed).
   * @param message The message content
   * @param triggerTurn If true, triggers an agent turn after injection
   */
  sendMessage<T = unknown>(
    message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
    triggerTurn?: boolean
  ): void

  /**
   * Append a custom entry to the session log (not a message).
   * Use for persisting hook-specific state.
   */
  appendEntry<T = unknown>(customType: string, data?: T): void

  /**
   * Register a custom renderer for hook messages of a specific type.
   */
  registerMessageRenderer<T = unknown>(
    customType: string, 
    renderer: HookMessageRenderer<T>
  ): void

  /**
   * Register a slash command.
   */
  registerCommand(
    name: string, 
    options: { description?: string; handler: RegisteredCommand["handler"] }
  ): void

  /**
   * Register a tool that the agent can call.
   */
  registerTool(tool: RegisteredTool): void
}
```

### Checkpoint

At this point you should be able to:
- [ ] Run `bun run typecheck` with no errors (or only errors about missing implementations)
- [ ] See all new types available in your IDE when you open `types.ts`
- [ ] See HookAPI shows 7 methods when you hover over it

If something's not working:
- **"Cannot find type X"**: Check imports at the top of the file
- **"Duplicate identifier"**: You may have added a type twice
- **Circular reference**: The forward declarations for session-manager types should prevent this

---

## Milestone 2: Loader & Session Manager Updates

### Goal
Update the hook loader to collect tools, commands, and renderers. Extend session manager with custom entries and a readonly interface.

### Verification
```bash
bun run typecheck  # Should pass
bun test apps/coding-agent  # Existing tests should still pass
```

### Steps

#### 2.1 Update LoadedHook Interface

**What we're doing**: The loader now tracks tools, commands, and renderers in addition to handlers.

**File**: `apps/coding-agent/src/hooks/loader.ts`

Update imports and add new types:

```typescript
// BEFORE (around line 9-10):
import type { HookAPI, HookEventType, HookFactory } from "./types.js"

// AFTER:
import type { 
  HookAPI, 
  HookEvent,
  HookEventType, 
  HookFactory, 
  HookHandler,
  HookMessage, 
  HookMessageRenderer, 
  RegisteredCommand, 
  RegisteredTool 
} from "./types.js"

// Update HandlerFn type to be more specific
type HandlerFn = HookHandler<HookEvent, unknown>
```

Now update the `LoadedHook` interface:

```typescript
// BEFORE:
export interface LoadedHook {
  path: string
  handlers: Map<HookEventType, HandlerFn[]>
  setSendHandler: (handler: SendHandler) => void
}

// AFTER:
/** Handler for sendMessage() calls */
export type SendMessageHandler = <T = unknown>(
  message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
  triggerTurn?: boolean
) => void

/** Handler for appendEntry() calls */
export type AppendEntryHandler = <T = unknown>(customType: string, data?: T) => void

/** Registered handlers and capabilities for a loaded hook */
export interface LoadedHook {
  /** Original file path */
  path: string
  /** Map of event type to handler functions */
  handlers: Map<HookEventType, HandlerFn[]>
  /** Custom message renderers by type */
  messageRenderers: Map<string, HookMessageRenderer>
  /** Registered slash commands */
  commands: Map<string, RegisteredCommand>
  /** Registered tools */
  tools: Map<string, RegisteredTool>
  /** Set the send handler for this hook's marvin.send() */
  setSendHandler: (handler: SendHandler) => void
  /** Set the sendMessage handler */
  setSendMessageHandler: (handler: SendMessageHandler) => void
  /** Set the appendEntry handler */
  setAppendEntryHandler: (handler: AppendEntryHandler) => void
}
```

#### 2.2 Update createHookAPI Function

**What we're doing**: Expand the API factory to support all new methods.

**File**: `apps/coding-agent/src/hooks/loader.ts`

Replace the `createHookAPI` function:

```typescript
// BEFORE: (the entire createHookAPI function)

// AFTER:
/**
 * Create a HookAPI instance that collects handlers and registrations.
 * Returns the API, registries, and setters for runtime handlers.
 */
function createHookAPI(handlers: Map<HookEventType, HandlerFn[]>): {
  api: HookAPI
  messageRenderers: Map<string, HookMessageRenderer>
  commands: Map<string, RegisteredCommand>
  tools: Map<string, RegisteredTool>
  setSendHandler: (handler: SendHandler) => void
  setSendMessageHandler: (handler: SendMessageHandler) => void
  setAppendEntryHandler: (handler: AppendEntryHandler) => void
} {
  // Runtime handlers (set later by app)
  let sendHandler: SendHandler = () => {}
  let sendMessageHandler: SendMessageHandler = () => {}
  let appendEntryHandler: AppendEntryHandler = () => {}
  
  // Registration maps
  const messageRenderers = new Map<string, HookMessageRenderer>()
  const commands = new Map<string, RegisteredCommand>()
  const tools = new Map<string, RegisteredTool>()

  const api: HookAPI = {
    on(event, handler): void {
      const list = handlers.get(event) ?? []
      list.push(handler as HandlerFn)
      handlers.set(event, list)
    },
    send(text: string): void {
      sendHandler(text)
    },
    sendMessage(message, triggerTurn): void {
      sendMessageHandler(message, triggerTurn)
    },
    appendEntry(customType, data): void {
      appendEntryHandler(customType, data)
    },
    registerMessageRenderer(customType, renderer): void {
      messageRenderers.set(customType, renderer)
    },
    registerCommand(name, options): void {
      commands.set(name, { name, ...options })
    },
    registerTool(tool): void {
      tools.set(tool.name, tool)
    },
  }

  return {
    api,
    messageRenderers,
    commands,
    tools,
    setSendHandler: (handler) => { sendHandler = handler },
    setSendMessageHandler: (handler) => { sendMessageHandler = handler },
    setAppendEntryHandler: (handler) => { appendEntryHandler = handler },
  }
}
```

#### 2.3 Update loadHook Function

**What we're doing**: Return all the new registries from the loaded hook.

**File**: `apps/coding-agent/src/hooks/loader.ts`

Update the `loadHook` function:

```typescript
// BEFORE:
async function loadHook(hookPath: string): Promise<{ hook: LoadedHook | null; error: string | null }> {
  try {
    const fileUrl = pathToFileURL(hookPath).href
    const module = await import(fileUrl)
    const factory = module.default as HookFactory

    if (typeof factory !== "function") {
      return { hook: null, error: "Hook must export a default function" }
    }

    const handlers = new Map<HookEventType, HandlerFn[]>()
    const { api, setSendHandler } = createHookAPI(handlers)

    await factory(api)

    return { hook: { path: hookPath, handlers, setSendHandler }, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { hook: null, error: `Failed to load hook: ${message}` }
  }
}

// AFTER:
async function loadHook(hookPath: string): Promise<{ hook: LoadedHook | null; error: string | null }> {
  try {
    const fileUrl = pathToFileURL(hookPath).href
    const module = await import(fileUrl)
    const factory = module.default as HookFactory

    if (typeof factory !== "function") {
      return { hook: null, error: "Hook must export a default function" }
    }

    const handlers = new Map<HookEventType, HandlerFn[]>()
    const { 
      api, 
      messageRenderers, 
      commands, 
      tools,
      setSendHandler, 
      setSendMessageHandler, 
      setAppendEntryHandler 
    } = createHookAPI(handlers)

    await factory(api)

    return { 
      hook: { 
        path: hookPath, 
        handlers, 
        messageRenderers,
        commands,
        tools,
        setSendHandler, 
        setSendMessageHandler,
        setAppendEntryHandler,
      }, 
      error: null 
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { hook: null, error: `Failed to load hook: ${message}` }
  }
}
```

#### 2.4 Add Custom Entries to Session Manager

**What we're doing**: Allow hooks to persist non-message data to session logs.

**File**: `apps/coding-agent/src/session-manager.ts`

First, add the new entry type after `SessionMessageEntry`:

```typescript
// BEFORE (around line 28-32):
export interface SessionMessageEntry {
  type: 'message';
  timestamp: number;
  message: AppMessage;
}

export type SessionEntry = SessionMetadata | SessionMessageEntry;

// AFTER:
export interface SessionMessageEntry {
  type: 'message';
  timestamp: number;
  message: AppMessage;
}

/** Custom entry persisted by hooks */
export interface SessionCustomEntry<T = unknown> {
  type: 'custom';
  timestamp: number;
  /** Hook-defined type identifier */
  customType: string;
  /** Hook-defined data */
  data?: T;
}

export type SessionEntry = SessionMetadata | SessionMessageEntry | SessionCustomEntry;
```

#### 2.5 Add ReadonlySessionManager Interface

**What we're doing**: Define the limited interface hooks receive.

**File**: `apps/coding-agent/src/session-manager.ts`

Add after the `LoadedSession` interface:

```typescript
/** Read-only session manager interface for hooks */
export interface ReadonlySessionManager {
  sessionId: string | null
  sessionPath: string | null
  getCompactionState(): CompactionState | undefined
  getEntries(): SessionEntry[]
  listSessions(): SessionInfo[]
  loadSession(sessionPath: string): LoadedSession | null
  loadLatest(): LoadedSession | null
}
```

#### 2.6 Add appendEntry and getEntries Methods

**What we're doing**: Implement the methods for custom entries.

**File**: `apps/coding-agent/src/session-manager.ts`

Add these methods to the `SessionManager` class (after `appendMessage`):

```typescript
/**
 * Append a custom entry to the current session (async, non-blocking).
 * Used by hooks to persist non-message state.
 */
appendEntry<T = unknown>(customType: string, data?: T): void {
  if (!this.currentSessionPath) return;

  const entry: SessionCustomEntry<T> = {
    type: 'custom',
    timestamp: Date.now(),
    customType,
    data,
  };

  appendFile(this.currentSessionPath, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('Session write error:', err.message);
  });
}

/**
 * Get all entries from the current session.
 */
getEntries(): SessionEntry[] {
  if (!this.currentSessionPath || !existsSync(this.currentSessionPath)) return [];

  try {
    const content = readFileSync(this.currentSessionPath, 'utf8');
    const lines = content.trim().split('\n').filter((l) => l.length > 0);
    const entries: SessionEntry[] = [];
    
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const type = parsed.type;
        if (type === 'session' || type === 'message' || type === 'custom') {
          entries.push(parsed as SessionEntry);
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
    
    return entries;
  } catch {
    return [];
  }
}
```

### Checkpoint

At this point you should be able to:
- [ ] Run `bun run typecheck` with no errors
- [ ] Run `bun test apps/coding-agent` and see existing tests pass
- [ ] See `LoadedHook` now has `tools`, `commands`, `messageRenderers` properties

---

## Milestone 3: Hook Runner Expansion

### Goal
Expand HookRunner with session context, token tracking, and accessor methods for tools/commands/renderers.

### Verification
```bash
bun run typecheck
bun test apps/coding-agent
```

### Steps

#### 3.1 Update HookRunner Imports

**File**: `apps/coding-agent/src/hooks/runner.ts`

Replace the imports:

```typescript
// BEFORE:
import type { LoadedHook, SendHandler } from "./loader.js"
import type {
  ExecOptions,
  ExecResult,
  HookError,
  HookEvent,
  HookEventContext,
  HookEventType,
  ToolExecuteBeforeEvent,
  ToolExecuteBeforeResult,
  ToolExecuteAfterEvent,
  ToolExecuteAfterResult,
} from "./types.js"

// AFTER:
import type { 
  AppendEntryHandler, 
  LoadedHook, 
  SendHandler, 
  SendMessageHandler 
} from "./loader.js"
import type {
  AuthGetEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartResult,
  ChatMessageEvent,
  ChatMessagesTransformEvent,
  ChatParamsEvent,
  ChatSystemTransformEvent,
  ExecOptions,
  ExecResult,
  HookError,
  HookEvent,
  HookEventContext,
  HookMessageRenderer,
  HookSessionContext,
  HookUIContext,
  ModelResolveEvent,
  RegisteredCommand,
  RegisteredTool,
  TokenUsage,
  ToolExecuteBeforeEvent,
  ToolExecuteBeforeResult,
  ToolExecuteAfterEvent,
  ToolExecuteAfterResult,
} from "./types.js"
import type { ReadonlySessionManager } from "../session-manager.js"
import type { ImageContent, Message } from "@yeshwanthyk/ai"
```

#### 3.2 Add No-Op Context Defaults

**File**: `apps/coding-agent/src/hooks/runner.ts`

Add these constants before the `HookRunner` class:

```typescript
/** No-op UI context for headless mode */
const noOpUIContext: HookUIContext = {
  select: async () => undefined,
  confirm: async () => false,
  input: async () => undefined,
  notify: () => {},
  custom: async () => undefined,
  setEditorText: () => {},
  getEditorText: () => "",
}

/** No-op session context for headless mode */
const noOpSessionContext: HookSessionContext = {
  summarize: async () => {},
  toast: () => {},
  getTokenUsage: () => undefined,
  getContextLimit: () => undefined,
}
```

#### 3.3 Rewrite HookRunner Class

**What we're doing**: Complete rewrite to support new initialization pattern, session context, and token tracking.

**File**: `apps/coding-agent/src/hooks/runner.ts`

Replace the entire `HookRunner` class:

```typescript
/**
 * HookRunner executes hooks and manages event emission.
 */
export class HookRunner {
  private hooks: LoadedHook[]
  private cwd: string
  private configDir: string
  private sessionManager: ReadonlySessionManager
  private uiContext: HookUIContext = noOpUIContext
  private sessionContext: HookSessionContext = noOpSessionContext
  private hasUI = false
  private errorListeners = new Set<HookErrorListener>()
  private sessionIdProvider: () => string | null = () => null
  
  // Token tracking
  private tokenUsage: TokenUsage | undefined
  private contextLimit: number | undefined

  constructor(
    hooks: LoadedHook[], 
    cwd: string, 
    configDir: string, 
    sessionManager: ReadonlySessionManager
  ) {
    this.hooks = hooks
    this.cwd = cwd
    this.configDir = configDir
    this.sessionManager = sessionManager
  }

  /**
   * Initialize runtime handlers. Call this after app setup.
   */
  initialize(options: {
    sendHandler: SendHandler
    sendMessageHandler: SendMessageHandler
    appendEntryHandler: AppendEntryHandler
    getSessionId: () => string | null
    uiContext?: HookUIContext
    sessionContext?: HookSessionContext
    hasUI?: boolean
  }): void {
    this.sessionIdProvider = options.getSessionId
    this.uiContext = options.uiContext ?? noOpUIContext
    this.sessionContext = options.sessionContext ?? noOpSessionContext
    this.hasUI = options.hasUI ?? false
    
    for (const hook of this.hooks) {
      hook.setSendHandler(options.sendHandler)
      hook.setSendMessageHandler(options.sendMessageHandler)
      hook.setAppendEntryHandler(options.appendEntryHandler)
    }
  }

  /**
   * Update token usage (called after each turn).
   */
  updateTokenUsage(tokens: TokenUsage | undefined, contextLimit: number | undefined): void {
    this.tokenUsage = tokens
    this.contextLimit = contextLimit
  }

  /** Get the paths of all loaded hooks */
  getHookPaths(): string[] {
    return this.hooks.map((h) => h.path)
  }

  /** Get current session ID */
  getSessionId(): string | null {
    return this.sessionIdProvider()
  }

  /** Get the current hook context */
  getContext(): HookEventContext {
    return this.createContext()
  }

  /** Subscribe to hook errors */
  onError(listener: HookErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  private emitError(error: HookError): void {
    for (const listener of this.errorListeners) {
      listener(error)
    }
  }

  /** Check if any hooks have handlers for the given event type */
  hasHandlers(eventType: HookEventType): boolean {
    for (const hook of this.hooks) {
      const handlers = hook.handlers.get(eventType)
      if (handlers && handlers.length > 0) return true
    }
    return false
  }

  private createContext(): HookEventContext {
    return {
      exec: (command: string, args: string[], options?: ExecOptions) => 
        exec(command, args, this.cwd, options),
      cwd: this.cwd,
      configDir: this.configDir,
      sessionId: this.sessionIdProvider(),
      sessionManager: this.sessionManager,
      ui: this.uiContext,
      hasUI: this.hasUI,
      session: {
        ...this.sessionContext,
        // Override token methods with current values
        getTokenUsage: () => this.tokenUsage,
        getContextLimit: () => this.contextLimit,
      },
    }
  }

  // =========================================================================
  // Registration Accessors
  // =========================================================================

  /** Get a message renderer by custom type */
  getMessageRenderer(customType: string): HookMessageRenderer | undefined {
    for (const hook of this.hooks) {
      const renderer = hook.messageRenderers.get(customType)
      if (renderer) return renderer
    }
    return undefined
  }

  /** Get all registered commands */
  getRegisteredCommands(): RegisteredCommand[] {
    const commands: RegisteredCommand[] = []
    for (const hook of this.hooks) {
      for (const cmd of hook.commands.values()) {
        commands.push(cmd)
      }
    }
    return commands
  }

  /** Get a command by name */
  getCommand(name: string): RegisteredCommand | undefined {
    for (const hook of this.hooks) {
      const cmd = hook.commands.get(name)
      if (cmd) return cmd
    }
    return undefined
  }

  /** Get all registered tools */
  getRegisteredTools(): RegisteredTool[] {
    const tools: RegisteredTool[] = []
    for (const hook of this.hooks) {
      for (const tool of hook.tools.values()) {
        tools.push(tool)
      }
    }
    return tools
  }

  /** Get a tool by name */
  getTool(name: string): RegisteredTool | undefined {
    for (const hook of this.hooks) {
      const tool = hook.tools.get(name)
      if (tool) return tool
    }
    return undefined
  }

  // =========================================================================
  // Event Emission
  // =========================================================================

  /**
   * Emit a general event to all hooks.
   * Errors are caught and reported, not propagated.
   */
  async emit(event: HookEvent): Promise<void> {
    const ctx = this.createContext()

    for (const hook of this.hooks) {
      const handlers = hook.handlers.get(event.type as HookEventType)
      if (!handlers || handlers.length === 0) continue

      for (const handler of handlers) {
        try {
          await handler(event, ctx)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.emitError({ hookPath: hook.path, event: event.type, error: message })
        }
      }
    }
  }

  /**
   * Emit chat.message event and allow mutation of parts.
   */
  async emitChatMessage(
    input: ChatMessageEvent["input"], 
    output: ChatMessageEvent["output"]
  ): Promise<void> {
    const event: ChatMessageEvent = { type: "chat.message", input, output }
    await this.emit(event)
  }

  /**
   * Transform messages through chat.messages.transform hooks.
   */
  async emitContext(messages: Message[]): Promise<Message[]> {
    let current = messages.map((msg) => structuredClone(msg))
    
    for (const hook of this.hooks) {
      const handlers = hook.handlers.get("chat.messages.transform")
      if (!handlers || handlers.length === 0) continue
      
      for (const handler of handlers) {
        try {
          const event: ChatMessagesTransformEvent = { 
            type: "chat.messages.transform", 
            messages: current 
          }
          await handler(event, this.createContext())
          current = event.messages
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.emitError({ hookPath: hook.path, event: "chat.messages.transform", error: message })
        }
      }
    }
    
    return current
  }

  /**
   * Emit agent.before_start and collect result.
   */
  async emitBeforeAgentStart(
    prompt: string, 
    images?: ImageContent[]
  ): Promise<BeforeAgentStartResult | undefined> {
    let result: BeforeAgentStartResult | undefined
    
    for (const hook of this.hooks) {
      const handlers = hook.handlers.get("agent.before_start")
      if (!handlers || handlers.length === 0) continue
      
      for (const handler of handlers) {
        try {
          const event: BeforeAgentStartEvent = { 
            type: "agent.before_start", 
            prompt, 
            images 
          }
          const handlerResult = await handler(event, this.createContext()) as BeforeAgentStartResult | undefined
          if (handlerResult?.message && !result) {
            result = handlerResult
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.emitError({ hookPath: hook.path, event: "agent.before_start", error: message })
        }
      }
    }
    
    return result
  }

  /**
   * Emit tool.execute.before event.
   * If any hook blocks, returns the block result.
   */
  async emitToolExecuteBefore(
    event: ToolExecuteBeforeEvent
  ): Promise<ToolExecuteBeforeResult | undefined> {
    const ctx = this.createContext()

    for (const hook of this.hooks) {
      const handlers = hook.handlers.get("tool.execute.before")
      if (!handlers || handlers.length === 0) continue

      for (const handler of handlers) {
        const result = await handler(event, ctx) as ToolExecuteBeforeResult | undefined
        if (result?.block) {
          return result
        }
        // Allow input mutation
        if (result?.input) {
          event.input = result.input
        }
      }
    }

    return undefined
  }

  /**
   * Emit tool.execute.after event.
   * Returns the last non-undefined result.
   */
  async emitToolExecuteAfter(
    event: ToolExecuteAfterEvent
  ): Promise<ToolExecuteAfterResult | undefined> {
    const ctx = this.createContext()
    let result: ToolExecuteAfterResult | undefined

    for (const hook of this.hooks) {
      const handlers = hook.handlers.get("tool.execute.after")
      if (!handlers || handlers.length === 0) continue

      for (const handler of handlers) {
        try {
          const handlerResult = await handler(event, ctx) as ToolExecuteAfterResult | undefined

          if (handlerResult) {
            result = handlerResult
            // Update event with modifications for chaining
            if (handlerResult.content) event.content = handlerResult.content
            if (handlerResult.details !== undefined) event.details = handlerResult.details
            if (handlerResult.isError !== undefined) event.isError = handlerResult.isError
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.emitError({ hookPath: hook.path, event: event.type, error: message })
        }
      }
    }

    return result
  }
}

/**
 * Create an empty hook runner (when no hooks are loaded).
 */
export function createEmptyRunner(
  cwd: string, 
  configDir: string, 
  sessionManager: ReadonlySessionManager
): HookRunner {
  return new HookRunner([], cwd, configDir, sessionManager)
}
```

**Note**: We removed the timeout mechanism. The plan specifies no timeouts—hooks can take as long as needed (e.g., waiting for user input).

### Checkpoint

At this point you should be able to:
- [ ] Run `bun run typecheck` with no errors
- [ ] See `HookRunner` has new methods like `getRegisteredTools()`, `getCommand()`, etc.

If you get import errors:
- Make sure `ReadonlySessionManager` is exported from session-manager.ts
- Check that all type imports in runner.ts are correct

---

## Milestone 4: Tool Wrapper & Hook Tool Adapter

### Goal
Update tool wrapper to emit on errors and support arg mutation. Create adapter to convert hook-registered tools to AgentTool format.

### Verification
```bash
bun run typecheck
bun test apps/coding-agent
```

### Steps

#### 4.1 Update Tool Wrapper

**What we're doing**: Add error emission and input mutation support.

**File**: `apps/coding-agent/src/hooks/tool-wrapper.ts`

Replace the entire file:

```typescript
/**
 * Tool wrapper - wraps tools with hook callbacks for interception.
 */

import type { AgentTool, AgentToolUpdateCallback, TextContent } from "@yeshwanthyk/ai"
import type { HookRunner } from "./runner.js"

/**
 * Wrap a tool with hook callbacks.
 * - Emits tool.execute.before event (can block or mutate input)
 * - Emits tool.execute.after event (can modify result)
 * - Emits tool.execute.after on errors too
 */
export function wrapToolWithHooks<TDetails>(
  tool: AgentTool<any, TDetails>,
  hookRunner: HookRunner
): AgentTool<any, TDetails> {
  return {
    ...tool,
    execute: async (
      toolCallId: string,
      params: any,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<TDetails>
    ) => {
      // Emit tool.execute.before - hooks can block or mutate input
      let effectiveParams = params
      
      if (hookRunner.hasHandlers("tool.execute.before")) {
        try {
          const beforeResult = await hookRunner.emitToolExecuteBefore({
            type: "tool.execute.before",
            sessionId: hookRunner.getSessionId(),
            toolName: tool.name,
            toolCallId,
            input: params,
          })

          if (beforeResult?.block) {
            const reason = beforeResult.reason || "Tool execution was blocked by a hook"
            throw new Error(reason)
          }
          
          // Allow input mutation
          if (beforeResult?.input) {
            effectiveParams = beforeResult.input
          }
        } catch (err) {
          if (err instanceof Error) throw err
          throw new Error(`Hook failed, blocking execution: ${String(err)}`)
        }
      }

      // Execute the actual tool, handling errors
      try {
        const result = await tool.execute(toolCallId, effectiveParams, signal, onUpdate)

        // Emit tool.execute.after - hooks can modify the result
        if (hookRunner.hasHandlers("tool.execute.after")) {
          const afterResult = await hookRunner.emitToolExecuteAfter({
            type: "tool.execute.after",
            sessionId: hookRunner.getSessionId(),
            toolName: tool.name,
            toolCallId,
            input: effectiveParams,
            content: result.content,
            details: result.details,
            isError: false,
          })

          if (afterResult) {
            return {
              content: afterResult.content ?? result.content,
              details: (afterResult.details ?? result.details) as TDetails,
            }
          }
        }

        return result
      } catch (err) {
        // Emit tool.execute.after on error too
        if (hookRunner.hasHandlers("tool.execute.after")) {
          await hookRunner.emitToolExecuteAfter({
            type: "tool.execute.after",
            sessionId: hookRunner.getSessionId(),
            toolName: tool.name,
            toolCallId,
            input: effectiveParams,
            content: [{ 
              type: "text", 
              text: err instanceof Error ? err.message : String(err) 
            }],
            details: undefined,
            isError: true,
          })
        }
        throw err
      }
    },
  }
}

/**
 * Wrap all tools with hook callbacks.
 */
export function wrapToolsWithHooks(
  tools: AgentTool<any, any>[],
  hookRunner: HookRunner
): AgentTool<any, any>[] {
  return tools.map((tool) => wrapToolWithHooks(tool, hookRunner))
}
```

#### 4.2 Create Hook Tool Adapter

**What we're doing**: Convert `RegisteredTool` (from hooks) to `AgentTool` (for agent).

**File**: `apps/coding-agent/src/hooks/hook-tool-adapter.ts` (new file)

```typescript
/**
 * Adapter to convert hook-registered tools to AgentTool interface.
 */

import type { AgentTool, TextContent } from "@yeshwanthyk/ai"
import type { HookRunner } from "./runner.js"
import type { RegisteredTool, HookEventContext } from "./types.js"

/**
 * Convert a hook-registered tool to an AgentTool.
 */
export function createHookToolAdapter(
  tool: RegisteredTool, 
  getContext: () => HookEventContext
): AgentTool<any, void> {
  return {
    name: tool.name,
    description: tool.description,
    schema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(tool.schema.properties).map(([key, prop]) => [
          key,
          { 
            type: prop.type, 
            description: prop.description, 
            enum: prop.enum,
          },
        ])
      ),
      required: tool.schema.required ?? [],
    },
    async execute(toolCallId, params, signal, onUpdate) {
      try {
        const result = await tool.execute(params, getContext())
        const content: TextContent[] = [{ type: "text", text: result }]
        return { content }
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err)
        const content: TextContent[] = [{ type: "text", text: `Error: ${errorText}` }]
        return { content }
      }
    },
  }
}

/**
 * Get all hook-registered tools as AgentTools.
 */
export function getHookTools(hookRunner: HookRunner): AgentTool<any, void>[] {
  return hookRunner.getRegisteredTools().map((tool) =>
    createHookToolAdapter(tool, () => hookRunner.getContext())
  )
}
```

#### 4.3 Export from Index

**File**: `apps/coding-agent/src/hooks/index.ts`

Add the new export:

```typescript
// Add this line:
export { getHookTools, createHookToolAdapter } from "./hook-tool-adapter.js"
```

### Checkpoint

At this point you should be able to:
- [ ] Run `bun run typecheck` with no errors
- [ ] See `getHookTools` function exported from hooks module

---

## Milestone 5: Integration (TUI & Agent Events)

### Goal
Wire up all the new hook features into the TUI application and agent event handling.

### Verification
```bash
bun run typecheck
bun test apps/coding-agent
bun run marvin  # Manual test - hooks should load
```

This is the most complex milestone. Take it step by step.

### Steps

#### 5.1 Update Agent Events Token Tracking

**What we're doing**: Extract token usage from provider responses and pass to hooks.

**File**: `apps/coding-agent/src/agent-events.ts`

This file is complex. Look for the `turn_end` handling section. You need to:

1. Extract full token usage (not just percent)
2. Pass to `hookRunner.updateTokenUsage()`
3. Update the `turn.end` event emission

Find this section (around line 150-170):

```typescript
// BEFORE:
if (event.type === "turn_end") {
  // Extract usage from message for hook consumption
  const msgUsage = event.message as { usage?: { totalTokens?: number } }
  const contextWindow = ctx.getContextWindow?.() ?? 0
  const currentTokens = msgUsage.usage?.totalTokens ?? 0

  void ctx.hookRunner?.emit({
    type: "turn.end",
    turnIndex,
    message: event.message,
    toolResults: event.toolResults as ToolResultMessage[],
    usage: contextWindow > 0 && currentTokens > 0
      ? { current: currentTokens, max: contextWindow, percent: (currentTokens / contextWindow) * 100 }
      : undefined,
  })
  turnIndex++
}
```

Replace with:

```typescript
// AFTER:
if (event.type === "turn_end") {
  // Extract full token usage from message
  const msgUsage = event.message as { 
    usage?: { 
      totalTokens?: number
      inputTokens?: number
      outputTokens?: number  
      cacheRead?: number
      cacheWrite?: number
    } 
  }
  const contextWindow = ctx.getContextWindow?.() ?? 0
  
  // Build TokenUsage object
  const tokens: TokenUsage = {
    input: msgUsage.usage?.inputTokens ?? 0,
    output: msgUsage.usage?.outputTokens ?? 0,
    cacheRead: msgUsage.usage?.cacheRead,
    cacheWrite: msgUsage.usage?.cacheWrite,
    total: msgUsage.usage?.totalTokens ?? 0,
  }
  
  // Update hook runner with current usage
  ctx.hookRunner?.updateTokenUsage(tokens, contextWindow)

  void ctx.hookRunner?.emit({
    type: "turn.end",
    sessionId: ctx.sessionManager.sessionId,
    turnIndex,
    message: event.message,
    toolResults: event.toolResults as ToolResultMessage[],
    tokens,
    contextLimit: contextWindow,
  })
  turnIndex++
}
```

Add the import at the top:

```typescript
import type { TokenUsage } from "./hooks/types.js"
```

Also update `agent.start` emission:

```typescript
// BEFORE:
void ctx.hookRunner?.emit({ type: "agent.start" })

// AFTER:
void ctx.hookRunner?.emit({ 
  type: "agent.start", 
  sessionId: ctx.sessionManager.sessionId 
})
```

And `agent.end` (in `handleAgentEnd` function):

```typescript
// Find handleAgentEnd and update the emit call
void ctx.hookRunner?.emit({ 
  type: "agent.end", 
  sessionId: ctx.sessionManager.sessionId,
  messages: event.messages,
  totalTokens: ctx.hookRunner?.tokenUsage ?? { input: 0, output: 0, total: 0 },
  contextLimit: ctx.getContextWindow?.() ?? 0,
})
```

#### 5.2 Update TUI App Hook Initialization

**What we're doing**: Initialize hooks with session context, UI context, and wire up tools.

**File**: `apps/coding-agent/src/tui-app.tsx`

This is a large file. Here are the key changes needed:

1. **Update HookRunner construction** (find where `new HookRunner` is called):

```typescript
// BEFORE:
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir)

// AFTER:
const sessionManager = new SessionManager(loaded.configDir)
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir, sessionManager)
```

2. **Update hook send handler setup** (find where `setSendHandler` is called):

```typescript
// BEFORE:
hookRunner.setSendHandler((text) => void handleSubmit(text))

// AFTER:
hookRunner.initialize({
  sendHandler: (text) => void handleSubmit(text),
  sendMessageHandler: (message, triggerTurn) => {
    const hookMsg = createHookMessage(message)
    agent.appendMessage(hookMsg)
    sessionManager.appendMessage(hookMsg)
    if (triggerTurn) void handleSubmit(hookMessageToText(hookMsg))
  },
  appendEntryHandler: (customType, data) => sessionManager.appendEntry(customType, data),
  getSessionId: () => sessionManager.sessionId,
  sessionContext: {
    summarize: async () => {
      // Trigger compact flow
      await handleCompactCommand()
    },
    toast: (title, message, variant = "info") => {
      // Show notification (implement based on your TUI framework)
      console.log(`[${variant}] ${title}: ${message}`)
    },
    getTokenUsage: () => undefined, // Will be set by runner
    getContextLimit: () => undefined,
  },
  hasUI: true,
})
```

3. **Add hook tools to agent** (find where tools array is constructed):

```typescript
// BEFORE:
const tools = wrapToolsWithHooks(allTools, hookRunner)

// AFTER:
import { getHookTools } from "./hooks/hook-tool-adapter.js"

const hookTools = getHookTools(hookRunner)
const allToolsWithHook = [...allTools, ...hookTools]
const tools = wrapToolsWithHooks(allToolsWithHook, hookRunner)
```

4. **Add helper functions** (at the top of the file or in a hooks helper file):

```typescript
import type { HookMessage } from "./hooks/types.js"

function createHookMessage<T>(
  input: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">
): HookMessage<T> {
  return {
    role: "hookMessage",
    customType: input.customType,
    content: input.content,
    display: input.display,
    details: input.details,
    timestamp: Date.now(),
  }
}

function hookMessageToText(message: HookMessage): string {
  if (typeof message.content === "string") return message.content
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}
```

### Checkpoint

At this point you should be able to:
- [ ] Run `bun run typecheck` with no errors
- [ ] Run `bun run marvin` and see hooks load without errors
- [ ] Create a test hook that logs events and see it fire

**Test hook** (`~/.config/marvin/hooks/test-hook.ts`):

```typescript
export default (marvin) => {
  console.log("[test-hook] Loaded!")
  
  marvin.on("agent.start", (event) => {
    console.log("[test-hook] agent.start", event.sessionId)
  })
  
  marvin.on("turn.end", (event) => {
    console.log("[test-hook] turn.end", {
      tokens: event.tokens,
      contextLimit: event.contextLimit,
    })
  })
}
```

---

## Milestone 6: Migrate auto-compact.ts

### Goal
Update the existing auto-compact hook to use the new API.

### Verification
```bash
# Run marvin and use until context is ~90% full
# Should see compaction trigger automatically
```

### Steps

#### 6.1 Update auto-compact.ts

**File**: `~/.config/marvin/hooks/auto-compact.ts`

Replace the entire file:

```typescript
/**
 * Auto-compact hook - triggers compaction when context usage exceeds threshold.
 *
 * Configuration via environment:
 *   MARVIN_COMPACT_THRESHOLD - percentage threshold (default: 90)
 */

import type { HookFactory, TurnEndEvent, HookEventContext } from "marvin/hooks"

export default ((marvin) => {
  const threshold = Number(process.env.MARVIN_COMPACT_THRESHOLD) || 90
  let shouldCompact = false
  let compactPending = false

  // Track usage on turn.end (now has full token info)
  marvin.on("turn.end", (event: TurnEndEvent) => {
    if (!event.tokens || !event.contextLimit) return
    
    const percent = (event.tokens.total / event.contextLimit) * 100
    
    if (percent >= threshold && !compactPending) {
      console.log(`[auto-compact] Context at ${percent.toFixed(1)}% (threshold: ${threshold}%)`)
      shouldCompact = true
    }
  })

  // Trigger compact on agent.end (when idle)
  marvin.on("agent.end", async (_event, ctx: HookEventContext) => {
    if (shouldCompact && !compactPending) {
      compactPending = true
      shouldCompact = false
      
      console.log("[auto-compact] Triggering compaction...")
      ctx.session.toast("Auto-Compact", "Context limit approaching, compacting...", "warning")
      
      await ctx.session.summarize()
    }
  })

  // Reset after compaction completes
  marvin.on("session.clear", () => {
    shouldCompact = false
    compactPending = false
  })
}) satisfies HookFactory
```

**Note**: The type imports from `"marvin/hooks"` assume you've set up a path alias. If not, use a relative path or the full package path.

---

## Testing Strategy

### Unit Tests to Write

**File**: `apps/coding-agent/tests/hooks.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "bun:test"
import { HookRunner } from "../src/hooks/runner.js"
import type { LoadedHook } from "../src/hooks/loader.js"
import type { SessionManager } from "../src/session-manager.js"

// Mock session manager
const mockSessionManager = {
  sessionId: "test-session",
  sessionPath: "/tmp/test.jsonl",
  getCompactionState: () => undefined,
  getEntries: () => [],
  listSessions: () => [],
  loadSession: () => null,
  loadLatest: () => null,
}

describe("HookRunner", () => {
  describe("chat.message", () => {
    it("allows hooks to mutate output parts", async () => {
      // Create a mock hook that prepends a part
      const handlers = new Map()
      handlers.set("chat.message", [
        (event: any) => {
          event.output.parts.unshift({ type: "text", text: "Injected!" })
        }
      ])
      
      const hook: LoadedHook = {
        path: "/test/hook.ts",
        handlers,
        messageRenderers: new Map(),
        commands: new Map(),
        tools: new Map(),
        setSendHandler: () => {},
        setSendMessageHandler: () => {},
        setAppendEntryHandler: () => {},
      }
      
      const runner = new HookRunner([hook], "/tmp", "/tmp/.config", mockSessionManager)
      
      const output = { parts: [{ type: "text", text: "Original" }] }
      await runner.emitChatMessage({ sessionId: "test", text: "hello" }, output)
      
      expect(output.parts).toHaveLength(2)
      expect(output.parts[0].text).toBe("Injected!")
    })
  })

  describe("turn.end", () => {
    it("includes token usage", async () => {
      const handlers = new Map()
      let receivedEvent: any = null
      handlers.set("turn.end", [(event: any) => { receivedEvent = event }])
      
      const hook: LoadedHook = {
        path: "/test/hook.ts",
        handlers,
        messageRenderers: new Map(),
        commands: new Map(),
        tools: new Map(),
        setSendHandler: () => {},
        setSendMessageHandler: () => {},
        setAppendEntryHandler: () => {},
      }
      
      const runner = new HookRunner([hook], "/tmp", "/tmp/.config", mockSessionManager)
      
      await runner.emit({
        type: "turn.end",
        sessionId: "test",
        turnIndex: 0,
        message: {} as any,
        toolResults: [],
        tokens: { input: 100, output: 50, total: 150 },
        contextLimit: 200000,
      })
      
      expect(receivedEvent.tokens.total).toBe(150)
      expect(receivedEvent.contextLimit).toBe(200000)
    })
  })

  describe("registerTool", () => {
    it("makes tool available via getRegisteredTools", async () => {
      const tools = new Map()
      tools.set("test-tool", {
        name: "test-tool",
        description: "A test tool",
        schema: { type: "object", properties: {} },
        execute: async () => "result",
      })
      
      const hook: LoadedHook = {
        path: "/test/hook.ts",
        handlers: new Map(),
        messageRenderers: new Map(),
        commands: new Map(),
        tools,
        setSendHandler: () => {},
        setSendMessageHandler: () => {},
        setAppendEntryHandler: () => {},
      }
      
      const runner = new HookRunner([hook], "/tmp", "/tmp/.config", mockSessionManager)
      
      const registered = runner.getRegisteredTools()
      expect(registered).toHaveLength(1)
      expect(registered[0].name).toBe("test-tool")
    })
  })
})
```

### Manual Testing Checklist

1. [ ] Create a test hook that logs all events
2. [ ] Verify `chat.message` fires before agent processing
3. [ ] Verify `turn.end` includes token usage
4. [ ] Verify hook-registered tool appears in agent's available tools
5. [ ] Verify `ctx.session.summarize()` triggers compaction
6. [ ] Verify migrated auto-compact.ts works

---

## Quick Reference

### Commands You'll Use

```bash
bun run typecheck          # Check types across all packages
bun run test               # Run all tests
bun test apps/coding-agent # Run tests for coding-agent only
bun run marvin             # Run the TUI for manual testing
```

### Files You'll Touch (in order)

1. `apps/coding-agent/src/hooks/types.ts` - Types (Milestone 1)
2. `apps/coding-agent/src/hooks/loader.ts` - Loader (Milestone 2)
3. `apps/coding-agent/src/session-manager.ts` - Session (Milestone 2)
4. `apps/coding-agent/src/hooks/runner.ts` - Runner (Milestone 3)
5. `apps/coding-agent/src/hooks/tool-wrapper.ts` - Tool wrapper (Milestone 4)
6. `apps/coding-agent/src/hooks/hook-tool-adapter.ts` - New file (Milestone 4)
7. `apps/coding-agent/src/agent-events.ts` - Events (Milestone 5)
8. `apps/coding-agent/src/tui-app.tsx` - TUI (Milestone 5)
9. `~/.config/marvin/hooks/auto-compact.ts` - Migration (Milestone 6)

### Useful References

- Current hook implementation: `apps/coding-agent/src/hooks/`
- Session manager: `apps/coding-agent/src/session-manager.ts`
- Agent transport types: `packages/agent/src/transports/types.ts`
- OpenCode supermemory plugin: `/tmp/opencode-supermemory/src/index.ts`

---

## Troubleshooting

### "Cannot find module" errors
- Check that all new files are created in the right location
- Ensure exports are added to `index.ts` files
- Run `bun run typecheck` to see detailed error locations

### Hooks not loading
- Check `~/.config/marvin/hooks/` directory exists
- Files must end with `.ts`
- Hook must export a default function
- Check for syntax errors in hook files

### Token tracking not working
- Verify `updateTokenUsage` is called in agent-events.ts
- Check that provider is returning usage in expected format
- Add debug logging to trace the flow

### Tools not appearing
- Check `getHookTools` is called before creating Agent
- Verify tool is registered with `marvin.registerTool()`
- Check tool schema is valid JSON Schema subset

---

## Summary

You've now implemented a complete hook plugin API that supports:

- ✅ Tool registration (`registerTool`)
- ✅ Token usage tracking (`turn.end.tokens`, `ctx.session.getTokenUsage()`)
- ✅ Session operations (`ctx.session.summarize()`, `ctx.session.toast()`)
- ✅ Message injection (`chat.message`, `sendMessage`)
- ✅ Custom persistence (`appendEntry`)
- ✅ Command registration (`registerCommand`)
- ✅ Custom renderers (`registerMessageRenderer`)

This enables OpenCode-style plugins like supermemory to work with Marvin!

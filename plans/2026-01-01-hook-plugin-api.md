# Hook Plugin API Expansion Implementation Plan

## Plan Metadata
- Created: 2026-01-01
- Ticket: none
- Status: draft
- Owner: yesh
- Assumptions:
  - Hooks remain loaded from `~/.config/marvin/hooks/` only (no npm/plugin loader changes).
  - Hook UI is TUI-only; headless/ACP get no-op UI implementations.
  - Hook-based auth/routing only mutates existing model properties (baseUrl/headers/apiKey), not the model registry.

## Progress Tracking
- [ ] Phase 1: Hook Core + Persistence Foundations
- [ ] Phase 2: Runtime + Transport Integration
- [ ] Phase 3: TUI UX, Commands, Renderers, Tests, and Local Hook Setup

## Overview
Expand Marvin’s hook system to support OpenCode-style plugins (chat transforms, auth/routing, session hooks) and pi-mono-style hook UX (persisted hook messages, UI prompts, hook commands). This enables supermemory injection and Gemini/Cursor auth plugins to be implemented as plain hooks in `~/.config/marvin/hooks/`.

## Current State
Marvin hooks currently support basic lifecycle events and tool interception, but do not provide pre-LLM message transforms, system/params mutation, auth/routing, or hook-specific persistence/UI.

### Key Discoveries
- Hook context is minimal (no session or UI): `apps/coding-agent/src/hooks/types.ts:28-36`
  ```ts
  export interface HookEventContext {
    exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>
    cwd: string
    configDir: string
  }
  ```
- Hook API only supports `on()` + `send()`: `apps/coding-agent/src/hooks/types.ts:175-191`
  ```ts
  export interface HookAPI {
    on<T extends HookEventType>(event: T, handler: HookHandler<HookEventMap[T], HookResultMap[T]>): void
    send(text: string): void
  }
  ```
- Session persistence only stores message entries (no hook-only state): `apps/coding-agent/src/session-manager.ts:12-41`
  ```ts
  export interface SessionMessageEntry {
    type: 'message';
    timestamp: number;
    message: AppMessage;
  }
  export type SessionEntry = SessionMetadata | SessionMessageEntry;
  ```

## Desired End State
- Hooks can mutate inbound user parts (`chat.message`), full context (`chat.messages.transform`), system prompt (`chat.system.transform`), and stream options (`chat.params`).
- Hooks can supply auth (`auth.get`) and routing overrides (`model.resolve`) per request.
- Hooks can inject persisted messages (`sendMessage`) and persist non-LLM state (`appendEntry`), with optional custom renderers and slash commands.
- Hooks can register agent tools via `registerTool()` that are available alongside built-in tools.
- Hooks can prompt users via `ctx.ui` in TUI mode; headless/ACP provide no-op UI.
- Hooks receive token usage stats in `turn.end` and `agent.end` events for compaction triggers.
- Hooks can trigger session operations via `ctx.session` facade (summarize, toast notifications).
- Tool hooks fire on errors and allow input mutation before execution.
- Session lifecycle hooks include shutdown and compaction extension points.
- Supermemory and Gemini auth hooks are installable as local hook files under `~/.config/marvin/hooks/`.

### Verification
- `bun run typecheck`
- `bun run test`
- Manual: run TUI, confirm `chat.message` injects memory; confirm auth hook overrides API key/header for Gemini.

## Out of Scope
- npm plugin loader, project-level plugin discovery, or Bun install caching.
- Full OpenCode event-bus parity (message.updated, file.edited, etc.).
- Non-TUI UI integration (web/desktop).

## Breaking Changes
- Hook API is extended (additive). Existing hooks remain compatible.
- Session log format adds new `custom` entries (backward-compatible, ignored by old readers).
- Tool hook behavior: `tool.execute.after` now fires on tool errors (additional callbacks).

## Dependency and Configuration Changes

### Additions
None.

### Updates
None.

### Removals
None.

### Configuration Changes
None (hooks remain in `~/.config/marvin/hooks/`).

## Error Handling Strategy
- Hook errors should be logged and not crash the agent (except tool.before which blocks on error).
- `chat.*`/`auth.get`/`model.resolve` hooks: on error, log and fall back to original config.
- `tool.execute.before`: if hook throws or returns block, tool execution fails with hook’s reason.
- `tool.execute.after`: errors in hook handlers do not affect tool results; result stays unchanged.

## Implementation Approach
- Extend hook types and loader to support new hook APIs, persistent entries, commands, and renderers.
- Add a shared message transformer that handles hook messages and `chat.messages.transform`.
- Wrap transports to apply `chat.system.transform`, `chat.params`, `auth.get`, and `model.resolve` before each request.
- Update TUI/Headless/ACP entrypoints to run `chat.message` and `before_agent_start` pre-prompt.
- Add TUI UI primitives for hook prompts and integrate hook commands/renderers into the UI.

## Phase Dependencies and Parallelization
- Dependencies: Phase 2 depends on Phase 1; Phase 3 depends on Phase 1 + Phase 2.
- Parallelizable: Tests/doc updates (Phase 3) can start after Phase 2 is stable.
- Suggested @agents:
  - oracle: transport/config integration review
  - review-deep: hook types + loader/runner change review

---

## Phase 1: Hook Core + Persistence Foundations

### Overview
Add hook API surface (events, UI context, commands, renderers, persistence), update loader/runner, and extend session storage for hook-only entries.

### Prerequisites
- [ ] Open Questions resolved

### Change Checklist
- [ ] Extend hook event/types for `chat.*`, `auth.get`, `model.resolve`, `before_agent_start`, and session hooks.
- [ ] Add hook UI context, sendMessage/appendEntry APIs, command/renderer registration.
- [ ] Add `registerTool()` API for hook-contributed agent tools.
- [ ] Add token usage stats to `turn.end` and `agent.end` events.
- [ ] Add `ctx.session` facade for session operations (summarize, toast).
- [ ] Extend session storage to include custom entries and hook messages.
- [ ] Update hook loader and runner to support new APIs and remove timeouts.
- [ ] Ensure tool hooks emit after on error and allow input mutation.

### Changes

#### 1. Hook Context + New Event Types
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: lines 28-36

**Before**:
```ts
export interface HookEventContext {
	exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>
	cwd: string
	configDir: string
}
```

**After**:
```ts
export interface HookEventContext {
	exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>
	cwd: string
	configDir: string
	sessionId: string | null
	sessionManager: ReadonlySessionManager
	ui: HookUIContext
	hasUI: boolean
	session: HookSessionContext
}
```

**Why**: Hooks need session-scoped state, UI prompts, session operations, and consistent context.

#### 2. Hook UI + Message + Command Types
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: new section before Events

**Add**:
```ts
export interface HookUIContext {
	select(title: string, options: string[]): Promise<string | undefined>
	confirm(title: string, message: string): Promise<boolean>
	input(title: string, placeholder?: string): Promise<string | undefined>
	notify(message: string, type?: "info" | "warning" | "error"): void
	custom<T>(factory: (done: (result: T) => void) => JSX.Element): Promise<T | undefined>
	setEditorText(text: string): void
	getEditorText(): string
}

export type MessagePart = TextContent | ImageContent

export interface HookMessage<T = unknown> {
	role: "hookMessage"
	customType: string
	content: string | MessagePart[]
	display: boolean
	details?: T
	timestamp: number
}

export interface RegisteredCommand {
	name: string
	description?: string
	handler: (args: string, ctx: HookEventContext) => Promise<void>
}

export type HookMessageRenderer<T = unknown> = (
	message: HookMessage<T>,
	options: { expanded: boolean },
	theme: Theme
) => JSX.Element | undefined
```

**Why**: Matches pi-mono UX capabilities and enables hook-driven UI/commands/renderers.

#### 2b. Token Usage + Session Facade Types
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: after HookUIContext

**Add**:
```ts
export interface TokenUsage {
	input: number
	output: number
	cacheRead?: number
	cacheWrite?: number
	total: number
}

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

**Why**: Enables supermemory-style compaction triggers and UI notifications.

#### 2c. Hook Tool Definition
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: after RegisteredCommand

**Add**:
```ts
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

export interface RegisteredTool {
	name: string
	description: string
	schema: HookToolSchema
	execute: (args: Record<string, unknown>, ctx: HookEventContext) => Promise<string>
}
```

**Why**: Allows hooks to contribute tools (e.g., supermemory add/search/profile).

#### 3. Import Updates (hooks/types.ts)
**File**: `apps/coding-agent/src/hooks/types.ts`

**Before**:
```ts
import type { AppMessage, ThinkingLevel } from "@marvin-agents/agent-core"
import type { AgentTool, ImageContent, TextContent, ToolResultMessage } from "@marvin-agents/ai"
```

**After**:
```ts
import type { AppMessage, ThinkingLevel } from "@marvin-agents/agent-core"
import type { Api, ImageContent, Message, Model, SimpleStreamOptions, TextContent, ToolResultMessage } from "@marvin-agents/ai"
import type { Theme } from "@marvin-agents/open-tui"
import type { JSX } from "solid-js"
import type { ReadonlySessionManager } from "../session-manager.js"
```

**Why**: Adds types required for new hook APIs.

#### 4. Hook Event Additions (chat/auth/session/before agent)
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: after existing ToolExecute events

**Add**:
```ts
export interface ChatMessageEvent {
	type: "chat.message"
	input: { sessionId: string | null; text: string }
	output: { parts: MessagePart[] }
}

export interface ChatMessagesTransformEvent {
	type: "chat.messages.transform"
	messages: Message[]
}

export interface ChatSystemTransformEvent {
	type: "chat.system.transform"
	input: { sessionId: string | null; systemPrompt: string }
	output: { systemPrompt: string }
}

export interface ChatParamsEvent {
	type: "chat.params"
	input: { sessionId: string | null }
	output: { streamOptions: SimpleStreamOptions }
}

export interface AuthGetEvent {
	type: "auth.get"
	input: { sessionId: string | null; provider: string; modelId: string }
	output: { apiKey?: string; headers?: Record<string, string>; baseUrl?: string }
}

export interface ModelResolveEvent {
	type: "model.resolve"
	input: { sessionId: string | null; model: Model<Api> }
	output: { model: Model<Api> }
}

export interface BeforeAgentStartEvent {
	type: "agent.before_start"
	prompt: string
	images?: ImageContent[]
}

export interface BeforeAgentStartResult {
	message?: Pick<HookMessage, "customType" | "content" | "display" | "details">
}

export interface SessionBeforeCompactEvent {
	type: "session.before_compact"
	input: { sessionId: string | null }
	output: { cancel?: boolean; prompt?: string; context?: string[] }
}

export interface SessionCompactEvent {
	type: "session.compact"
	sessionId: string | null
	summary: string
}

export interface SessionShutdownEvent {
	type: "session.shutdown"
	sessionId: string | null
}
```

**Why**: Enables OpenCode-style plugin hooks and pi-mono-like pre-agent injection.

#### 4b. Add sessionId to lifecycle/tool events
**File**: `apps/coding-agent/src/hooks/types.ts`

**Before**:
```ts
export interface AgentStartEvent {
	type: "agent.start"
}

export interface TurnStartEvent {
	type: "turn.start"
	turnIndex: number
}

export interface ToolExecuteBeforeEvent {
	type: "tool.execute.before"
	toolName: string
	toolCallId: string
	input: Record<string, unknown>
}
```

**After**:
```ts
export interface AgentStartEvent {
	type: "agent.start"
	sessionId: string | null
}

export interface TurnStartEvent {
	type: "turn.start"
	sessionId: string | null
	turnIndex: number
}

export interface ToolExecuteBeforeEvent {
	type: "tool.execute.before"
	sessionId: string | null
	toolName: string
	toolCallId: string
	input: Record<string, unknown>
}
```

**Why**: Enables session-scoped plugin state and routing decisions.

**Also update**: `AgentEndEvent`, `TurnEndEvent`, and `ToolExecuteAfterEvent` to include `sessionId: string | null`.

#### 4c. Add token usage to turn/agent end events
**File**: `apps/coding-agent/src/hooks/types.ts`

**Before**:
```ts
export interface TurnEndEvent {
	type: "turn.end"
	turnIndex: number
}

export interface AgentEndEvent {
	type: "agent.end"
}
```

**After**:
```ts
export interface TurnEndEvent {
	type: "turn.end"
	sessionId: string | null
	turnIndex: number
	tokens: TokenUsage
	contextLimit: number
}

export interface AgentEndEvent {
	type: "agent.end"
	sessionId: string | null
	totalTokens: TokenUsage
	contextLimit: number
}
```

**Why**: Enables hooks to implement token-based compaction triggers (supermemory checks usage ratio).

#### 5. HookEventMap + HookResultMap Updates
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: lines 120-173

**Before**:
```ts
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
```

**After**:
```ts
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

**Why**: Registers new hook types with consistent typing.

#### 6. HookEvent Union Update
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: lines 109-118

**Before**:
```ts
export type HookEvent =
	| AppStartEvent
	| SessionEvent
	| AgentStartEvent
	| AgentEndEvent
	| TurnStartEvent
	| TurnEndEvent
	| ToolExecuteBeforeEvent
	| ToolExecuteAfterEvent
```

**After**:
```ts
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

**Why**: Ensures emit() supports new hook events.

#### 7. HookAPI Additions
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: lines 175-191

**Before**:
```ts
export interface HookAPI {
	on<T extends HookEventType>(
		event: T,
		handler: HookHandler<HookEventMap[T], HookResultMap[T]>
	): void
	
	send(text: string): void
}
```

**After**:
```ts
export interface HookAPI {
	on<T extends HookEventType>(
		event: T,
		handler: HookHandler<HookEventMap[T], HookResultMap[T]>
	): void

	send(text: string): void

	sendMessage<T = unknown>(
		message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
		triggerTurn?: boolean,
	): void

	appendEntry<T = unknown>(customType: string, data?: T): void

	registerMessageRenderer<T = unknown>(customType: string, renderer: HookMessageRenderer<T>): void

	registerCommand(name: string, options: { description?: string; handler: RegisteredCommand["handler"] }): void

	registerTool(tool: RegisteredTool): void
}
```

**Why**: Adds pi-mono style persistence + UI integration points + tool contribution for plugins.

#### 8. Tool Before Result Mutation
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: lines 90-106

**Before**:
```ts
export interface ToolExecuteBeforeResult {
	block?: boolean
	reason?: string
}
```

**After**:
```ts
export interface ToolExecuteBeforeResult {
	block?: boolean
	reason?: string
	input?: Record<string, unknown>
}
```

**Why**: Allows hooks to sanitize/modify tool arguments.

#### 9. Tool Execute After Result Typing
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: lines 98-106

**Before**:
```ts
export interface ToolExecuteAfterEvent {
	type: "tool.execute.after"
	toolName: string
	toolCallId: string
	input: Record<string, unknown>
	content: (TextContent | ImageContent)[]
	details: unknown
	isError: boolean
}

export interface ToolExecuteAfterResult {
	content?: (TextContent | ImageContent)[]
	details?: unknown
	isError?: boolean
}
```

**After**:
```ts
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

export interface ToolExecuteAfterResult<TDetails = unknown> {
	content?: (TextContent | ImageContent)[]
	details?: TDetails
	isError?: boolean
}
```

**Why**: Avoids type assertions when hooks override tool results.

#### 10. Hook Loader Extensions
**File**: `apps/coding-agent/src/hooks/loader.ts`
**Location**: imports + lines 19-27, 39-63

**Before**:
```ts
import type { HookAPI, HookEventType, HookFactory } from "./types.js"

export interface LoadedHook {
	path: string
	handlers: Map<HookEventType, HandlerFn[]>
	setSendHandler: (handler: SendHandler) => void
}

function createHookAPI(handlers: Map<HookEventType, HandlerFn[]>): {
	api: HookAPI
	setSendHandler: (handler: SendHandler) => void
} {
	let sendHandler: SendHandler = () => {}
	const api: HookAPI = {
		on(event, handler): void {
			const list = handlers.get(event) ?? []
			list.push(handler as HandlerFn)
			handlers.set(event, list)
		},
		send(text: string): void {
			sendHandler(text)
		},
	} as HookAPI
	return { api, setSendHandler: (handler: SendHandler) => { sendHandler = handler } }
}
```

**After**:
```ts
import type { HookAPI, HookEvent, HookEventType, HookFactory, HookHandler, HookMessage, HookMessageRenderer, RegisteredCommand, RegisteredTool } from "./types.js"

type HandlerFn = HookHandler<HookEvent, unknown>

export type SendMessageHandler = <T = unknown>(
	message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
	triggerTurn?: boolean,
) => void

export type AppendEntryHandler = <T = unknown>(customType: string, data?: T) => void

export interface LoadedHook {
	path: string
	handlers: Map<HookEventType, HandlerFn[]>
	messageRenderers: Map<string, HookMessageRenderer>
	commands: Map<string, RegisteredCommand>
	tools: Map<string, RegisteredTool>
	setSendHandler: (handler: SendHandler) => void
	setSendMessageHandler: (handler: SendMessageHandler) => void
	setAppendEntryHandler: (handler: AppendEntryHandler) => void
}

function createHookAPI(handlers: Map<HookEventType, HandlerFn[]>): {
	api: HookAPI
	messageRenderers: Map<string, HookMessageRenderer>
	commands: Map<string, RegisteredCommand>
	tools: Map<string, RegisteredTool>
	setSendHandler: (handler: SendHandler) => void
	setSendMessageHandler: (handler: SendMessageHandler) => void
	setAppendEntryHandler: (handler: AppendEntryHandler) => void
} {
	let sendHandler: SendHandler = () => {}
	let sendMessageHandler: SendMessageHandler = () => {}
	let appendEntryHandler: AppendEntryHandler = () => {}
	const messageRenderers = new Map<string, HookMessageRenderer>()
	const commands = new Map<string, RegisteredCommand>()
	const tools = new Map<string, RegisteredTool>()
	const api: HookAPI = {
		on(event, handler): void {
			const list = handlers.get(event) ?? []
			list.push(handler)
			handlers.set(event, list)
		},
		send(text: string): void { sendHandler(text) },
		sendMessage(message, triggerTurn): void { sendMessageHandler(message, triggerTurn) },
		appendEntry(customType, data): void { appendEntryHandler(customType, data) },
		registerMessageRenderer(customType, renderer): void { messageRenderers.set(customType, renderer) },
		registerCommand(name, options): void { commands.set(name, { name, ...options }) },
		registerTool(tool): void { tools.set(tool.name, tool) },
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

**Why**: Allows hooks to register UI renderers, commands, and persistent entries.

#### 11. Import Updates (hooks/runner.ts)
**File**: `apps/coding-agent/src/hooks/runner.ts`

**Before**:
```ts
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
```

**After**:
```ts
import type { AppendEntryHandler, LoadedHook, SendHandler, SendMessageHandler } from "./loader.js"
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
	HookUIContext,
	ModelResolveEvent,
	RegisteredCommand,
	SessionBeforeCompactEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	ToolExecuteBeforeEvent,
	ToolExecuteBeforeResult,
	ToolExecuteAfterEvent,
	ToolExecuteAfterResult,
} from "./types.js"
import type { AgentRunConfig } from "@marvin-agents/agent-core"
import type { ImageContent, Message } from "@marvin-agents/ai"
import type { ReadonlySessionManager } from "../session-manager.js"
```

**Why**: New hook APIs require access to chat/auth/session types and session context.

#### 12. Hook Runner Initialization + No Timeouts
**File**: `apps/coding-agent/src/hooks/runner.ts`
**Location**: lines 20-98, 136-166

**Before**:
```ts
const DEFAULT_TIMEOUT = 5000

export class HookRunner {
	private hooks: LoadedHook[]
	private cwd: string
	private configDir: string
	private timeout: number
	private errorListeners = new Set<HookErrorListener>()

	constructor(hooks: LoadedHook[], cwd: string, configDir: string, timeout = DEFAULT_TIMEOUT) {
		this.hooks = hooks
		this.cwd = cwd
		this.configDir = configDir
		this.timeout = timeout
	}

	setSendHandler(handler: SendHandler): void {
		for (const hook of this.hooks) hook.setSendHandler(handler)
	}

	async emit(event: HookEvent): Promise<void> {
		const ctx = this.createContext()
		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(event.type as HookEventType)
			if (!handlers || handlers.length === 0) continue
			for (const handler of handlers) {
				const timeout = createTimeout(this.timeout)
				await Promise.race([handler(event, ctx), timeout.promise])
				timeout.clear()
			}
		}
	}
```

**After**:
```ts
const noOpUIContext: HookUIContext = {
	select: async () => undefined,
	confirm: async () => false,
	input: async () => undefined,
	notify: () => {},
	custom: async () => undefined,
	setEditorText: () => {},
	getEditorText: () => "",
}

const noOpSessionContext: HookSessionContext = {
	summarize: async () => {},
	toast: () => {},
	getTokenUsage: () => undefined,
	getContextLimit: () => undefined,
}

export class HookRunner {
	private hooks: LoadedHook[]
	private cwd: string
	private configDir: string
	private sessionManager: ReadonlySessionManager
	private uiContext: HookUIContext
	private sessionContext: HookSessionContext
	private hasUI: boolean
	private errorListeners = new Set<HookErrorListener>()
	private sessionIdProvider: () => string | null
	private tokenUsage: TokenUsage | undefined
	private contextLimit: number | undefined

	constructor(hooks: LoadedHook[], cwd: string, configDir: string, sessionManager: ReadonlySessionManager) {
		this.hooks = hooks
		this.cwd = cwd
		this.configDir = configDir
		this.sessionManager = sessionManager
		this.uiContext = noOpUIContext
		this.sessionContext = noOpSessionContext
		this.hasUI = false
		this.sessionIdProvider = () => null
	}

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

	updateTokenUsage(tokens: TokenUsage, contextLimit: number): void {
		this.tokenUsage = tokens
		this.contextLimit = contextLimit
	}

	async emit(event: HookEvent): Promise<void> {
		const ctx = this.createContext()
		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(event.type)
			if (!handlers || handlers.length === 0) continue
			for (const handler of handlers) {
				try { await handler(event, ctx) }
				catch (err) { this.emitError({ hookPath: hook.path, event: event.type, error: String(err) }) }
			}
		}
	}
```

**Why**: Aligns with pi-mono (no timeouts, initialization with UI + persistence handlers).

#### 12a. createEmptyRunner Signature Update
**File**: `apps/coding-agent/src/hooks/runner.ts`

**Before**:
```ts
export function createEmptyRunner(cwd: string, configDir: string): HookRunner {
	return new HookRunner([], cwd, configDir)
}
```

**After**:
```ts
export function createEmptyRunner(cwd: string, configDir: string, sessionManager: ReadonlySessionManager): HookRunner {
	return new HookRunner([], cwd, configDir, sessionManager)
}
```

**Why**: Keeps helper consistent with new HookRunner constructor.

#### 13. HookRunner Context Updates
**File**: `apps/coding-agent/src/hooks/runner.ts`
**Location**: `createContext`

**Before**:
```ts
private createContext(): HookEventContext {
	return {
		exec: (command: string, args: string[], options?: ExecOptions) => exec(command, args, this.cwd, options),
		cwd: this.cwd,
		configDir: this.configDir,
	}
}
```

**After**:
```ts
private createContext(): HookEventContext {
	return {
		exec: (command: string, args: string[], options?: ExecOptions) => exec(command, args, this.cwd, options),
		cwd: this.cwd,
		configDir: this.configDir,
		sessionId: this.sessionIdProvider(),
		sessionManager: this.sessionManager,
		ui: this.uiContext,
		hasUI: this.hasUI,
		session: {
			...this.sessionContext,
			getTokenUsage: () => this.tokenUsage,
			getContextLimit: () => this.contextLimit,
		},
	}
}
```

**Why**: Gives hooks access to session state, UI, and session operations (summarize, toast, token tracking).

#### 14. HookRunner Transform + Accessors
**File**: `apps/coding-agent/src/hooks/runner.ts`
**Location**: new methods after `emit`

**Add**:
```ts
getSessionId(): string | null {
	return this.sessionIdProvider()
}

getContext(): HookEventContext {
	return this.createContext()
}

getMessageRenderer(customType: string): HookMessageRenderer | undefined {
	for (const hook of this.hooks) {
		const renderer = hook.messageRenderers.get(customType)
		if (renderer) return renderer
	}
	return undefined
}

getRegisteredCommands(): RegisteredCommand[] {
	const commands: RegisteredCommand[] = []
	for (const hook of this.hooks) {
		for (const cmd of hook.commands.values()) commands.push(cmd)
	}
	return commands
}

getCommand(name: string): RegisteredCommand | undefined {
	for (const hook of this.hooks) {
		const cmd = hook.commands.get(name)
		if (cmd) return cmd
	}
	return undefined
}

getRegisteredTools(): RegisteredTool[] {
	const tools: RegisteredTool[] = []
	for (const hook of this.hooks) {
		for (const tool of hook.tools.values()) tools.push(tool)
	}
	return tools
}

getTool(name: string): RegisteredTool | undefined {
	for (const hook of this.hooks) {
		const tool = hook.tools.get(name)
		if (tool) return tool
	}
	return undefined
}

async emitContext(messages: Message[]): Promise<Message[]> {
	let current = messages.map((msg) => structuredClone(msg))
	for (const hook of this.hooks) {
		const handlers = hook.handlers.get("chat.messages.transform")
		if (!handlers || handlers.length === 0) continue
		for (const handler of handlers) {
			const event: ChatMessagesTransformEvent = { type: "chat.messages.transform", messages: current }
			await handler(event, this.createContext())
			current = event.messages
		}
	}
	return current
}

async emitChatMessage(input: ChatMessageEvent["input"], output: ChatMessageEvent["output"]): Promise<void> {
	await this.emit({ type: "chat.message", input, output })
}

async emitBeforeAgentStart(prompt: string, images?: ImageContent[]): Promise<BeforeAgentStartResult | undefined> {
	let result: BeforeAgentStartResult | undefined
	for (const hook of this.hooks) {
		const handlers = hook.handlers.get("agent.before_start")
		if (!handlers || handlers.length === 0) continue
		for (const handler of handlers) {
			const event: BeforeAgentStartEvent = { type: "agent.before_start", prompt, images }
			const handlerResult = await handler(event, this.createContext())
			if (handlerResult && handlerResult.message && !result) result = handlerResult
		}
	}
	return result
}

async applyRunConfig(cfg: AgentRunConfig, sessionId: string | null): Promise<AgentRunConfig> {
	const system: ChatSystemTransformEvent["output"] = { systemPrompt: cfg.systemPrompt }
	await this.emit({ type: "chat.system.transform", input: { sessionId, systemPrompt: cfg.systemPrompt }, output: system })

	const params: ChatParamsEvent["output"] = { streamOptions: cfg.streamOptions ?? {} }
	await this.emit({ type: "chat.params", input: { sessionId }, output: params })

	const modelOutput: ModelResolveEvent["output"] = { model: cfg.model }
	await this.emit({ type: "model.resolve", input: { sessionId, model: cfg.model }, output: modelOutput })

	const auth: AuthGetEvent["output"] = {}
	await this.emit({ type: "auth.get", input: { sessionId, provider: modelOutput.model.provider, modelId: modelOutput.model.id }, output: auth })

	return {
		...cfg,
		systemPrompt: system.systemPrompt,
		streamOptions: params.streamOptions,
		model: modelOutput.model,
		apiKey: auth.apiKey ?? cfg.apiKey,
		headers: auth.headers ?? cfg.headers,
		baseUrl: auth.baseUrl ?? cfg.baseUrl,
	}
}
```

**Why**: Centralizes hook-driven message and config transforms for all entrypoints.

#### 15. Tool Hook Error Emission + Arg Mutation
**File**: `apps/coding-agent/src/hooks/tool-wrapper.ts`
**Location**: lines 15-61

**Before**:
```ts
const result = await tool.execute(toolCallId, params, signal, onUpdate)

if (hookRunner.hasHandlers("tool.execute.after")) {
	const afterResult = await hookRunner.emitToolExecuteAfter({
		type: "tool.execute.after",
		toolName: tool.name,
		toolCallId,
		input: params,
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
```

**After**:
```ts
const beforeResult = await hookRunner.emitToolExecuteBefore({
	type: "tool.execute.before",
	sessionId: hookRunner.getSessionId(),
	toolName: tool.name,
	toolCallId,
	input: params,
})
const effectiveParams = beforeResult?.input ?? params

try {
	const result = await tool.execute(toolCallId, effectiveParams, signal, onUpdate)
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
		return { content: afterResult.content ?? result.content, details: afterResult.details ?? result.details }
	}
	return result
} catch (err) {
	await hookRunner.emitToolExecuteAfter({
		type: "tool.execute.after",
		sessionId: hookRunner.getSessionId(),
		toolName: tool.name,
		toolCallId,
		input: effectiveParams,
		content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
		details: undefined,
		isError: true,
	})
	throw err
}
```

**Why**: Matches pi-mono: arg mutation and tool_result on error.

#### 16. Session Custom Entries
**File**: `apps/coding-agent/src/session-manager.ts`
**Location**: lines 21-41

**Before**:
```ts
export interface SessionMessageEntry {
	type: 'message';
	timestamp: number;
	message: AppMessage;
}

export type SessionEntry = SessionMetadata | SessionMessageEntry;
```

**After**:
```ts
export interface SessionMessageEntry {
	type: 'message';
	timestamp: number;
	message: AppMessage;
}

export interface SessionCustomEntry<T = unknown> {
	type: 'custom';
	timestamp: number;
	customType: string;
	data?: T;
}

export type SessionEntry = SessionMetadata | SessionMessageEntry | SessionCustomEntry;
```

**Why**: Allows hooks to persist non-LLM state (`appendEntry`).

#### 17. Session Custom Entry Methods + Readonly Interface
**File**: `apps/coding-agent/src/session-manager.ts`
**Location**: after `appendMessage`

**Add**:
```ts
export interface ReadonlySessionManager {
	sessionId: string | null
	sessionPath: string | null
	getCompactionState(): CompactionState | undefined
	getEntries(): SessionEntry[]
	listSessions(): SessionInfo[]
	loadSession(sessionPath: string): LoadedSession | null
	loadLatest(): LoadedSession | null
}

appendEntry<T = unknown>(customType: string, data?: T): void {
	if (!this.currentSessionPath) return
	const entry: SessionCustomEntry<T> = { type: 'custom', timestamp: Date.now(), customType, data }
	appendFile(this.currentSessionPath, JSON.stringify(entry) + '\n', (err) => {
		if (err) console.error('Session write error:', err.message)
	})
}

function isSessionEntry(value: Record<string, unknown>): value is SessionEntry {
	const type = value.type
	return type === 'session' || type === 'message' || type === 'custom'
}

getEntries(): SessionEntry[] {
	if (!this.currentSessionPath || !existsSync(this.currentSessionPath)) return []
	const content = readFileSync(this.currentSessionPath, 'utf8')
	const lines = content.trim().split('\n').filter((l) => l.length > 0)
	const entries: SessionEntry[] = []
	for (const line of lines) {
		const parsed: Record<string, unknown> = JSON.parse(line)
		if (isSessionEntry(parsed)) entries.push(parsed)
	}
	return entries
}
```

**Why**: Provides persistence and read access for hooks without exposing mutation APIs.

#### 18. Hook Message Helpers + Module Augmentation
**File**: `apps/coding-agent/src/hooks/hook-messages.ts` (new file)

**After**:
```ts
import type { HookMessage } from "./types.js"
import type { TextContent, ImageContent } from "@marvin-agents/ai"

export function createHookMessage(input: Pick<HookMessage, "customType" | "content" | "display" | "details">): HookMessage {
	return {
		role: "hookMessage",
		customType: input.customType,
		content: input.content,
		display: input.display,
		details: input.details,
		timestamp: Date.now(),
	}
}

export function hookMessageToText(message: HookMessage): string {
	if (typeof message.content === "string") return message.content
	const parts = message.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
	return parts.join("\n")
}
```

**File**: `apps/coding-agent/src/hooks/custom-messages.ts` (new file)

**After**:
```ts
import type { HookMessage } from "./types.js"

declare module "@marvin-agents/agent-core" {
	interface CustomMessages {
		hookMessage: HookMessage
	}
}

export {}
```

**Why**: Adds hook message persistence and type-safe custom role integration.

### Edge Cases to Handle
- [ ] Hook throws during `chat.message`: log and keep original parts.
- [ ] Hook returns invalid tool args: tool should fail with error surfaced to LLM.
- [ ] `appendEntry` called with no session: no-op.

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Before proceeding to next phase**:
```bash
bun run test
```

**Manual**:
- [ ] Hook errors are logged and do not crash the agent.
- [ ] Custom entries appear in session JSONL.

### Rollback
```bash
git restore -- apps/coding-agent/src/hooks/types.ts apps/coding-agent/src/hooks/loader.ts apps/coding-agent/src/hooks/runner.ts apps/coding-agent/src/hooks/tool-wrapper.ts apps/coding-agent/src/session-manager.ts
```

### Notes
- Keep `send()` for backward compatibility; new `sendMessage()` is additive.

---

## Phase 2: Runtime + Transport Integration

### Prerequisites
- [ ] Phase 1 automated checks pass
- [ ] Phase 1 manual verification complete

### Change Checklist
- [ ] Add message transformer for hook messages + attachment handling.
- [ ] Wrap transport to apply `chat.messages.transform`, `chat.system.transform`, `chat.params`, `auth.get`, and `model.resolve`.
- [ ] Apply `chat.params` to `AgentLoopConfig` in `ProviderTransport`.
- [ ] Invoke `chat.message` + `agent.before_start` in TUI/headless/ACP prompt flow.
- [ ] Integrate `session.before_compact` + `session.compact` into `/compact` flow.
- [ ] Add `session.shutdown` emission on app exit.
- [ ] Wire hook-registered tools into agent tool list.
- [ ] Track token usage from provider responses and emit in `turn.end`/`agent.end`.
- [ ] Wire session context facade (summarize, toast) in TUI.

### Changes

#### 1. Message Transformer for Hooks
**File**: `apps/coding-agent/src/hooks/message-transformer.ts` (new file)

**After**:
```ts
import type { AppMessage, UserMessageWithAttachments } from "@marvin-agents/agent-core"
import type { Message } from "@marvin-agents/ai"
import type { HookRunner } from "./runner.js"
import type { HookMessage } from "./types.js"

const isHookMessage = (message: AppMessage): message is HookMessage => message.role === "hookMessage"

export async function transformMessages(
	hookRunner: HookRunner,
	messages: AppMessage[]
): Promise<Message[]> {
	const llmMessages: Message[] = []

	for (const message of messages) {
		if (isHookMessage(message)) {
			const content = typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content
			llmMessages.push({ role: "user", content, timestamp: message.timestamp })
			continue
		}

		if (message.role === "user") {
			const userMessage: UserMessageWithAttachments = message
			const { attachments, ...rest } = userMessage
			if (!attachments || attachments.length === 0) {
				llmMessages.push(rest)
				continue
			}

			const content = Array.isArray(rest.content)
				? [...rest.content]
				: [{ type: "text", text: rest.content }]

			for (const attachment of attachments) {
				if (attachment.type === "image") {
					content.push({ type: "image", data: attachment.content, mimeType: attachment.mimeType })
				} else if (attachment.type === "document" && attachment.extractedText) {
					content.push({ type: "text", text: `\n\n[Document: ${attachment.fileName}]\n${attachment.extractedText}` })
				}
			}

			llmMessages.push({ ...rest, content })
			continue
		}

		if (message.role === "assistant" || message.role === "toolResult") {
			llmMessages.push(message)
		}
	}

	return llmMessages
}
```

**Why**: Centralizes LLM message conversion for all modes.

#### 2. Transport Hook Wrapper
**File**: `apps/coding-agent/src/hooks/hook-transport.ts` (new file)

**After**:
```ts
import type { AgentRunConfig, AgentTransport } from "@marvin-agents/agent-core"
import type { Message } from "@marvin-agents/ai"
import type { HookRunner } from "./runner.js"

export class HookedTransport implements AgentTransport {
	constructor(private inner: AgentTransport, private hooks: HookRunner) {}

	async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
		const sessionId = this.hooks.getSessionId()
		const nextCfg = await this.hooks.applyRunConfig(cfg, sessionId)
		const transformed = await this.hooks.emitContext(messages)
		yield* this.inner.run(transformed, userMessage, nextCfg, signal)
	}

	async *continue(messages: Message[], cfg: AgentRunConfig, signal?: AbortSignal) {
		const sessionId = this.hooks.getSessionId()
		const nextCfg = await this.hooks.applyRunConfig(cfg, sessionId)
		const transformed = await this.hooks.emitContext(messages)
		yield* this.inner.continue(transformed, nextCfg, signal)
	}
}
```

**Why**: Single integration point for `chat.messages.transform`, `chat.system.transform`, `chat.params`, `auth.get`, `model.resolve`.

#### 3. Import Updates (transports/types.ts)
**File**: `packages/agent/src/transports/types.ts`

**Before**:
```ts
import type { AgentTool, Message, Model, QueuedMessage, ReasoningEffort } from "@marvin-agents/ai";
```

**After**:
```ts
import type { AgentTool, Api, Message, Model, QueuedMessage, ReasoningEffort, SimpleStreamOptions } from "@marvin-agents/ai";
```

**Why**: Adds types for `Model<Api>` and stream override options.

#### 4. Agent RunConfig Extensions
**File**: `packages/agent/src/transports/types.ts`
**Location**: lines 8-20

**Before**:
```ts
export interface AgentRunConfig {
	systemPrompt: string;
	tools: AgentTool<any>[];
	model: Model<any>;
	reasoning?: ReasoningEffort;
	getQueuedMessages?: <T>() => Promise<QueuedMessage<T>[]>;
}
```

**After**:
```ts
export interface AgentRunConfig {
	systemPrompt: string;
	tools: AgentTool[];
	model: Model<Api>;
	reasoning?: ReasoningEffort;
	streamOptions?: SimpleStreamOptions;
	apiKey?: string;
	headers?: Record<string, string>;
	baseUrl?: string;
	getQueuedMessages?: <T>() => Promise<QueuedMessage<T>[]>;
}
```

**Why**: Allows hook-driven auth/routing/params to flow into transport.

#### 5. ProviderTransport Overrides
**File**: `packages/agent/src/transports/ProviderTransport.ts`
**Location**: lines 17-56

**Before**:
```ts
private async getModelAndKey(cfg: AgentRunConfig) {
	let apiKey: string | undefined;
	if (this.options.getApiKey) {
		apiKey = await this.options.getApiKey(cfg.model.provider);
	}
	if (!apiKey) {
		throw new Error(`No API key found for provider: ${cfg.model.provider}`);
	}

	let model = cfg.model;
	if (this.options.corsProxyUrl && cfg.model.baseUrl) {
		model = { ...cfg.model, baseUrl: `${this.options.corsProxyUrl}/?url=${encodeURIComponent(cfg.model.baseUrl)}` };
	}

	return { model, apiKey };
}

private buildLoopConfig(model: typeof cfg.model, apiKey: string, cfg: AgentRunConfig): AgentLoopConfig {
	return {
		model,
		reasoning: cfg.reasoning,
		apiKey,
		getQueuedMessages: cfg.getQueuedMessages,
	};
}
```

**After**:
```ts
private async getModelAndKey(cfg: AgentRunConfig) {
	let apiKey = cfg.apiKey;
	if (!apiKey && this.options.getApiKey) {
		apiKey = await this.options.getApiKey(cfg.model.provider);
	}
	if (!apiKey) throw new Error(`No API key found for provider: ${cfg.model.provider}`);

	let model = cfg.model;
	if (cfg.baseUrl) model = { ...model, baseUrl: cfg.baseUrl };
	if (cfg.headers) model = { ...model, headers: { ...(model.headers ?? {}), ...cfg.headers } };
	if (this.options.corsProxyUrl && model.baseUrl) {
		model = { ...model, baseUrl: `${this.options.corsProxyUrl}/?url=${encodeURIComponent(model.baseUrl)}` };
	}

	return { model, apiKey };
}

private buildLoopConfig(model: typeof cfg.model, apiKey: string, cfg: AgentRunConfig): AgentLoopConfig {
	return {
		...cfg.streamOptions,
		model,
		reasoning: cfg.reasoning,
		apiKey,
		getQueuedMessages: cfg.getQueuedMessages,
	};
}
```

**Why**: Supports hook-based auth, routing, and stream parameter overrides.

#### 6. TUI Integration (prompt path)
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: around `handleSubmit` and agent creation

**Before**:
```ts
const { hooks, errors: hookErrors } = await loadHooks(loaded.configDir)
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir)

const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport })
const agent = new Agent({
	transport,
	initialState: { systemPrompt: loaded.systemPrompt, model: loaded.model, thinkingLevel: loaded.thinking, tools },
})
...
if (isResponding()) {
	queuedMessages.push(text)
	void agent.queueMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
	...
}
...
try { await agent.prompt(text) }
```

**After**:
```ts
const sessionManager = new SessionManager(loaded.configDir)
const { hooks, errors: hookErrors } = await loadHooks(loaded.configDir)
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir, sessionManager)

const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport })
const hookedTransport = new HookedTransport(transport, hookRunner)
const agent = new Agent({
	transport: hookedTransport,
	messageTransformer: (messages) => transformMessages(hookRunner, messages),
	initialState: { systemPrompt: loaded.systemPrompt, model: loaded.model, thinkingLevel: loaded.thinking, tools },
})
...
const parts = [{ type: "text", text }]
await hookRunner.emitChatMessage({ sessionId: sessionManager.sessionId, text }, { parts })
const finalText = parts.map((p) => p.text).join("\n")
const beforeResult = await hookRunner.emitBeforeAgentStart(finalText)
if (beforeResult?.message) {
	const hookMessage = createHookMessage(beforeResult.message)
	agent.appendMessage(hookMessage)
	sessionManager.appendMessage(hookMessage)
}
...
if (isResponding()) {
	queuedMessages.push(finalText)
	void agent.queueMessage({ role: "user", content: [{ type: "text", text: finalText }], timestamp: Date.now() })
}
...
try { await agent.prompt(finalText) }
```

**Why**: Ensures pre-LLM injection and hook-driven context are applied consistently.

#### 7. Headless + ACP Integration
**File**: `apps/coding-agent/src/headless.ts`

**Before**:
```ts
const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport })
const agent = new Agent({ transport, initialState: { systemPrompt: loaded.systemPrompt, model: loaded.model, thinkingLevel: loaded.thinking, tools } })
...
await agent.prompt(prompt)
```

**After**:
```ts
const sessionManager = new SessionManager(loaded.configDir)
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir, sessionManager)

hookRunner.initialize({
	sendHandler: () => {},
	sendMessageHandler: () => {},
	appendEntryHandler: () => {},
	getSessionId: () => sessionManager.sessionId,
	hasUI: false,
})

const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport })
const hookedTransport = new HookedTransport(transport, hookRunner)
const agent = new Agent({
	transport: hookedTransport,
	messageTransformer: (messages) => transformMessages(hookRunner, messages),
	initialState: { systemPrompt: loaded.systemPrompt, model: loaded.model, thinkingLevel: loaded.thinking, tools },
})
...
const parts = [{ type: "text", text: prompt }]
await hookRunner.emitChatMessage({ sessionId: null, text: prompt }, { parts })
const finalPrompt = parts.map((p) => p.text).join("\n")
await agent.prompt(finalPrompt)
```

**Why**: Keeps headless behavior aligned with hook transforms.

#### 8. Hook Tool Integration
**File**: `apps/coding-agent/src/hooks/hook-tool-adapter.ts` (new file)

**After**:
```ts
import type { AgentTool, TextContent } from "@marvin-agents/ai"
import type { HookRunner } from "./runner.js"
import type { RegisteredTool, HookEventContext } from "./types.js"

export function createHookToolAdapter(tool: RegisteredTool, getContext: () => HookEventContext): AgentTool {
	return {
		name: tool.name,
		description: tool.description,
		schema: {
			type: "object",
			properties: Object.fromEntries(
				Object.entries(tool.schema.properties).map(([key, prop]) => [
					key,
					{ type: prop.type, description: prop.description, enum: prop.enum },
				])
			),
			required: tool.schema.required ?? [],
		},
		async execute(toolCallId, params, signal, onUpdate) {
			const result = await tool.execute(params, getContext())
			const content: TextContent[] = [{ type: "text", text: result }]
			return { content }
		},
	}
}

export function getHookTools(hookRunner: HookRunner): AgentTool[] {
	return hookRunner.getRegisteredTools().map((tool) =>
		createHookToolAdapter(tool, () => hookRunner.getContext())
	)
}
```

**Why**: Converts hook-registered tools to AgentTool interface for agent consumption.

**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: after tool setup

**Before**:
```ts
const tools = [...baseTools, ...customTools]
```

**After**:
```ts
const hookTools = getHookTools(hookRunner)
const tools = [...baseTools, ...customTools, ...hookTools]
```

**Why**: Hook-contributed tools are available alongside built-in tools.

#### 9. Token Usage Tracking
**File**: `packages/agent/src/Agent.ts`
**Location**: after streaming response handling

**Add**:
```ts
export interface TokenUsageInfo {
	input: number
	output: number
	cacheRead?: number
	cacheWrite?: number
	total: number
}

// In stream handling, after receiving usage from provider:
private accumulateTokens(usage: ProviderUsage): void {
	this.turnTokens = {
		input: (this.turnTokens?.input ?? 0) + (usage.inputTokens ?? 0),
		output: (this.turnTokens?.output ?? 0) + (usage.outputTokens ?? 0),
		cacheRead: (this.turnTokens?.cacheRead ?? 0) + (usage.cacheReadTokens ?? 0),
		cacheWrite: (this.turnTokens?.cacheWrite ?? 0) + (usage.cacheWriteTokens ?? 0),
		total: 0,
	}
	this.turnTokens.total = this.turnTokens.input + this.turnTokens.output
}

// Expose for hooks:
getTurnTokens(): TokenUsageInfo | undefined {
	return this.turnTokens
}

getTotalTokens(): TokenUsageInfo | undefined {
	return this.totalTokens
}
```

**Why**: Enables token-based compaction triggers in hooks.

**File**: `apps/coding-agent/src/agent-events.ts`
**Location**: turn.end emission

**Before**:
```ts
await hookRunner.emit({ type: "turn.end", turnIndex })
```

**After**:
```ts
const turnTokens = agent.getTurnTokens()
const contextLimit = getModelContextLimit(agent.getModel())
hookRunner.updateTokenUsage(turnTokens, contextLimit)
await hookRunner.emit({
	type: "turn.end",
	sessionId: sessionManager.sessionId,
	turnIndex,
	tokens: turnTokens ?? { input: 0, output: 0, total: 0 },
	contextLimit,
})
```

**Why**: Hooks receive token stats to implement usage-based compaction.

#### 10. Session Context Facade Wiring
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: hookRunner.initialize call

**Before**:
```ts
uiContext: createHookUIContext({ setEditorText, getEditorText, showSelect, showInput, showConfirm, showNotify }),
```

**After**:
```ts
uiContext: createHookUIContext({ setEditorText, getEditorText, showSelect, showInput, showConfirm, showNotify }),
sessionContext: {
	summarize: async () => {
		// Trigger /compact flow
		await handleCompact()
	},
	toast: (title, message, variant = "info") => {
		showNotification({ title, message, variant })
	},
	getTokenUsage: () => hookRunner.tokenUsage,
	getContextLimit: () => hookRunner.contextLimit,
},
```

**Why**: Hooks can trigger compaction and show notifications.

### Edge Cases to Handle
- [ ] `chat.message` returns empty parts: fallback to original text.
- [ ] `auth.get` returns invalid baseUrl: log and continue with default model.
- [ ] Hook tool throws: wrap in try/catch, return error text to LLM.
- [ ] Token tracking unavailable (e.g., Codex mode): return undefined, hooks should handle gracefully.

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Manual**:
- [ ] Prompt in TUI triggers hook injection before agent starts.
- [ ] Headless prompt respects hook transforms.

### Rollback
```bash
git restore -- apps/coding-agent/src/tui-app.tsx apps/coding-agent/src/headless.ts apps/coding-agent/src/acp/index.ts apps/coding-agent/src/acp/session.ts packages/agent/src/transports/types.ts packages/agent/src/transports/ProviderTransport.ts
```

---

## Phase 3: TUI UX, Commands, Renderers, Tests, and Local Hook Setup

### Prerequisites
- [ ] Phase 2 automated checks pass
- [ ] Phase 2 manual verification complete

### Change Checklist
- [ ] Add hook UI components and wire `ctx.ui` in TUI.
- [ ] Add UI support for hook messages + renderers.
- [ ] Integrate hook commands into slash command pipeline.
- [ ] Add tests for new hook behaviors.
- [ ] Document local hook setup for supermemory + Gemini auth.

### Changes

#### 1. UI Message Type + Rendering
**File**: `apps/coding-agent/src/types.ts`
**Location**: after `UIShellMessage`

**Before**:
```ts
export type UIMessage = UIUserMessage | UIAssistantMessage | UIShellMessage
```

**After**:
```ts
export interface UIHookMessage {
	id: string
	role: "hook"
	customType: string
	content: string
	display: boolean
	details?: unknown
	timestamp?: number
}

export type UIMessage = UIUserMessage | UIAssistantMessage | UIShellMessage | UIHookMessage
```

**Why**: Enables hook-specific message rendering in TUI.

#### 2. MessageList Hook Rendering
**File**: `apps/coding-agent/src/components/MessageList.tsx`
**Location**: inside `buildContentItems`

**Before**:
```ts
} else if (msg.role === "shell") {
	const item: ContentItem = { type: "shell", command: msg.command, output: msg.output, exitCode: msg.exitCode, truncated: msg.truncated, tempFilePath: msg.tempFilePath }
	items.push(getCachedItem(`shell:${msg.id}`, item, ...))
}
```

**After**:
```ts
} else if (msg.role === "hook") {
	if (!msg.display) continue
	const item: ContentItem = { type: "hook", hook: msg }
	items.push(getCachedItem(`hook:${msg.id}`, item, (a, b) => a.type === "hook" && a.hook.content === b.hook.content))
} else if (msg.role === "shell") {
	const item: ContentItem = { type: "shell", command: msg.command, output: msg.output, exitCode: msg.exitCode, truncated: msg.truncated, tempFilePath: msg.tempFilePath }
	items.push(getCachedItem(`shell:${msg.id}`, item, ...))
}
```

**Why**: Hook messages can be shown/hidden and custom-rendered.

#### 3. Hook UI Context Wiring
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: hook initialization

**Before**:
```ts
props.hookRunner.setSendHandler((text) => void handleSubmit(text))
props.sendRef.current = (text) => void handleSubmit(text)
```

**After**:
```ts
props.hookRunner.initialize({
	sendHandler: (text) => void handleSubmit(text),
	sendMessageHandler: (message, triggerTurn) => {
		const hookMsg = createHookMessage(message)
		agent.appendMessage(hookMsg)
		sessionManager.appendMessage(hookMsg)
		if (triggerTurn) void handleSubmit(hookMessageToText(hookMsg))
	},
	appendEntryHandler: (customType, data) => sessionManager.appendEntry(customType, data),
	getSessionId: () => sessionManager.sessionId,
	uiContext: createHookUIContext({ setEditorText, getEditorText, showSelect, showInput, showConfirm, showNotify }),
	hasUI: true,
})
props.sendRef.current = (text) => void handleSubmit(text)
```

**Why**: Enables hook messages, persistence, and UI prompts.

#### 4. Hook Command Handling
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: inside `handleSubmit` slash command block

**Before**:
```ts
const result = handleSlashCommand(trimmed, cmdCtx)
if (result instanceof Promise ? await result : result) { ... }
const expanded = tryExpandCustomCommand(trimmed, builtInCommandNames, props.customCommands)
```

**After**:
```ts
const hookCommand = props.hookRunner.getCommand(trimmed.slice(1).split(/\s+/)[0] ?? "")
if (hookCommand) {
	await hookCommand.handler(trimmed.replace(/^\S+\s?/, ""), props.hookRunner.getContext())
	return
}
const result = handleSlashCommand(trimmed, cmdCtx)
if (result instanceof Promise ? await result : result) { ... }
const expanded = tryExpandCustomCommand(trimmed, builtInCommandNames, props.customCommands)
```

**Why**: Allows hook-defined commands to run immediately.

#### 5. Tests
**File**: `apps/coding-agent/tests/hooks.test.ts`

**Add**:
```ts
it("emits chat.message and allows mutation", async () => {
	// create hook that prepends part
})

it("emits tool.execute.after on errors", async () => {
	// create failing tool and verify hook event
})

it("appendEntry writes custom entries", () => {
	// append entry and verify session JSONL contains type: "custom"
})

it("registerTool adds tool to agent", async () => {
	// register a hook tool and verify it appears in getRegisteredTools()
})

it("turn.end includes token usage", async () => {
	// verify turn.end event contains tokens and contextLimit
})

it("ctx.session.summarize triggers compaction", async () => {
	// call ctx.session.summarize() and verify compaction flow runs
})
```

**Why**: Coverage for new hook surfaces, tools, token tracking, and session facade.

#### 6. Local Hook Setup (Manual)
**Paths**:
- `~/.config/marvin/hooks/supermemory.ts`
- `~/.config/marvin/hooks/gemini-auth.ts`

**After** (example outline only):
```ts
// supermemory.ts
import type { HookFactory } from "marvin/hooks"

const COMPACTION_THRESHOLD = 0.80

export default ((marvin) => {
	const injectedSessions = new Set<string>()

	// Inject memory context on first message
	marvin.on("chat.message", async (event, ctx) => {
		const sessionId = event.input.sessionId
		if (!sessionId || injectedSessions.has(sessionId)) return

		injectedSessions.add(sessionId)

		// Fetch memories from supermemory API
		const memories = await fetchMemories(event.input.text)
		if (memories.length > 0) {
			const contextPart = {
				type: "text" as const,
				text: formatMemoryContext(memories),
			}
			event.output.parts.unshift(contextPart)
		}
	})

	// Register supermemory tool for add/search/profile
	marvin.registerTool({
		name: "supermemory",
		description: "Manage persistent memory. Modes: add, search, profile, list, forget",
		schema: {
			type: "object",
			properties: {
				mode: { type: "string", enum: ["add", "search", "profile", "list", "forget"] },
				content: { type: "string", optional: true },
				query: { type: "string", optional: true },
				scope: { type: "string", enum: ["user", "project"], optional: true },
			},
		},
		async execute(args, ctx) {
			// Handle supermemory operations
			return JSON.stringify({ success: true, ...result })
		},
	})

	// Token-based compaction trigger
	marvin.on("turn.end", async (event, ctx) => {
		const usage = event.tokens
		const limit = event.contextLimit
		if (!usage || !limit) return

		const ratio = usage.total / limit
		if (ratio >= COMPACTION_THRESHOLD) {
			ctx.session.toast("Compaction", `Context at ${(ratio * 100).toFixed(0)}%`, "warning")
			await ctx.session.summarize()
		}
	})

	// Save summary as memory after compaction
	marvin.on("session.compact", async (event, ctx) => {
		await saveMemory(event.summary, "conversation")
	})
}) satisfies HookFactory

// gemini-auth.ts
export default ((marvin) => {
	marvin.on("auth.get", (event) => {
		if (event.input.provider === "google") {
			event.output.apiKey = process.env.GEMINI_API_KEY
		}
	})
}) satisfies HookFactory
```

**Why**: Demonstrates full supermemory-compatible hook with memory injection, tool registration, token-based compaction, and summary persistence.

### Edge Cases to Handle
- [ ] Hook UI prompts return undefined (cancel) → hook should no-op.
- [ ] Hook message display=false → skip UI rendering but still sent to LLM.

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Manual**:
- [ ] Hook command executes and does not queue as a user message.
- [ ] Hook message renderer overrides default view.
- [ ] Supermemory hook injects context before LLM call.

### Rollback
```bash
git restore -- apps/coding-agent/src/types.ts apps/coding-agent/src/components/MessageList.tsx apps/coding-agent/src/tui-app.tsx apps/coding-agent/tests/hooks.test.ts
```

---

## Testing Strategy

### Unit Tests to Add/Modify
**File**: `apps/coding-agent/tests/hooks.test.ts`

```ts
describe("chat.message", () => {
	it("mutates parts", async () => {
		// hook modifies output.parts and verify result
	})
})

describe("tool.execute.after", () => {
	it("fires on tool error", async () => {
		// hook receives isError=true
	})
})
```

### Integration Tests
- [ ] HookedTransport applies auth override and model baseUrl override.
- [ ] Hook-registered tools are merged with built-in tools and callable.
- [ ] Token usage flows from provider through Agent to turn.end event.
- [ ] Session facade operations (summarize, toast) work in TUI mode and no-op in headless.

### Manual Testing Checklist
1. [ ] Add supermemory hook file under `~/.config/marvin/hooks/` and verify injection in TUI.
2. [ ] Add gemini-auth hook to supply API key/headers and verify requests succeed.
3. [ ] Trigger hook UI prompt and confirm cancel path returns safely.
4. [ ] Verify hook-registered tool appears in `/tools` list and can be called by agent.
5. [ ] Verify `turn.end` event contains token usage (check with debug logging).
6. [ ] Verify `ctx.session.summarize()` triggers compaction flow.
7. [ ] Verify `ctx.session.toast()` shows notification in TUI.

## Deployment Instructions

### Environment Variables
```bash
GEMINI_API_KEY=...
SUPERMEMORY_TOKEN=...
```

## Anti-Patterns to Avoid
- Mutating original session messages in `chat.messages.transform` (use copies).
- Throwing inside `tool.execute.after` without guarding (should log and continue).

## Open Questions (must resolve before implementation)
- [ ] None -> Answer: N/A (decisions captured in plan).

## References
- OpenCode plugin contract: `/Users/yesh/Documents/personal/reference/opencode/packages/plugin/src/index.ts`
- OpenCode hook trigger usage: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/session/prompt.ts`
- pi-mono hook types + UI: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/hooks/types.ts`
- pi-mono hook loader/runner: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/hooks/loader.ts`, `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/hooks/runner.ts`
- Supermemory OpenCode plugin: `/tmp/opencode-supermemory/src/index.ts`

## Supermemory Compatibility Matrix

| OpenCode Feature | Marvin Hook Equivalent | Status |
|------------------|------------------------|--------|
| `chat.message` (input, output) | `chat.message` event | ✅ Full |
| `tool: { supermemory }` | `registerTool()` API | ✅ Full |
| `event: message.updated` | `turn.end` with tokens | ✅ Adapted |
| `event: session.idle` | `agent.end` with tokens | ✅ Adapted |
| `event: session.deleted` | `session.shutdown` | ✅ Adapted |
| `ctx.client.session.summarize` | `ctx.session.summarize()` | ✅ Full |
| `ctx.client.tui.showToast` | `ctx.session.toast()` | ✅ Full |
| Token usage tracking | `turn.end.tokens`, `ctx.session.getTokenUsage()` | ✅ Full |
| Context limit | `turn.end.contextLimit`, `ctx.session.getContextLimit()` | ✅ Full |

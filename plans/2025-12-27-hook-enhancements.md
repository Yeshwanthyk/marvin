# Hook System Enhancements Implementation Plan

## Overview

Add five hook features to marvin: configurable hook timeout, attachments in `send()`, model change events, session cancel events, and compaction hooks.

## Current State

### Hook System
- **Location**: `apps/coding-agent/src/hooks/`
- **Events**: `app.start`, `session.start/resume/clear`, `agent.start/end`, `turn.start/end`, `tool.execute.before/after`
- **Timeout**: Hardcoded 5s in `runner.ts:12`
- **Send**: `marvin.send(text: string)` → `SendHandler` → `handleSubmit(text)` 

### Compaction
- **Location**: `apps/coding-agent/src/compact-handler.ts`
- **Trigger**: `/compact [instructions]` command in `commands.ts:354-357`
- **Flow**: Filter messages → append summarization prompt → call LLM → reset agent with summary message → start new session

### Session Management
- **Location**: `apps/coding-agent/src/session-manager.ts`
- **Events**: `session.start`, `session.resume`, `session.clear` (no before-variants, no cancel)
- **No branching**: Sessions are linear only

### Config
- **Location**: `apps/coding-agent/src/config.ts`
- **Interface**: `LoadedAppConfig` at line 62
- **No hookTimeout field currently**

## Desired End State

1. `hookTimeout` configurable via `~/.config/marvin/config.json`
2. `marvin.send(text, attachments?)` supports file/image injection
3. `model.change` event fires on Ctrl+P model cycling
4. `session.before_clear` event can cancel `/clear` command
5. `compact.before` and `compact.after` events for custom compaction

## Out of Scope

- Session branching (`before_branch`) — marvin has no branching
- `session.before_resume` — resume happens at startup before hooks are wired
- UI context (`ctx.ui.select/confirm`) — separate enhancement

---

## Phase 1: Hook Timeout Config

### Overview
Add `hookTimeout` to config, pass to HookRunner. Unblocks longer-running hooks.

### Prerequisites
- [ ] None

### Changes

#### 1. Config Interface
**File**: `apps/coding-agent/src/config.ts`
**Lines**: 62-74

**Before**:
```typescript
export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  theme: string;
  editor?: EditorConfig;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
  lsp: { enabled: boolean; autoInstall: boolean };
}
```

**After**:
```typescript
export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  theme: string;
  editor?: EditorConfig;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
  lsp: { enabled: boolean; autoInstall: boolean };
  hookTimeout: number;
}
```

#### 2. Config Parsing
**File**: `apps/coding-agent/src/config.ts`
**Lines**: ~165 (in `loadAppConfig` function, after other field parsing)

**Add**:
```typescript
const hookTimeout = typeof rawObj.hookTimeout === "number" && rawObj.hookTimeout > 0 
  ? rawObj.hookTimeout 
  : 30000;
```

**Update return object** to include `hookTimeout`.

#### 3. HookRunner Instantiation - TUI
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: ~86

**Before**:
```typescript
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir)
```

**After**:
```typescript
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir, loaded.hookTimeout)
```

#### 4. HookRunner Instantiation - Headless
**File**: `apps/coding-agent/src/headless.ts`
**Lines**: ~86

**Before**:
```typescript
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir);
```

**After**:
```typescript
const hookRunner = new HookRunner(hooks, cwd, loaded.configDir, loaded.hookTimeout);
```

#### 5. Update Default Constant
**File**: `apps/coding-agent/src/hooks/runner.ts`
**Lines**: 12

**Before**:
```typescript
const DEFAULT_TIMEOUT = 5000
```

**After**:
```typescript
const DEFAULT_TIMEOUT = 30000
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test
```

**Manual**:
- [ ] Add `"hookTimeout": 60000` to config.json, verify hook gets 60s timeout
- [ ] Remove hookTimeout from config, verify default 30s applies

---

## Phase 2: Attachments in send()

### Overview
Extend `send()` to accept optional attachments array. Enables hooks to inject images/files.

### Prerequisites
- [ ] Phase 1 complete (not strictly required, but keeps changes sequential)

### Changes

#### 1. SendHandler Type
**File**: `apps/coding-agent/src/hooks/loader.ts`
**Lines**: 8

**Before**:
```typescript
export type SendHandler = (text: string) => void
```

**After**:
```typescript
import type { Attachment } from "@marvin-agents/agent-core"

export type SendHandler = (text: string, attachments?: Attachment[]) => void
```

#### 2. HookAPI Interface
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: ~148

**Add import**:
```typescript
import type { Attachment } from "@marvin-agents/agent-core"
```

**Before**:
```typescript
send(text: string): void
```

**After**:
```typescript
send(text: string, attachments?: Attachment[]): void
```

#### 3. HookAPI Implementation
**File**: `apps/coding-agent/src/hooks/loader.ts`
**Lines**: ~45 (in `createHookAPI` function)

**Before**:
```typescript
send(text: string): void {
  sendHandler(text)
}
```

**After**:
```typescript
send(text: string, attachments?: Attachment[]): void {
  sendHandler(text, attachments)
}
```

#### 4. TUI SendHandler Hookup
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: ~380

**Before**:
```typescript
props.hookRunner.setSendHandler((text) => void handleSubmit(text))
```

**After**:
```typescript
props.hookRunner.setSendHandler((text, attachments) => void handleSubmitWithAttachments(text, attachments))
```

#### 5. handleSubmitWithAttachments Function
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: After `handleSubmit` function (~line 460)

**Add**:
```typescript
const handleSubmitWithAttachments = async (text: string, attachments?: Attachment[]) => {
  if (!text.trim() && (!attachments || attachments.length === 0)) return

  if (isResponding()) {
    const msg: AppMessage = { 
      role: "user", 
      content: [{ type: "text", text }], 
      timestamp: Date.now(),
      attachments 
    }
    queuedMessages.push(text)
    setQueueCount(queuedMessages.length)
    void agent.queueMessage(msg)
    return
  }

  ensureSession()
  const msg: AppMessage = { 
    role: "user", 
    content: [{ type: "text", text }], 
    timestamp: Date.now(),
    attachments 
  }
  sessionManager.appendMessage(msg)
  batch(() => {
    setMessages((prev) => [...prev, { 
      id: crypto.randomUUID(), 
      role: "user", 
      content: text, 
      timestamp: Date.now(),
      attachments 
    }])
    setToolBlocks([])
    setIsResponding(true)
    setActivityState("thinking")
  })
  try { 
    await agent.prompt(text, { attachments }) 
  } catch (err) { 
    batch(() => { 
      setMessages((prev) => [...prev, { 
        id: crypto.randomUUID(), 
        role: "assistant", 
        content: `Error: ${err instanceof Error ? err.message : String(err)}` 
      }])
      setIsResponding(false)
      setActivityState("idle")
    }) 
  }
}
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test
```

**Manual**:
- [ ] Create test hook that calls `marvin.send("test", [attachment])`, verify message includes attachment

---

## Phase 3: Model Change Event

### Overview
Add `model.change` event fired when user cycles models via Ctrl+P.

### Prerequisites
- [ ] Phase 2 complete

### Changes

#### 1. Event Type Definition
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: After `TurnEndEvent` (~line 75)

**Add**:
```typescript
/** Fired when model changes via Ctrl+P */
export interface ModelChangeEvent {
  type: "model.change"
  previousProvider: string
  previousModelId: string
  newProvider: string
  newModelId: string
  thinkingLevel: ThinkingLevel
}
```

**Add import** (if not present):
```typescript
import type { ThinkingLevel } from "@marvin-agents/agent-core"
```

#### 2. Update HookEvent Union
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: ~88

**Before**:
```typescript
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
```typescript
export type HookEvent =
  | AppStartEvent
  | SessionEvent
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | ToolExecuteBeforeEvent
  | ToolExecuteAfterEvent
  | ModelChangeEvent
```

#### 3. Update HookEventMap
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: ~120

**Add to `HookEventMap`**:
```typescript
"model.change": ModelChangeEvent
```

#### 4. Update HookResultMap
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: ~133

**Add to `HookResultMap`**:
```typescript
"model.change": void
```

#### 5. Emit Event on Model Cycle
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: ~225 (in `cycleModel` function)

**Before**:
```typescript
const cycleModel = () => {
  if (props.cycleModels.length <= 1) return
  if (isResponding()) return
  cycleIndex = (cycleIndex + 1) % props.cycleModels.length
  const entry = props.cycleModels[cycleIndex]!
  currentProvider = entry.provider
  currentModelId = entry.model.id
  agent.setModel(entry.model)
  setDisplayModelId(entry.model.id)
  setDisplayContextWindow(entry.model.contextWindow)
}
```

**After**:
```typescript
const cycleModel = () => {
  if (props.cycleModels.length <= 1) return
  if (isResponding()) return
  
  const prevProvider = currentProvider
  const prevModelId = currentModelId
  
  cycleIndex = (cycleIndex + 1) % props.cycleModels.length
  const entry = props.cycleModels[cycleIndex]!
  currentProvider = entry.provider
  currentModelId = entry.model.id
  agent.setModel(entry.model)
  setDisplayModelId(entry.model.id)
  setDisplayContextWindow(entry.model.contextWindow)
  
  void props.hookRunner.emit({
    type: "model.change",
    previousProvider: prevProvider,
    previousModelId: prevModelId,
    newProvider: entry.provider,
    newModelId: entry.model.id,
    thinkingLevel: currentThinking,
  })
}
```

#### 6. Export New Type
**File**: `apps/coding-agent/src/hooks/index.ts`

**Add to exports**:
```typescript
export type { ModelChangeEvent } from "./types.js"
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test
```

**Manual**:
- [ ] Create hook with `marvin.on("model.change", ...)`, verify fires on Ctrl+P
- [ ] Verify event contains correct previous/new model info

---

## Phase 4: Session Cancel Event

### Overview
Add `session.before_clear` event that can cancel `/clear` command.

### Prerequisites
- [ ] Phase 3 complete

### Changes

#### 1. Update SessionEvent Type
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: ~48

**Before**:
```typescript
export interface SessionEvent {
  type: "session.start" | "session.resume" | "session.clear"
  sessionId: string | null
}
```

**After**:
```typescript
export interface SessionEvent {
  type: "session.start" | "session.resume" | "session.clear" | "session.before_clear"
  sessionId: string | null
}
```

#### 2. Add SessionEventResult Type
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: After `ToolExecuteAfterResult` (~line 108)

**Add**:
```typescript
/** Return type for session.before_* handlers - can cancel action */
export interface SessionEventResult {
  cancel?: boolean
}
```

#### 3. Update HookEventMap
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: ~120

**Add to `HookEventMap`**:
```typescript
"session.before_clear": SessionEvent
```

#### 4. Update HookResultMap
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: ~133

**Update**:
```typescript
"session.start": void
"session.resume": void
"session.clear": void
"session.before_clear": SessionEventResult | undefined
```

#### 5. Add emitSessionBeforeClear Method
**File**: `apps/coding-agent/src/hooks/runner.ts`
**Lines**: After `emitToolExecuteAfter` (~line 160)

**Add**:
```typescript
/**
 * Emit session.before_clear event.
 * Returns result with cancel flag if any hook wants to cancel.
 */
async emitSessionBeforeClear(sessionId: string | null): Promise<SessionEventResult | undefined> {
  const ctx = this.createContext()
  
  for (const hook of this.hooks) {
    const handlers = hook.handlers.get("session.before_clear")
    if (!handlers || handlers.length === 0) continue
    
    for (const handler of handlers) {
      try {
        const timeout = createTimeout(this.timeout)
        const result = await Promise.race([
          handler({ type: "session.before_clear", sessionId }, ctx),
          timeout.promise
        ]) as SessionEventResult | undefined
        timeout.clear()
        
        if (result?.cancel) {
          return result
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.emitError({ hookPath: hook.path, event: "session.before_clear", error: message })
      }
    }
  }
  
  return undefined
}
```

#### 6. Import SessionEventResult in Runner
**File**: `apps/coding-agent/src/hooks/runner.ts`
**Lines**: ~10

**Add to imports**:
```typescript
import type { SessionEventResult } from "./types.js"
```

#### 7. Update /clear Command Handler
**File**: `apps/coding-agent/src/commands.ts`
**Lines**: ~130-138

**Before**:
```typescript
if (trimmed === "/clear") {
  ctx.agent.reset()
  void ctx.hookRunner?.emit({ type: "session.clear", sessionId: null })
  // ... rest of clear logic
}
```

**After**:
```typescript
if (trimmed === "/clear") {
  // Check if hook wants to cancel
  const result = await ctx.hookRunner?.emitSessionBeforeClear(ctx.sessionManager.sessionId ?? null)
  if (result?.cancel) {
    addSystemMessage(ctx, "Clear cancelled by hook")
    return true
  }
  
  ctx.agent.reset()
  void ctx.hookRunner?.emit({ type: "session.clear", sessionId: null })
  // ... rest of clear logic
}
```

Note: The command handler function needs to be `async` if not already.

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test
```

**Manual**:
- [ ] Create hook returning `{ cancel: true }` on `session.before_clear`
- [ ] Run `/clear`, verify it's cancelled with message
- [ ] Hook returning undefined allows clear to proceed

---

## Phase 5: Compaction Hooks

### Overview
Add `compact.before` and `compact.after` events. `compact.before` can cancel or provide custom summary.

### Prerequisites
- [ ] Phase 4 complete

### Changes

#### 1. Add Compaction Event Types
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: After `ModelChangeEvent`

**Add**:
```typescript
/** Fired before compaction. Hooks can cancel or provide custom summary. */
export interface CompactBeforeEvent {
  type: "compact.before"
  /** Messages being compacted */
  messages: AppMessage[]
  /** Custom instructions from /compact command */
  customInstructions?: string
  /** Current model being used */
  model: { provider: string; id: string }
}

/** Fired after compaction completes */
export interface CompactAfterEvent {
  type: "compact.after"
  /** The generated summary */
  summary: string
  /** Whether summary was provided by a hook */
  fromHook: boolean
}

/** Return type for compact.before handlers */
export interface CompactBeforeResult {
  /** Cancel compaction */
  cancel?: boolean
  /** Provide custom summary (skips LLM call) */
  summary?: string
}
```

#### 2. Update HookEvent Union
**File**: `apps/coding-agent/src/hooks/types.ts`
**Lines**: ~88

**Add to union**:
```typescript
| CompactBeforeEvent
| CompactAfterEvent
```

#### 3. Update HookEventMap
**File**: `apps/coding-agent/src/hooks/types.ts`

**Add**:
```typescript
"compact.before": CompactBeforeEvent
"compact.after": CompactAfterEvent
```

#### 4. Update HookResultMap
**File**: `apps/coding-agent/src/hooks/types.ts`

**Add**:
```typescript
"compact.before": CompactBeforeResult | undefined
"compact.after": void
```

#### 5. Add emitCompactBefore Method
**File**: `apps/coding-agent/src/hooks/runner.ts`
**Lines**: After `emitSessionBeforeClear`

**Add**:
```typescript
/**
 * Emit compact.before event.
 * Returns result with cancel/summary if any hook provides one.
 */
async emitCompactBefore(
  messages: AppMessage[],
  model: { provider: string; id: string },
  customInstructions?: string
): Promise<CompactBeforeResult | undefined> {
  const ctx = this.createContext()
  
  for (const hook of this.hooks) {
    const handlers = hook.handlers.get("compact.before")
    if (!handlers || handlers.length === 0) continue
    
    for (const handler of handlers) {
      try {
        // No timeout for compact.before - custom summarization may take time
        const result = await handler(
          { type: "compact.before", messages, model, customInstructions },
          ctx
        ) as CompactBeforeResult | undefined
        
        if (result?.cancel || result?.summary) {
          return result
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.emitError({ hookPath: hook.path, event: "compact.before", error: message })
      }
    }
  }
  
  return undefined
}
```

**Add imports**:
```typescript
import type { AppMessage } from "@marvin-agents/agent-core"
import type { CompactBeforeResult } from "./types.js"
```

#### 6. Update Compact Handler
**File**: `apps/coding-agent/src/compact-handler.ts`
**Lines**: 37-101 (handleCompact function)

**Add to CompactOptions interface**:
```typescript
export interface CompactOptions {
  agent: Agent;
  currentProvider: string;
  getApiKey: (provider: string) => string | undefined;
  codexTransport: CodexTransport;
  customInstructions?: string;
  hookRunner?: HookRunner;  // Add this
}
```

**Modify handleCompact function**:
```typescript
export async function handleCompact(opts: CompactOptions): Promise<CompactResult> {
  const { agent, currentProvider, getApiKey, codexTransport, customInstructions, hookRunner } = opts;
  const model = agent.state.model;
  
  const messages = agent.state.messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'
  ) as Message[];

  // Emit compact.before - hooks can cancel or provide custom summary
  if (hookRunner) {
    const hookResult = await hookRunner.emitCompactBefore(
      messages,
      { provider: model.provider, id: model.id },
      customInstructions
    );
    
    if (hookResult?.cancel) {
      throw new Error("Compaction cancelled by hook");
    }
    
    if (hookResult?.summary) {
      const summaryMessage: AppMessage = {
        role: 'user',
        content: [{ type: 'text', text: SUMMARY_PREFIX + hookResult.summary + SUMMARY_SUFFIX }],
        timestamp: Date.now(),
      };
      
      // Emit compact.after
      void hookRunner.emit({ type: "compact.after", summary: hookResult.summary, fromHook: true });
      
      return { summary: hookResult.summary, summaryMessage };
    }
  }

  // ... existing LLM summarization logic ...
  
  const summary = response.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  const summaryMessage: AppMessage = {
    role: 'user',
    content: [{ type: 'text', text: SUMMARY_PREFIX + summary + SUMMARY_SUFFIX }],
    timestamp: Date.now(),
  };

  // Emit compact.after
  if (hookRunner) {
    void hookRunner.emit({ type: "compact.after", summary, fromHook: false });
  }

  return { summary, summaryMessage };
}
```

#### 7. Update Command Handler to Pass HookRunner
**File**: `apps/coding-agent/src/commands.ts`
**Lines**: ~290 (in handleCompactCmd)

**Update doCompact call**:
```typescript
const { summary, summaryMessage } = await doCompact({
  agent: ctx.agent,
  currentProvider: ctx.currentProvider,
  getApiKey: ctx.getApiKey,
  codexTransport: ctx.codexTransport,
  customInstructions,
  hookRunner: ctx.hookRunner,  // Add this
})
```

#### 8. Export New Types
**File**: `apps/coding-agent/src/hooks/index.ts`

**Add to exports**:
```typescript
export type { 
  CompactBeforeEvent, 
  CompactAfterEvent, 
  CompactBeforeResult 
} from "./types.js"
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun test
```

**Manual**:
- [ ] Create hook returning `{ cancel: true }` on `compact.before`, verify `/compact` is cancelled
- [ ] Create hook returning `{ summary: "custom" }`, verify custom summary used without LLM call
- [ ] Verify `compact.after` fires with correct `fromHook` value
- [ ] Verify normal compaction still works when no hooks installed

---

## Testing Strategy

### Unit Tests to Add

**File**: `apps/coding-agent/tests/hooks.test.ts`

```typescript
describe("hook enhancements", () => {
  describe("hookTimeout config", () => {
    it("should use configured timeout", async () => {
      // Test HookRunner uses passed timeout
    });
    
    it("should default to 30000ms", async () => {
      // Test default when not configured
    });
  });
  
  describe("send with attachments", () => {
    it("should pass attachments through SendHandler", async () => {
      // Mock SendHandler, verify attachments received
    });
  });
  
  describe("model.change event", () => {
    it("should emit on model cycle", async () => {
      // Capture emitted event, verify fields
    });
  });
  
  describe("session.before_clear", () => {
    it("should cancel clear when hook returns cancel: true", async () => {
      // Verify clear doesn't happen
    });
    
    it("should proceed when hook returns undefined", async () => {
      // Verify clear happens
    });
  });
  
  describe("compact.before/after", () => {
    it("should cancel when hook returns cancel: true", async () => {
      // Verify error thrown
    });
    
    it("should use hook summary when provided", async () => {
      // Verify LLM not called, custom summary used
    });
    
    it("should emit compact.after with fromHook: true for hook summary", async () => {
      // Verify flag
    });
    
    it("should emit compact.after with fromHook: false for LLM summary", async () => {
      // Verify flag
    });
  });
});
```

### Manual Testing Checklist

1. [ ] **Hook timeout**: Set `hookTimeout: 1000` in config, create slow hook, verify timeout error
2. [ ] **Attachments**: Create hook that sends image attachment, verify image in conversation
3. [ ] **Model change**: Cycle with Ctrl+P, verify hook receives previous/new model info
4. [ ] **Session cancel**: Hook cancels `/clear`, verify message and session preserved
5. [ ] **Compact cancel**: Hook cancels `/compact`, verify error message
6. [ ] **Custom compact**: Hook provides summary, verify no LLM call made

---

## Anti-Patterns to Avoid

- **Don't make compact.before timeout** — custom summarization may call LLMs
- **Don't block on emit() for compact.after** — use `void` to fire-and-forget
- **Don't forget fromHook flag** — needed for debugging/observability
- **Don't break existing SendHandler signature** — attachments must be optional

## Open Questions

- [x] Does marvin have branching? → No, so skip `before_branch`
- [x] Does marvin have session switching? → Only at startup, so skip `before_resume`
- [x] Is `handleCompactCmd` already async? → Need to verify (likely yes since it awaits `doCompact`)

## References

- Hook types: `apps/coding-agent/src/hooks/types.ts`
- Hook runner: `apps/coding-agent/src/hooks/runner.ts`
- Compaction: `apps/coding-agent/src/compact-handler.ts`
- Commands: `apps/coding-agent/src/commands.ts`
- Config: `apps/coding-agent/src/config.ts`
- TUI app: `apps/coding-agent/src/tui-app.tsx`
- pi-mono reference: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/hooks/`

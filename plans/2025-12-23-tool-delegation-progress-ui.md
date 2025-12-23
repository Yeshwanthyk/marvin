# Tool Delegation Progress UI Implementation Plan

## Overview
Add a generic, opt-in “agent delegation” UI contract for tool results so *any* custom tool (single/parallel/chain) can render a clean step list and stream live progress in the TUI, without per-tool renderers or tool-name special-casing.

## Current State

### Key Discoveries
- Tool streaming exists end-to-end:
  - `AgentTool.execute(..., onUpdate?)` supports progress updates (`packages/ai/src/agent/types.ts`).
  - `agent-loop` forwards those updates as `tool_execution_update` events (`packages/ai/src/agent/agent-loop.ts`).
  - TUI handles them in `handleToolUpdateImmediate` (`apps/coding-agent/src/agent-events.ts:448`).
- TUI currently treats progress as “text only”:
  - `handleToolUpdateImmediate` sets `ToolBlock.output = getToolText(partialResult)` (`apps/coding-agent/src/agent-events.ts:452`).
  - `getToolText` extracts only `content[].text` and ignores `details` (`apps/coding-agent/src/utils.ts:59`).
- Tool UI caching prevents detail-only updates from rendering:
  - `buildContentItems` tool cache equality only checks `tool.output` and `tool.isComplete` (`apps/coding-agent/src/components/MessageList.tsx:163`).
  - If a tool streams progress in `details` but leaves `content[].text` empty, `output` stays `""` → UI stops re-rendering.
- Tool rendering fallback ignores `result.details`:
  - Unknown/custom tools use fallback renderer that shows `output` or JSON args (`apps/coding-agent/src/tui-open-rendering.tsx:306`).
  - There is tool-name special-casing for `"subagent"` in `toolTitle` (`apps/coding-agent/src/tui-open-rendering.tsx:92`). This does not generalize.

### Constraints
- No per-tool “first-class renderer” keyed by tool name.
- Must stay safe/defensive: malformed tool output must not crash the TUI.
- Keep updates efficient: tool updates are throttled to 50ms (`TOOL_UPDATE_THROTTLE_MS`) (`apps/coding-agent/src/agent-events.ts`).

## Desired End State
- Any tool can optionally expose an “agent delegation” UI model via `result.details.ui.kind === "agent_delegation"`.
- TUI renders:
  - A compact, readable step list for `single | parallel | chain`.
  - Live status updates (`pending/running/ok/error`) when streamed via `tool_execution_update`.
  - A safe fallback when no UI model is provided.
- Tool updates re-render even when `content[].text` does not change.
- Tool-name special casing removed (the UI is driven by *shape*, not tool name).

## Out of Scope
- Editing user-local tools under `~/.config/marvin/tools/` in this repo.
  - This plan includes a “tool author snippet” to adopt the streaming UI contract.

## Error Handling Strategy
- Implement strict runtime type guards for both:
  - Delegation **args shape** (so we can show a clean step list immediately, even without streaming).
  - Delegation **details UI contract** (for live progress).
- If type guard fails: fall back to existing rendering (`output` or JSON args).
- Clamp rendering size:
  - Max items rendered when collapsed: 8
  - Max items rendered when expanded: 50
  - Task and preview truncation: first line only, then `…`.

## Implementation Approach
- Introduce a small UI contract module (`tool-ui-contracts.ts`) with type guards.
- Make tool streaming updates always invalidate the MessageList cache via an internal monotonic `updateSeq` counter.
- Update the generic ToolBlock fallback renderer to:
  1) Prefer `details.ui.kind === "agent_delegation"` (live progress)
  2) Else render from args if args match delegation shape (static plan)
  3) Else render current fallback (output/args JSON)

Alternative considered: stringify `details` into `output` to force rerenders. Rejected: mixes concerns, noisy, and risks huge outputs.

---

## Phase 1: Ensure Tool Updates Re-render (Cache Invalidation)

### Overview
Fix the root cause where `tool_execution_update` changes to `result.details` don’t re-render because `buildContentItems` only compares `tool.output`.

### Changes

- [x] Add `updateSeq` to `ToolBlock`
- [x] Increment `updateSeq` on tool streaming updates
- [x] Include `updateSeq` in MessageList tool cache equality

#### 1. Add `updateSeq` to `ToolBlock`
**File**: `apps/coding-agent/src/types.ts`
**Lines**: 30-45

**Before**:
```ts
export interface ToolBlock {
	id: string
	name: string
	args: unknown
	output?: string
	editDiff?: string
	isError: boolean
	isComplete: boolean
	// Custom tool metadata
	label?: string
	source?: "builtin" | "custom"
	sourcePath?: string
	result?: AgentToolResult<any>
	renderCall?: (args: any, theme: Theme) => JSX.Element
	renderResult?: (result: AgentToolResult<any>, opts: RenderResultOptions, theme: Theme) => JSX.Element
}
```

**After**:
```ts
export interface ToolBlock {
	id: string
	name: string
	args: unknown
	/** Monotonic counter to invalidate UI caches on tool updates */
	updateSeq?: number
	output?: string
	editDiff?: string
	isError: boolean
	isComplete: boolean
	// Custom tool metadata
	label?: string
	source?: "builtin" | "custom"
	sourcePath?: string
	result?: AgentToolResult<any>
	renderCall?: (args: any, theme: Theme) => JSX.Element
	renderResult?: (result: AgentToolResult<any>, opts: RenderResultOptions, theme: Theme) => JSX.Element
}
```

#### 2. Increment `updateSeq` on tool streaming updates
**File**: `apps/coding-agent/src/agent-events.ts`
**Lines**: 415-470

**Before** (excerpt):
```ts
const newTool: ToolBlock = {
	id: event.toolCallId,
	name: event.toolName,
	args: event.args,
	isError: false,
	isComplete: false,
	// Attach metadata for custom rendering
	label: meta?.label,
	source: meta?.source,
	sourcePath: meta?.sourcePath,
	renderCall: meta?.renderCall,
	renderResult: meta?.renderResult,
}

...

? { ...t, output: getToolText(event.partialResult), result: event.partialResult }
```

**After**:
```ts
const newTool: ToolBlock = {
	id: event.toolCallId,
	name: event.toolName,
	args: event.args,
	updateSeq: 0,
	isError: false,
	isComplete: false,
	// Attach metadata for custom rendering
	label: meta?.label,
	source: meta?.source,
	sourcePath: meta?.sourcePath,
	renderCall: meta?.renderCall,
	renderResult: meta?.renderResult,
}

...

? {
	...t,
	updateSeq: (t.updateSeq ?? 0) + 1,
	output: getToolText(event.partialResult),
	result: event.partialResult,
}
```

#### 3. Include `updateSeq` in MessageList tool cache equality
**File**: `apps/coding-agent/src/components/MessageList.tsx`
**Lines**: 159-170, 191-203, 218-231

Apply the same change in three places (contentBlocks tools, legacy tools, orphan tools).

**Before** (one occurrence):
```ts
getCachedItem(`tool:${block.tool.id}:${block.tool.isComplete}`, item, (a, b) =>
	a.type === "tool" && b.type === "tool" &&
	a.tool.id === b.tool.id && a.tool.isComplete === b.tool.isComplete &&
	a.tool.output === b.tool.output
)
```

**After**:
```ts
getCachedItem(`tool:${block.tool.id}:${block.tool.isComplete}`, item, (a, b) =>
	a.type === "tool" && b.type === "tool" &&
	a.tool.id === b.tool.id && a.tool.isComplete === b.tool.isComplete &&
	a.tool.output === b.tool.output &&
	(a.tool.updateSeq ?? 0) === (b.tool.updateSeq ?? 0)
)
```

### Success Criteria
**Automated**:
```bash
bun test apps/coding-agent/tests/agent-events.test.ts
bun run typecheck
```

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/types.ts apps/coding-agent/src/agent-events.ts apps/coding-agent/src/components/MessageList.tsx
```

---

## Phase 2: Define Delegation UI Contract (Type Guards)

### Overview
Create a single source of truth for “this tool represents delegated agent tasks” based on either args-shape or explicit UI details.

### Changes

- [x] Add contract module (`tool-ui-contracts.ts`)

#### 1. Add contract module
**File**: `apps/coding-agent/src/tool-ui-contracts.ts`
**Lines**: new file

**Add**:
```ts
export type DelegationMode = "single" | "parallel" | "chain"
export type DelegationStatus = "pending" | "running" | "ok" | "error"

export interface AgentDelegationUiItem {
	id: string
	agent: string
	task: string
	status: DelegationStatus
	preview?: string
}

export interface AgentDelegationUi {
	kind: "agent_delegation"
	mode: DelegationMode
	items: AgentDelegationUiItem[]
	activeId?: string
}

export interface AgentDelegationArgs {
	agent?: string
	task?: string
	tasks?: Array<{ agent: string; task: string }>
	chain?: Array<{ agent: string; task: string }>
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

export function getAgentDelegationArgs(args: unknown): AgentDelegationArgs | null {
	if (!isRecord(args)) return null
	const agent = typeof args.agent === "string" ? args.agent : undefined
	const task = typeof args.task === "string" ? args.task : undefined
	const tasks = Array.isArray(args.tasks) ? args.tasks : undefined
	const chain = Array.isArray(args.chain) ? args.chain : undefined

	const isTaskItem = (v: unknown): v is { agent: string; task: string } =>
		isRecord(v) && typeof v.agent === "string" && typeof v.task === "string"

	const normTasks = tasks?.every(isTaskItem) ? tasks : undefined
	const normChain = chain?.every(isTaskItem) ? chain : undefined

	if (normChain || normTasks || (agent && task)) return { agent, task, tasks: normTasks, chain: normChain }
	return null
}

export function getAgentDelegationUi(details: unknown): AgentDelegationUi | null {
	if (!isRecord(details)) return null
	if (!isRecord(details.ui)) return null
	if (details.ui.kind !== "agent_delegation") return null

	const ui = details.ui as Record<string, unknown>
	const mode = ui.mode
	if (mode !== "single" && mode !== "parallel" && mode !== "chain") return null
	if (!Array.isArray(ui.items)) return null

	const isStatus = (s: unknown): s is DelegationStatus => s === "pending" || s === "running" || s === "ok" || s === "error"
	const items: AgentDelegationUiItem[] = []
	for (const raw of ui.items) {
		if (!isRecord(raw)) return null
		if (typeof raw.id !== "string" || typeof raw.agent !== "string" || typeof raw.task !== "string") return null
		if (!isStatus(raw.status)) return null
		items.push({
			id: raw.id,
			agent: raw.agent,
			task: raw.task,
			status: raw.status,
			preview: typeof raw.preview === "string" ? raw.preview : undefined,
		})
	}

	return {
		kind: "agent_delegation",
		mode,
		items,
		activeId: typeof ui.activeId === "string" ? ui.activeId : undefined,
	}
}
```

### Success Criteria
```bash
bun run typecheck
```

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/tool-ui-contracts.ts
```

---

## Phase 3: Generic Rendering in `ToolBlock` (Args + Live UI)

### Overview
Render a clean step list for any tool that matches the delegation args schema, and upgrade to live status rendering when the tool streams `details.ui.kind = "agent_delegation"`.

### Changes

- [x] Remove tool-name special-casing in `toolTitle`
- [x] Add delegation imports + helper renderer
- [x] Thread `result` into fallback renderer

#### 1. Remove tool-name special-casing in `toolTitle`
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`
**Lines**: 92-114

**Before**:
```ts
function toolTitle(name: string, args: any): string {
	switch (name) {
		case "bash": {
			const cmd = String(args?.command || "…")
			return cmd.split("\n")[0] || "…"
		}
		case "read":
			return shortenPath(String(args?.path || args?.file_path || "…"))
		case "write":
			return shortenPath(String(args?.path || args?.file_path || "…"))
		case "edit":
			return shortenPath(String(args?.path || args?.file_path || "…"))
		case "subagent": {
			// Show mode and agent info
			if (args?.chain?.length > 0) return `chain (${args.chain.length} steps)`
			if (args?.tasks?.length > 0) return `parallel (${args.tasks.length} tasks)`
			if (args?.agent) return args.agent
			return ""
		}
		default:
			return ""
	}
}
```

**After**:
```ts
function toolTitle(name: string, args: any): string {
	switch (name) {
		case "bash": {
			const cmd = String(args?.command || "…")
			return cmd.split("\n")[0] || "…"
		}
		case "read":
			return shortenPath(String(args?.path || args?.file_path || "…"))
		case "write":
			return shortenPath(String(args?.path || args?.file_path || "…"))
		case "edit":
			return shortenPath(String(args?.path || args?.file_path || "…"))
		default: {
			const delegation = getAgentDelegationArgs(args)
			if (delegation?.chain?.length) return `chain (${delegation.chain.length} steps)`
			if (delegation?.tasks?.length) return `parallel (${delegation.tasks.length} tasks)`
			if (delegation?.agent) return delegation.agent
			return ""
		}
	}
}
```

#### 2. Add delegation imports + helper renderer
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`

Add import directly below existing local imports:
```ts
import { getAgentDelegationArgs, getAgentDelegationUi, type AgentDelegationArgs, type AgentDelegationUi, type DelegationStatus } from "./tool-ui-contracts.js"
```

Add helper functions + view near other helper components (after `DiffPreview` is a good spot):
```ts
const delegationOkColor = diffAddedColor

function firstLine(s: string): string {
	return s.split("\n")[0] || ""
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s
	return s.slice(0, Math.max(0, max - 1)) + "…"
}

function delegationSymbol(status: DelegationStatus | "unknown"): string {
	switch (status) {
		case "running":
			return "◌"
		case "pending":
			return "○"
		case "ok":
			return "✓"
		case "error":
			return "✕"
		default:
			return "·"
	}
}

function delegationColor(theme: Theme, status: DelegationStatus | "unknown"): string {
	if (status === "error") return theme.error
	if (status === "ok") return delegationOkColor
	if (status === "running") return theme.accent
	return theme.textMuted
}

function formatDelegationSuffix(ui: AgentDelegationUi): string {
	const ok = ui.items.filter((i) => i.status === "ok").length
	const err = ui.items.filter((i) => i.status === "error").length
	const total = ui.items.length
	if (err > 0) return `${ok} ok · ${err} err / ${total}`
	return `${ok} ok / ${total}`
}

function AgentDelegationView(props: {
	args: AgentDelegationArgs | null
	ui: AgentDelegationUi | null
	expanded: boolean
}): JSX.Element {
	const { theme } = useTheme()
	const maxItems = props.expanded ? 50 : 8

	const rows = () => {
		if (props.ui) {
			return props.ui.items.slice(0, maxItems).map((item) => ({
				id: item.id,
				agent: item.agent,
				task: item.task,
				status: item.status as DelegationStatus | "unknown",
				preview: item.preview,
				active: props.ui?.activeId === item.id,
			}))
		}
		if (props.args?.chain?.length) {
			return props.args.chain.slice(0, maxItems).map((item, idx) => ({
				id: String(idx + 1),
				agent: item.agent,
				task: item.task,
				status: "unknown" as const,
				preview: undefined,
				active: false,
			}))
		}
		if (props.args?.tasks?.length) {
			return props.args.tasks.slice(0, maxItems).map((item, idx) => ({
				id: String(idx + 1),
				agent: item.agent,
				task: item.task,
				status: "unknown" as const,
				preview: undefined,
				active: false,
			}))
		}
		if (props.args?.agent && props.args?.task) {
			return [{
				id: "1",
				agent: props.args.agent,
				task: props.args.task,
				status: "unknown" as const,
				preview: undefined,
				active: false,
			}]
		}
		return []
	}

	return (
		<box flexDirection="column" backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
			{rows().map((row) => (
				<box flexDirection="column" gap={0}>
					<box flexDirection="row" gap={1}>
						<text selectable={false} fg={delegationColor(theme, row.status)}>{delegationSymbol(row.status)}</text>
						<text fg={row.active ? theme.accent : theme.text}>{truncate(row.agent, 24)}</text>
						<text fg={theme.textMuted}>{truncate(firstLine(row.task), 80)}</text>
					</box>
					<Show when={props.expanded && row.preview}>
						<box paddingLeft={2}>
							<text fg={theme.textMuted}>{truncate(firstLine(String(row.preview)), 120)}</text>
						</box>
					</Show>
				</box>
			))}
			<Show when={props.ui && props.ui.items.length > maxItems}>
				<text fg={theme.textMuted}>… {props.ui!.items.length - maxItems} more …</text>
			</Show>
			<Show when={!props.ui && ((props.args?.chain?.length ?? 0) > maxItems || (props.args?.tasks?.length ?? 0) > maxItems)}>
				<text fg={theme.textMuted}>… more …</text>
			</Show>
		</box>
	)
}
```

#### 3. Thread `result` into `ToolRenderContext` and use it in fallback renderer
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`

Update `ToolRenderContext`:

**Before**:
```ts
interface ToolRenderContext {
	name: string
	args: any
	output: string | null
	editDiff: string | null
	isError: boolean
	isComplete: boolean
	expanded: boolean
	diffWrapMode: "word" | "none"
}
```

**After**:
```ts
interface ToolRenderContext {
	name: string
	args: any
	output: string | null
	editDiff: string | null
	result: ToolBlockProps["result"] | null
	isError: boolean
	isComplete: boolean
	expanded: boolean
	diffWrapMode: "word" | "none"
}
```

Update `ctx` creation:

**Before**:
```ts
const ctx: ToolRenderContext = {
	name: props.name,
	args: props.args,
	output: props.output,
	editDiff: props.editDiff,
	isError: props.isError,
	isComplete: props.isComplete,
	get expanded() { return props.expanded ?? false },
	get diffWrapMode() { return props.diffWrapMode ?? "word" },
}
```

**After**:
```ts
const ctx: ToolRenderContext = {
	name: props.name,
	args: props.args,
	output: props.output,
	editDiff: props.editDiff,
	result: props.result ?? null,
	isError: props.isError,
	isComplete: props.isComplete,
	get expanded() { return props.expanded ?? false },
	get diffWrapMode() { return props.diffWrapMode ?? "word" },
}
```

Update default header to include progress suffix when live UI is present:

**Before**:
```ts
function defaultHeader(ctx: ToolRenderContext): JSX.Element {
	const title = toolTitle(ctx.name, ctx.args)
	return <ToolHeader label={ctx.name} detail={title} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
}
```

**After**:
```ts
function defaultHeader(ctx: ToolRenderContext): JSX.Element {
	const title = toolTitle(ctx.name, ctx.args)
	const delegationUi = getAgentDelegationUi(ctx.result?.details)
	const suffix = delegationUi ? formatDelegationSuffix(delegationUi) : undefined
	return <ToolHeader label={ctx.name} detail={title} suffix={suffix} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
}
```

Update fallback renderer to show delegation view:

**Before**:
```ts
const renderer = registry[props.name] ?? {
	mode: () => "block",
	renderBody: (innerCtx) => {
		const out = innerCtx.output ? innerCtx.output : JSON.stringify(innerCtx.args ?? {}, null, 2)
		const rendered = innerCtx.expanded ? replaceTabs(out) : truncateLines(out, 20).text
		return <CodeBlock content={rendered} filetype="text" title="output" showLineNumbers={false} />
	},
}
```

**After**:
```ts
const renderer = registry[props.name] ?? {
	mode: () => "block",
	renderBody: (innerCtx) => {
		const delegationUi = getAgentDelegationUi(innerCtx.result?.details)
		const delegationArgs = getAgentDelegationArgs(innerCtx.args)

		if (delegationUi || delegationArgs) {
			return <AgentDelegationView args={delegationArgs} ui={delegationUi} expanded={innerCtx.expanded} />
		}

		const out = innerCtx.output ? innerCtx.output : JSON.stringify(innerCtx.args ?? {}, null, 2)
		const rendered = innerCtx.expanded ? replaceTabs(out) : truncateLines(out, 20).text
		return <CodeBlock content={rendered} filetype="text" title="output" showLineNumbers={false} />
	},
}
```

### Success Criteria
**Manual**
- Invoke any custom tool with args `{ chain: [...] }` and confirm the body shows a step list instead of JSON.
- Invoke any tool that streams `details.ui.kind = "agent_delegation"` and confirm live status updates repaint.

**Automated**
```bash
bun run typecheck
```

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/tui-open-rendering.tsx
```

---

## Phase 4: Tests

- [x] Add `tool_execution_update` updateSeq test
- [x] Add tool-ui-contracts guard tests

### 1. Agent events: `tool_execution_update` increments `updateSeq`
**File**: `apps/coding-agent/tests/agent-events.test.ts`

Add this test (new `describe("tool_execution_update", ...)` block):

```ts
	describe("tool_execution_update", () => {
		it("increments updateSeq even when output is empty", async () => {
			const messages: any[] = []
			const toolBlocks: any[] = []

			const ctx: EventHandlerContext = {
				setMessages: mock((updater) => {
					const next = updater(messages as any)
					messages.length = 0
					messages.push(...next)
				}),
				setToolBlocks: mock((updater) => {
					const next = updater(toolBlocks as any)
					toolBlocks.length = 0
					toolBlocks.push(...next)
				}),
				setActivityState: mock(() => {}),
				setIsResponding: mock(() => {}),
				setContextTokens: mock(() => {}),
				setRetryStatus: mock(() => {}),

				queuedMessages: [],
				setQueueCount: mock(() => {}),

				sessionManager: { appendMessage: mock(() => {}) } as any,
				streamingMessageId: { current: "test-id" },

				retryConfig: { enabled: false, maxRetries: 3, baseDelayMs: 2000 },
				retryablePattern: /overloaded/i,
				retryState: { attempt: 0, abortController: null },

				agent: {
					state: { messages: [] },
					replaceMessages: mock(() => {}),
					continue: mock(async () => {}),
				},
			}

			const handler = createAgentEventHandler(ctx)

			handler({
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "custom",
				args: {},
			} as AgentEvent)

			handler({
				type: "tool_execution_update",
				toolCallId: "tool-1",
				toolName: "custom",
				args: {},
				partialResult: { content: [], details: { ui: { kind: "agent_delegation", mode: "single", items: [] } } },
			} as AgentEvent)

			await new Promise((r) => setTimeout(r, 80))

			handler({
				type: "tool_execution_update",
				toolCallId: "tool-1",
				toolName: "custom",
				args: {},
				partialResult: { content: [], details: { ui: { kind: "agent_delegation", mode: "single", items: [] } } },
			} as AgentEvent)

			await new Promise((r) => setTimeout(r, 80))

			expect(toolBlocks.length).toBe(1)
			expect(toolBlocks[0].id).toBe("tool-1")
			expect(toolBlocks[0].updateSeq).toBe(2)
		})
	})
```

### 2. Contracts: type guards accept/reject correctly
**File**: `apps/coding-agent/tests/tool-ui-contracts.test.ts` (new)

**Add**:
```ts
import { describe, expect, it } from "bun:test"
import { getAgentDelegationArgs, getAgentDelegationUi } from "../src/tool-ui-contracts.js"

describe("tool-ui-contracts", () => {
	it("accepts delegation args (chain)", () => {
		expect(getAgentDelegationArgs({ chain: [{ agent: "a", task: "t" }] })).not.toBeNull()
	})

	it("rejects invalid delegation args", () => {
		expect(getAgentDelegationArgs({ chain: ["x"] })).toBeNull()
	})

	it("accepts delegation ui", () => {
		const details = {
			ui: {
				kind: "agent_delegation",
				mode: "chain",
				items: [{ id: "1", agent: "a", task: "t", status: "running" }],
			},
		}
		expect(getAgentDelegationUi(details)).not.toBeNull()
	})

	it("rejects invalid delegation ui", () => {
		const details = {
			ui: {
				kind: "agent_delegation",
				mode: "chain",
				items: [{ id: "1", agent: "a", task: "t", status: "bogus" }],
			},
		}
		expect(getAgentDelegationUi(details)).toBeNull()
	})
})
```

### Success Criteria
```bash
bun test apps/coding-agent/tests/agent-events.test.ts
bun test apps/coding-agent/tests/tool-ui-contracts.test.ts
bun run check
```

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/tests/agent-events.test.ts apps/coding-agent/tests/tool-ui-contracts.test.ts
```

---

## Tool Author Adoption Snippet (for custom tools)
To get *live* step progress (not just a static list), a tool must call the `onUpdate` callback.

Inside a custom tool’s `execute`:
```ts
async execute(toolCallId, params, signal, onUpdate) {
	// publish plan immediately
	onUpdate?.({
		content: [],
		details: {
			ui: {
				kind: "agent_delegation",
				mode: "chain",
				items: params.chain.map((step, i) => ({
					id: String(i + 1),
					agent: step.agent,
					task: step.task,
					status: i === 0 ? "running" : "pending",
				})),
				activeId: "1",
			},
		},
	})

	// ... emit updates as steps start/end
}
```

---

## Anti-Patterns to Avoid
- Don’t key `itemCache` by `updateSeq` (would leak keys); keep key stable and compare `updateSeq` in equality.
- Don’t stringify full `details` for display; only render the structured contract or fall back to args/output.

## References
- Tool update plumbing: `packages/ai/src/agent/types.ts`, `packages/ai/src/agent/agent-loop.ts`
- UI tool update handler: `apps/coding-agent/src/agent-events.ts:448`
- Tool caching: `apps/coding-agent/src/components/MessageList.tsx:163`
- Tool fallback renderer: `apps/coding-agent/src/tui-open-rendering.tsx:306`

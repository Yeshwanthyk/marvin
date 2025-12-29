# Ask User Question TUI Implementation Plan

## Plan Metadata
- Created: 2025-12-28
- Ticket: none
- Status: draft
- Owner: none
- Assumptions: TUI-only tool, no headless support, tool name `ask_user_question`, questions keyed by `header`
- Reviewed: 2025-12-28 — hardened for race conditions, component availability, UX polish

## Progress Tracking
- [x] Phase 1: Tool definition and validation helpers
- [x] Phase 2: TUI modal and tool wiring
- [x] Phase 3: Tests and verification

## Known Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Concurrent tool calls orphan promises | 🔴 Critical | Reject if dialog already open |
| `Input` component doesn't exist | 🔴 Critical | Use `<textarea>` with single-line styling |
| Pre-filled answers not reflected in UI | 🟡 Medium | Parse answer string → pre-select options |
| Error text invisible | 🟢 Low | Add `fg={theme.error}` |
| Single/multi-select visual confusion | 🟢 Low | Use `(•)`/`( )` for single, `[x]`/`[ ]` for multi |
| No progress indicator | 🟢 Low | Title shows "1/4: Header" |
| User can't go back | 🟢 Low | Out of scope for v1, document as limitation |

## Overview
Add a TUI-only internal `ask_user_question` tool that opens a modal dialog to collect structured answers and returns a deterministic summary to the model.

## Current State
TUI builds its tool list from `codingTools` plus custom tools and uses tool metadata for rendering. Headless mode only registers `codingTools` plus custom tools. There is no structured ask-user tool or UI dialog.

### Key Discoveries
- TUI tool assembly happens in `apps/coding-agent/src/tui-app.tsx:86`:

```typescript
const { tools: customTools, errors: toolErrors } = await loadCustomTools(
	loaded.configDir,
	cwd,
	getToolNames(codingTools),
	toolSendRef,
)

const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)]
```

- Tool rendering supports per-tool custom renderers in `apps/coding-agent/src/tui-open-rendering.tsx:483`:

```typescript
const tryCustomRenderResult = (): JSX.Element | null => {
	if (!props.renderResult || !props.result) return null
	try {
		return props.renderResult(props.result, { expanded: props.expanded ?? false, isPartial: !props.isComplete }, theme)
	} catch {
		return null
	}
}
```

- Headless uses only `codingTools` in `apps/coding-agent/src/headless.ts:98`:

```typescript
const { tools: customTools, errors: toolErrors } = await loadCustomTools(
	loaded.configDir,
	cwd,
	getToolNames(codingTools),
)

const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)]
```

- Test style is `bun:test` in `apps/coding-agent/tests/tool-ui-contracts.test.ts:1`:

```typescript
import { describe, expect, it } from "bun:test"

it("accepts delegation args (chain)", () => {
	expect(getAgentDelegationArgs({ chain: [{ agent: "a", task: "t" }] })).not.toBeNull()
})
```

## Desired End State
- `ask_user_question` is available in TUI and opens a modal to collect answers.
- Validation enforces the stated constraints (question count, option count, header length, label word count, no `Other` option provided by caller).
- Tool output includes a deterministic, ordered summary in `content` and structured answers in `details`.
- Headless does not register this tool.

### Verification
- Automated: `bun run typecheck` and `bun test apps/coding-agent/tests/ask-user-question.test.ts`
- Manual: Run TUI, trigger a tool call with 2 questions, select options (including Other), verify answers reflected in tool output.

## Out of Scope
- Headless support or fallback prompting
- ACP protocol integration
- External tool plugin support

## Known Limitations (v1)
- **No back navigation**: User cannot return to previous questions; must cancel and restart.
- **No timeout**: Dialog stays open indefinitely; agent loop blocked until answered.
- **Answer parsing heuristic**: Pre-filled answers parsed by comma-split; edge cases possible.
- **Single concurrent dialog**: Only one `ask_user_question` can be active at a time.

## Breaking Changes
- None. New tool name only in TUI.

## Dependency and Configuration Changes

### Additions
```bash
# none
```
**Why needed**: none

### Updates
```bash
# none
```
**Breaking changes**: none

### Removals
```bash
# none
```
**Replacement**: none

### Configuration Changes
**File**: none

**Before**:
```json
{}
```

**After**:
```json
{}
```
**Impact**: none

## Error Handling Strategy
- Invalid tool arguments: throw with explicit validation message; tool result becomes `isError: true` with text error.
- User cancels dialog or tool is aborted: close dialog and throw `AskUserQuestion cancelled` so the model can choose how to proceed.
- Unexpected exceptions: surface as tool error with message in content.

## Implementation Approach
Use a ref-based controller that bridges tool execution to the TUI modal without touching agent-core. Tool args are validated via TypeBox + custom rules. The modal is a small state machine (question index, selection set, optional Other text) built with `Dialog`, `SelectList`, and `Input`.

## Phase Dependencies and Parallelization
- Dependencies: Phase 2 depends on Phase 1; Phase 3 depends on Phase 2.
- Parallelizable: none.
- Suggested @agents: none.

---

## Phase 1: Tool Definition and Validation Helpers

### Overview
Create the tool schema, types, validation, and output formatting in a new internal tool module.

### Prerequisites
- [ ] Phase outline approved
- [ ] Open Questions resolved

### Change Checklist
- [ ] Add `ask_user_question` tool definition with schema
- [ ] Add validation helpers for constraints not expressible in JSON schema
- [ ] Add output formatter to produce deterministic summary

### Changes

#### 1. Add tool module
**File**: `apps/coding-agent/src/tools/ask-user-question.ts`
**Location**: new file

**After**:
```typescript
import type { AgentTool } from "@marvin-agents/ai"
import { Type, type Static } from "@sinclair/typebox"

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question"
export const OTHER_OPTION_LABEL = "Other"

const optionSchema = Type.Object({
	label: Type.String({ minLength: 1, description: "Display text (1-5 words)" }),
	description: Type.String({ minLength: 1, description: "Explanation of choice" }),
})

const questionSchema = Type.Object({
	question: Type.String({ minLength: 1, description: "Question text ending with ?" }),
	header: Type.String({ minLength: 1, maxLength: 12, description: "Short label" }),
	multiSelect: Type.Boolean({ description: "Allow multiple selections" }),
	options: Type.Array(optionSchema, { minItems: 2, maxItems: 4 }),
})

const askUserQuestionSchema = Type.Object({
	questions: Type.Array(questionSchema, { minItems: 1, maxItems: 4 }),
	answers: Type.Optional(Type.Record(Type.String(), Type.String())),
})

export type AskUserQuestionArgs = Static<typeof askUserQuestionSchema>
export type AskUserQuestionAnswers = Record<string, string>

export interface AskUserQuestionRef {
	current: (args: AskUserQuestionArgs, signal?: AbortSignal) => Promise<AskUserQuestionAnswers>
}

export function validateAskUserQuestionArgs(args: AskUserQuestionArgs): string | null {
	const headers = new Set<string>()
	for (const question of args.questions) {
		if (!question.question.trim().endsWith("?")) {
			return `Question must end with ?: ${question.header}`
		}
		if (headers.has(question.header)) {
			return `Duplicate header: ${question.header}`
		}
		headers.add(question.header)

		for (const option of question.options) {
			const label = option.label.trim()
			const words = label.split(/\s+/).filter(Boolean)
			if (words.length < 1 || words.length > 5) {
				return `Option label must be 1-5 words: ${label}`
			}
			if (label.toLowerCase() === OTHER_OPTION_LABEL.toLowerCase()) {
				return `Option label "Other" is reserved`
			}
		}
	}

	if (args.answers) {
		for (const key of Object.keys(args.answers)) {
			if (!headers.has(key)) return `Unknown answers key: ${key}`
		}
	}

	return null
}

export function formatAskUserQuestionOutput(questions: AskUserQuestionArgs["questions"], answers: AskUserQuestionAnswers): string {
	const lines = questions.map((q) => `- ${q.header}: ${answers[q.header] ?? ""}`)
	const json = JSON.stringify({ answers }, null, 2)
	return ["Collected answers:", ...lines, "", "JSON:", json].join("\n")
}

export function createAskUserQuestionTool(ref: AskUserQuestionRef): AgentTool<typeof askUserQuestionSchema> {
	return {
		name: ASK_USER_QUESTION_TOOL_NAME,
		label: ASK_USER_QUESTION_TOOL_NAME,
		description: "Ask user questions with structured multiple-choice options.",
		parameters: askUserQuestionSchema,
		execute: async (_toolCallId, args, signal) => {
			const error = validateAskUserQuestionArgs(args)
			if (error) throw new Error(error)
			if (signal?.aborted) throw new Error("Operation aborted")

			const answers = await ref.current(args, signal)
			const text = formatAskUserQuestionOutput(args.questions, answers)

			return {
				content: [{ type: "text", text }],
				details: { answers },
			}
		},
	}
}
```

**Why**: Establish a stable schema, validation logic, and a deterministic output format the model can consume.

### Edge Cases to Handle
- [ ] Question text missing `?` -> validation error
- [ ] Duplicate headers -> validation error
- [ ] Option label word count > 5 -> validation error
- [ ] Caller includes `Other` option -> validation error

### Success Criteria

**Automated** (run after each change, must pass before committing):
```bash
bun run typecheck
```

**Before proceeding to next phase**:
```bash
bun run typecheck
```

**Manual**:
- [ ] N/A (no UI yet)

### Rollback
If this phase fails after partial completion:
```bash
git restore -- apps/coding-agent/src/tools/ask-user-question.ts
```

### Notes
- Keep types in this file so both tool and UI can import them without circular dependencies.

---

## Phase 2: TUI Modal and Tool Wiring

### Overview
Add the modal UI, wire the tool into the TUI-only tool list, and bridge tool execution to the dialog via a ref.

### Prerequisites
- [ ] Phase 1 automated checks pass
- [ ] Phase 1 manual verification complete

### Change Checklist
- [ ] Wire `ask_user_question` into TUI tools and built-in name list
- [ ] Update tool metadata registry to include the new built-in tool
- [ ] Add dialog component and modal state in `MainView`
- [ ] Block textarea input while dialog is open
- [ ] Show a tool header suffix with question count

### Changes

#### 1. Register tool and ref in TUI
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: imports + tool setup + App/MainView props

**Before**:
```typescript
import { codingTools } from "@marvin-agents/base-tools"
import { loadCustomTools, getToolNames, type SendRef } from "./custom-tools/index.js"

const { tools: customTools, errors: toolErrors } = await loadCustomTools(
	loaded.configDir,
	cwd,
	getToolNames(codingTools),
	toolSendRef,
)

const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)]
```

**After**:
```typescript
import { codingTools } from "@marvin-agents/base-tools"
import { loadCustomTools, getToolNames, type SendRef } from "./custom-tools/index.js"
import { AskUserQuestionDialog } from "./components/AskUserQuestionDialog.js"
import {
	createAskUserQuestionTool,
	type AskUserQuestionRef,
	type AskUserQuestionArgs,
	type AskUserQuestionAnswers,
} from "./tools/ask-user-question.js"

const askUserQuestionRef: AskUserQuestionRef = {
	current: async () => {
		throw new Error("AskUserQuestion UI not ready")
	},
}
const askUserQuestionTool = createAskUserQuestionTool(askUserQuestionRef)
const builtInTools: AgentTool<any, any>[] = [...codingTools, askUserQuestionTool]

const { tools: customTools, errors: toolErrors } = await loadCustomTools(
	loaded.configDir,
	cwd,
	getToolNames(builtInTools),
	toolSendRef,
)

const allTools: AgentTool<any, any>[] = [...builtInTools, ...customTools.map((t) => t.tool)]
```

**Why**: Expose the new tool only in TUI and reserve its name from custom tool collisions.

#### 2. Update toolByName registry
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: tool metadata registry

**Before**:
```typescript
const toolByName = new Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: any; renderResult?: any }>()
for (const tool of codingTools) {
	toolByName.set(tool.name, { label: tool.label, source: "builtin" })
}
```

**After**:
```typescript
const toolByName = new Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: any; renderResult?: any }>()
for (const tool of builtInTools) {
	toolByName.set(tool.name, { label: tool.label, source: "builtin" })
}
```

**Why**: Ensure the new built-in tool appears in the TUI tool metadata map.

#### 3. Pass AskUserQuestion ref through App/MainView props
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: AppProps/MainViewProps definitions and render call

**Before**:
```typescript
interface AppProps {
	// ...
	lspActiveRef: { setActive: (v: boolean) => void }
}

interface MainViewProps {
	// ...
	lsp: LspManager
}

return (
	<ThemeProvider mode="dark" themeName={currentTheme()} onThemeChange={handleThemeChange}>
		<MainView /* existing props */ />
	</ThemeProvider>
)

render(() => (
	<App /* existing props */ lspActiveRef={lspActiveRef} />
))
```

**After**:
```typescript
interface AppProps {
	// ...
	lspActiveRef: { setActive: (v: boolean) => void }
	askUserQuestionRef: AskUserQuestionRef
}

interface MainViewProps {
	// ...
	lsp: LspManager
	askUserQuestionRef: AskUserQuestionRef
}

return (
	<ThemeProvider mode="dark" themeName={currentTheme()} onThemeChange={handleThemeChange}>
		<MainView /* existing props */ askUserQuestionRef={props.askUserQuestionRef} />
	</ThemeProvider>
)

render(() => (
	<App /* existing props */ lspActiveRef={lspActiveRef} askUserQuestionRef={askUserQuestionRef} />
))
```

**Why**: Allow `MainView` to control the modal and resolve tool execution.

#### 4. Add dialog state and ref wiring in MainView
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: `MainView` state + keyboard handler + textarea

**Before**:
```typescript
function MainView(props: MainViewProps) {
	const { theme } = useTheme()
	const dimensions = useTerminalDimensions()
	let textareaRef: TextareaRenderable | undefined
	const lastCtrlC = { current: 0 }

	const handleKeyDown = createKeyboardHandler({ /* ... */ })
}
```

**After**:
```typescript
interface AskDialogState {
	args: AskUserQuestionArgs
	resolve: (answers: AskUserQuestionAnswers) => void
	reject: (err: Error) => void
	signal?: AbortSignal
	onAbort?: () => void
}

function MainView(props: MainViewProps) {
	const { theme } = useTheme()
	const dimensions = useTerminalDimensions()
	let textareaRef: TextareaRenderable | undefined
	const lastCtrlC = { current: 0 }
	const [askDialog, setAskDialog] = createSignal<AskDialogState | null>(null)
	const isAskDialogOpen = () => askDialog() !== null

	createEffect(() => {
		props.askUserQuestionRef.current = (args, signal) => {
			// Guard: reject if dialog already open (prevents orphaned promises)
			if (askDialog()) {
				return Promise.reject(new Error("ask_user_question dialog already open"))
			}

			return new Promise((resolve, reject) => {
				const onAbort = () => {
					setAskDialog(null)
					reject(new Error("Operation aborted"))
				}
				if (signal?.aborted) {
					onAbort()
					return
				}
				signal?.addEventListener("abort", onAbort, { once: true })
				setAskDialog({ args, resolve, reject, signal, onAbort })
			})
		}
	})

	const baseKeyDown = createKeyboardHandler({ /* ... */ })
	const handleKeyDown = (e: { preventDefault: () => void }) => {
		if (isAskDialogOpen()) {
			e.preventDefault()
			return
		}
		baseKeyDown(e as any)
	}
}
```

**Why**: Block normal input while modal is open and route tool execution to the dialog.

#### 5. Render the dialog
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: JSX return in `MainView`

**Before**:
```typescript
<Footer borderColor={isBashMode() ? theme.warning : theme.border} />
<ToastViewport toasts={toasts()} />
```

**After**:
```typescript
<AskUserQuestionDialog
	open={isAskDialogOpen()}
	args={askDialog()?.args}
	onSubmit={(answers) => {
		const dialog = askDialog()
		if (dialog?.signal && dialog.onAbort) dialog.signal.removeEventListener("abort", dialog.onAbort)
		dialog?.resolve(answers)
		setAskDialog(null)
	}}
	onCancel={(reason) => {
		const dialog = askDialog()
		if (dialog?.signal && dialog.onAbort) dialog.signal.removeEventListener("abort", dialog.onAbort)
		dialog?.reject(new Error(reason))
		setAskDialog(null)
	}}
/>
<Footer borderColor={isBashMode() ? theme.warning : theme.border} />
<ToastViewport toasts={toasts()} />
```

**Before (textarea)**:
```typescript
<textarea
	ref={(r: TextareaRenderable) => { textareaRef = r; r.focus() }}
	/* existing props */
	onContentChange={() => {
		if (!textareaRef) return
		// existing autocomplete update
	}}
	onSubmit={() => {
		if (!textareaRef) return
		props.onSubmit(textareaRef.plainText, () => {
			textareaRef?.clear()
			setIsBashMode(false)
		})
	}}
/>
```

**After (textarea)**:
```typescript
<textarea
	ref={(r: TextareaRenderable) => { textareaRef = r; r.focus() }}
	focused={!isAskDialogOpen()}
	/* existing props */
	onContentChange={() => {
		if (isAskDialogOpen()) return
		if (!textareaRef) return
		// existing autocomplete update
	}}
	onSubmit={() => {
		if (isAskDialogOpen()) return
		if (!textareaRef) return
		props.onSubmit(textareaRef.plainText, () => {
			textareaRef?.clear()
			setIsBashMode(false)
		})
	}}
/>
```

**Why**: Mount the modal, resolve/reject the tool promise, and block normal input while open.

#### 6. Add dialog component
**File**: `apps/coding-agent/src/components/AskUserQuestionDialog.tsx`
**Location**: new file

**After**:
```typescript
import { Dialog, SelectList, useKeyboard, useTheme, type SelectListRef, type TextareaRenderable } from "@marvin-agents/open-tui"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { OTHER_OPTION_LABEL, type AskUserQuestionArgs, type AskUserQuestionAnswers } from "../tools/ask-user-question.js"

const OTHER_DESCRIPTION = "Provide your own answer"

export interface AskUserQuestionDialogProps {
	open: boolean
	args?: AskUserQuestionArgs
	onSubmit: (answers: AskUserQuestionAnswers) => void
	onCancel: (reason: string) => void
}

interface AskDialogState {
	index: number
	answers: AskUserQuestionAnswers
	selected: Set<string>
	otherText: string
	mode: "select" | "other"
	error: string | null
}

/** Parse pre-filled answer string into selected labels + other text */
function parsePrefilledAnswer(
	answer: string | undefined,
	optionLabels: string[]
): { selected: Set<string>; otherText: string } {
	if (!answer) return { selected: new Set(), otherText: "" }

	const selected = new Set<string>()
	let otherText = ""

	// Split by comma, but handle "Other: ..." specially
	const otherMatch = answer.match(/Other:\s*(.*)$/)
	if (otherMatch) {
		selected.add(OTHER_OPTION_LABEL)
		otherText = otherMatch[1]?.trim() ?? ""
		answer = answer.replace(/,?\s*Other:\s*.*$/, "")
	}

	// Match remaining parts against option labels
	const parts = answer.split(",").map((p) => p.trim()).filter(Boolean)
	for (const part of parts) {
		if (optionLabels.includes(part)) {
			selected.add(part)
		}
	}

	return { selected, otherText }
}

export function AskUserQuestionDialog(props: AskUserQuestionDialogProps) {
	const { theme } = useTheme()
	const [state, setState] = createSignal<AskDialogState>({
		index: 0,
		answers: {},
		selected: new Set<string>(),
		otherText: "",
		mode: "select",
		error: null,
	})
	let listRef: SelectListRef | undefined
	let otherInputRef: TextareaRenderable | undefined

	// Reset state when dialog opens, including pre-filled answers
	createEffect(() => {
		if (!props.open || !props.args) return
		const q = props.args.questions[0]
		const optionLabels = q?.options.map((o) => o.label) ?? []
		const prefilled = parsePrefilledAnswer(props.args.answers?.[q?.header ?? ""], optionLabels)

		setState({
			index: 0,
			answers: props.args.answers ?? {},
			selected: prefilled.selected,
			otherText: prefilled.otherText,
			mode: "select",
			error: null,
		})
	})

	const question = createMemo(() => props.args?.questions[state().index])
	const totalQuestions = createMemo(() => props.args?.questions.length ?? 0)
	const isMultiSelect = createMemo(() => question()?.multiSelect ?? false)

	const options = createMemo(() => {
		const base = question()?.options ?? []
		return [...base, { label: OTHER_OPTION_LABEL, description: OTHER_DESCRIPTION }]
	})

	// Visual distinction: (•)/( ) for single-select, [x]/[ ] for multi-select
	const items = createMemo(() =>
		options().map((opt) => {
			const isSelected = state().selected.has(opt.label)
			const marker = isMultiSelect()
				? (isSelected ? "[x]" : "[ ]")
				: (isSelected ? "(•)" : "( )")
			return {
				value: opt.label,
				label: `${marker} ${opt.label}`,
				description: opt.description,
			}
		})
	)

	// Progress indicator: "1/4: Header"
	const dialogTitle = createMemo(() => {
		const q = question()
		if (!q) return "Questions"
		const total = totalQuestions()
		const current = state().index + 1
		return total > 1 ? `${current}/${total}: ${q.header}` : q.header
	})

	const commitAnswer = (): boolean => {
		const current = question()
		if (!current) return false

		const selected = Array.from(state().selected)
		const hasOther = selected.includes(OTHER_OPTION_LABEL)
		const otherText = state().otherText.trim()
		const chosen = selected.filter((label) => label !== OTHER_OPTION_LABEL)

		if (hasOther && !otherText) {
			setState((prev) => ({ ...prev, error: "Other selected but no text entered" }))
			return false
		}
		if (chosen.length === 0 && !hasOther) {
			setState((prev) => ({ ...prev, error: "Select at least one option" }))
			return false
		}

		const answerParts = [...chosen]
		if (hasOther) answerParts.push(`Other: ${otherText}`)
		const answerText = answerParts.join(", ")

		setState((prev) => ({
			...prev,
			answers: { ...prev.answers, [current.header]: answerText },
		}))
		return true
	}

	const nextQuestion = () => {
		if (!commitAnswer()) return
		const nextIndex = state().index + 1
		if (props.args && nextIndex >= props.args.questions.length) {
			props.onSubmit(state().answers)
			return
		}

		// Load pre-filled answer for next question
		const nextQ = props.args!.questions[nextIndex]!
		const optionLabels = nextQ.options.map((o) => o.label)
		const prefilled = parsePrefilledAnswer(state().answers[nextQ.header], optionLabels)

		setState((prev) => ({
			...prev,
			index: nextIndex,
			selected: prefilled.selected,
			otherText: prefilled.otherText,
			mode: "select",
			error: null,
		}))
	}

	useKeyboard((e) => {
		if (!props.open) return

		// Escape always cancels
		if (e.name === "escape") {
			if (state().mode === "other") {
				setState((prev) => ({ ...prev, mode: "select" }))
			} else {
				props.onCancel("AskUserQuestion cancelled by user")
			}
			return
		}

		// In "other" mode, let textarea handle input
		if (state().mode === "other") {
			if (e.name === "return") {
				const text = otherInputRef?.plainText ?? ""
				setState((prev) => ({ ...prev, otherText: text, mode: "select", error: null }))
			}
			return
		}

		// Select mode keyboard handling
		if (e.name === "up") listRef?.moveUp()
		if (e.name === "down") listRef?.moveDown()

		if (e.name === "space") {
			const current = listRef?.getSelectedItem()?.value
			if (current) {
				setState((prev) => {
					const next = new Set(prev.selected)
					if (isMultiSelect()) {
						// Multi-select: toggle
						if (next.has(current)) next.delete(current)
						else next.add(current)
					} else {
						// Single-select: replace
						next.clear()
						next.add(current)
					}
					return { ...prev, selected: next, error: null }
				})
			}
		}

		if (e.name === "return") {
			const current = listRef?.getSelectedItem()?.value
			const multi = isMultiSelect()

			// For single-select, Enter selects current item and advances
			if (!multi && current) {
				setState((prev) => ({ ...prev, selected: new Set([current]) }))
			}

			const effectiveSelected = !multi && current ? new Set([current]) : state().selected
			const hasOther = effectiveSelected.has(OTHER_OPTION_LABEL)

			// If Other selected but no text, switch to other input mode
			if (hasOther && state().otherText.trim().length === 0) {
				setState((prev) => ({ ...prev, selected: effectiveSelected, mode: "other", error: null }))
				return
			}

			nextQuestion()
		}
	})

	return (
		<Dialog open={props.open} title={dialogTitle()} onClose={() => props.onCancel("AskUserQuestion cancelled by user")}>
			<Show when={props.args && question()}>
				<box flexDirection="column" gap={1}>
					<text>{question()!.question}</text>
					<SelectList ref={(r) => { listRef = r }} items={items()} maxVisible={6} />
					<Show when={state().mode === "other"}>
						<box flexDirection="column">
							<text fg={theme.textMuted}>Enter your answer:</text>
							<textarea
								ref={(r: TextareaRenderable) => { otherInputRef = r; r.focus() }}
								focused={state().mode === "other"}
								height={1}
								placeholder="Type here, then Enter to confirm"
							/>
						</box>
					</Show>
					<Show when={state().error}>
						<text fg={theme.error}>{state().error}</text>
					</Show>
					<text fg={theme.textMuted}>
						{isMultiSelect() ? "Space: toggle  " : ""}Enter: {isMultiSelect() ? "confirm" : "select"}  ↑↓: navigate  Esc: cancel
					</text>
				</box>
			</Show>
		</Dialog>
	)
}
```

**Why**: Provide the modal UI and capture structured answers with minimal UI dependencies.

#### 7. Add tool title summary (optional UI polish)
**File**: `apps/coding-agent/src/tui-open-rendering.tsx`
**Location**: `toolTitle` switch

**Before**:
```typescript
		default: {
			const delegation = getAgentDelegationArgs(args)
			if (delegation?.chain?.length) return `chain (${delegation.chain.length} steps)`
			if (delegation?.tasks?.length) return `parallel (${delegation.tasks.length} tasks)`
			if (delegation?.agent) return delegation.agent
			return ""
		}
```

**After**:
```typescript
		case "ask_user_question": {
			const count = Array.isArray(args?.questions) ? args.questions.length : 0
			return count ? `${count} questions` : ""
		}
		default: {
			const delegation = getAgentDelegationArgs(args)
			if (delegation?.chain?.length) return `chain (${delegation.chain.length} steps)`
			if (delegation?.tasks?.length) return `parallel (${delegation.tasks.length} tasks)`
			if (delegation?.agent) return delegation.agent
			return ""
		}
```

**Why**: Provide a concise summary when the tool is collapsed.

### Edge Cases to Handle
- [ ] Dialog canceled -> tool promise rejected with clear error
- [ ] Other selected without text -> error message and stay on question
- [ ] Multi-select question with no selection -> error message
- [ ] Tool aborted -> dialog closes and tool returns error
- [ ] Concurrent tool call while dialog open -> rejected immediately with "dialog already open"
- [ ] Pre-filled answers -> UI shows pre-selected options on open
- [ ] Single-select Enter behavior -> selects current + advances (no Space needed)

### Success Criteria

**Automated** (run after each change, must pass before committing):
```bash
bun run typecheck
```

**Before proceeding to next phase**:
```bash
bun run typecheck
```

**Manual**:
- [ ] Open TUI, trigger tool with 1 question, select a normal option, confirm tool output shows selection
- [ ] Trigger tool with Other, enter custom text, confirm tool output includes `Other: ...`
- [ ] Press Esc in dialog, confirm tool returns error message

### Rollback
If this phase fails after partial completion:
```bash
git restore -- apps/coding-agent/src/tui-app.tsx \
  apps/coding-agent/src/components/AskUserQuestionDialog.tsx \
  apps/coding-agent/src/tui-open-rendering.tsx
```

### Notes
- Modal should fully block the textarea input while open to avoid interleaved input.

---

## Phase 3: Tests and Verification

### Overview
Add unit tests for validation and output formatting to lock behavior.

### Prerequisites
- [ ] Phase 2 automated checks pass
- [ ] Phase 2 manual verification complete

### Change Checklist
- [ ] Add test coverage for validation rules
- [ ] Add test coverage for output formatting

### Changes

#### 1. Add unit tests
**File**: `apps/coding-agent/tests/ask-user-question.test.ts`
**Location**: new file

**After**:
```typescript
import { describe, expect, it } from "bun:test"
import {
	validateAskUserQuestionArgs,
	formatAskUserQuestionOutput,
	createAskUserQuestionTool,
	type AskUserQuestionRef,
} from "../src/tools/ask-user-question.js"

const baseArgs = {
	questions: [
		{
			question: "Which option?",
			header: "Option",
			multiSelect: false,
			options: [
				{ label: "Alpha", description: "A" },
				{ label: "Beta", description: "B" },
			],
		},
	],
}

describe("ask-user-question validation", () => {
	it("accepts valid args", () => {
		expect(validateAskUserQuestionArgs(baseArgs as any)).toBeNull()
	})

	it("rejects question missing ?", () => {
		const args = {
			questions: [{ ...baseArgs.questions[0], question: "No question mark" }],
		}
		expect(validateAskUserQuestionArgs(args as any)).toContain("must end with ?")
	})

	it("rejects duplicate headers", () => {
		const args = {
			questions: [
				{ ...baseArgs.questions[0], header: "Same" },
				{ ...baseArgs.questions[0], header: "Same" },
			],
		}
		expect(validateAskUserQuestionArgs(args as any)).toContain("Duplicate header")
	})

	it("rejects option label word count > 5", () => {
		const args = {
			questions: [
				{
					question: "Which option?",
					header: "Option",
					multiSelect: false,
					options: [
						{ label: "one two three four five six", description: "bad" },
						{ label: "ok", description: "ok" },
					],
				},
			],
		}
		expect(validateAskUserQuestionArgs(args as any)).toContain("1-5 words")
	})

	it("rejects reserved Other label", () => {
		const args = {
			questions: [
				{
					question: "Which option?",
					header: "Option",
					multiSelect: false,
					options: [
						{ label: "Other", description: "reserved" },
						{ label: "ok", description: "ok" },
					],
				},
			],
		}
		expect(validateAskUserQuestionArgs(args as any)).toContain('"Other" is reserved')
	})

	it("rejects unknown answers key", () => {
		const args = {
			...baseArgs,
			answers: { Unknown: "value" },
		}
		expect(validateAskUserQuestionArgs(args as any)).toContain("Unknown answers key")
	})
})

describe("ask-user-question output", () => {
	it("formats summary in question order", () => {
		const text = formatAskUserQuestionOutput(baseArgs.questions as any, { Option: "Alpha" })
		expect(text).toContain("- Option: Alpha")
		expect(text).toContain("JSON:")
	})

	it("includes Other text in output", () => {
		const text = formatAskUserQuestionOutput(baseArgs.questions as any, { Option: "Other: custom answer" })
		expect(text).toContain("Other: custom answer")
	})
})

describe("ask-user-question tool", () => {
	it("returns content and details shape", async () => {
		const mockRef: AskUserQuestionRef = {
			current: async () => ({ Option: "Alpha" }),
		}
		const tool = createAskUserQuestionTool(mockRef)

		const result = await tool.execute("test-id", baseArgs as any, undefined)

		expect(result.content).toBeDefined()
		expect(result.content[0]?.type).toBe("text")
		expect(result.details?.answers).toEqual({ Option: "Alpha" })
	})

	it("throws on validation error", async () => {
		const mockRef: AskUserQuestionRef = {
			current: async () => ({}),
		}
		const tool = createAskUserQuestionTool(mockRef)

		const badArgs = {
			questions: [{ ...baseArgs.questions[0], question: "No question mark" }],
		}

		await expect(tool.execute("test-id", badArgs as any, undefined)).rejects.toThrow("must end with ?")
	})

	it("throws on abort signal", async () => {
		const mockRef: AskUserQuestionRef = {
			current: async () => ({ Option: "Alpha" }),
		}
		const tool = createAskUserQuestionTool(mockRef)

		const controller = new AbortController()
		controller.abort()

		await expect(tool.execute("test-id", baseArgs as any, controller.signal)).rejects.toThrow("aborted")
	})
})
```

**Why**: Prevent regressions in validation rules, output formatting, and tool execution paths.

### Edge Cases to Handle
- [ ] Validation returns `Question must end with ?` for missing question mark
- [ ] Validation returns `Option label "Other" is reserved`
- [ ] Tool execute throws on abort signal
- [ ] Tool returns correct content + details shape

### Success Criteria

**Automated** (run after each change, must pass before committing):
```bash
bun run typecheck
bun test apps/coding-agent/tests/ask-user-question.test.ts
```

**Before proceeding to next phase**:
```bash
bun run test
```

**Manual**:
- [ ] Run TUI and verify dialog interactions still work after tests

### Rollback
If this phase fails after partial completion:
```bash
git restore -- apps/coding-agent/tests/ask-user-question.test.ts
```

### Notes
- Keep tests focused on pure functions; UI is covered by manual checks.

---

## Testing Strategy

### Unit Tests to Add/Modify
**File**: `apps/coding-agent/tests/ask-user-question.test.ts`

```typescript
describe("ask-user-question validation", () => {
	it("accepts valid args", () => {})
	it("rejects question missing ?", () => {})
	it("rejects duplicate headers", () => {})
	it("rejects option label word count > 5", () => {})
	it("rejects reserved Other label", () => {})
	it("rejects unknown answers key", () => {})
})

describe("ask-user-question output", () => {
	it("formats summary in question order", () => {})
	it("includes Other text in output", () => {})
})

describe("ask-user-question tool", () => {
	it("returns content and details shape", () => {})
	it("throws on validation error", () => {})
	it("throws on abort signal", () => {})
})
```

### Integration Tests
- [ ] None (manual TUI validation only)

### Manual Testing Checklist
1. [ ] Single-select question: Enter on option → selects and advances
2. [ ] Multi-select question: Space toggles `[x]`, Enter confirms selections
3. [ ] Single-select shows `(•)`/`( )`, multi-select shows `[x]`/`[ ]`
4. [ ] Other selected → prompts for text input, Enter confirms
5. [ ] Other selected with empty text → error message displayed in red
6. [ ] Cancel dialog (Esc in select mode) → tool returns error message
7. [ ] Esc in "other" mode → returns to select mode (not cancel)
8. [ ] Progress indicator shows "1/4: Header" for multi-question flows
9. [ ] Pre-filled answers: options pre-selected when dialog opens
10. [ ] Concurrent tool call while dialog open → rejected immediately

## Deployment Instructions

### Database Migrations (if applicable)
```bash
# none
```
**Rollback**:
```bash
# none
```

### Feature Flags (if applicable)
- Flag name: none
- Rollout plan: none
- Removal: none

### Environment Variables
**Add to `.env` / deployment config:**
```bash
# none
```

### Deployment Order
1. N/A

## Anti-Patterns to Avoid
- Do not return answers only in `details`; the model only sees `content`.
- Do not register the tool in headless tool list.
- Do not allow `Other` as a caller-provided option label.
- Do not use `Input` component (doesn't exist) — use `textarea` with `height={1}`.
- Do not allow concurrent tool calls to overwrite dialog state — reject immediately.
- Do not mix single/multi-select visuals — use `(•)`/`( )` vs `[x]`/`[ ]` respectively.

## Open Questions (must resolve before implementation)
- [x] Tool name -> Answer: `ask_user_question`
- [x] Headless support -> Answer: not supported (TUI-only)
- [x] Answer key -> Answer: use `header` as the map key

## References
- Similar impl: `apps/coding-agent/src/tui-app.tsx:86`
- Pattern source: `apps/coding-agent/src/tui-open-rendering.tsx:483`
- Test pattern: `apps/coding-agent/tests/tool-ui-contracts.test.ts:1`

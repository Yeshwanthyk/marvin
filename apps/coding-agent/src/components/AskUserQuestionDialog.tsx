import { TextareaRenderable } from "@opentui/core"
import { Dialog, SelectList, useKeyboard, useTerminalDimensions, useTheme, type SelectListRef } from "@marvin-agents/open-tui"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { OTHER_OPTION_LABEL, type AskUserQuestionArgs, type AskUserQuestionAnswers } from "../tools/ask-user-question.js"

const OTHER_DESCRIPTION = "Provide your own answer"

export interface AskUserQuestionDialogProps {
	open: boolean
	args?: AskUserQuestionArgs
	onSubmit: (answers: AskUserQuestionAnswers) => void
	onCancel: (reason: string) => void
}

interface AskDialogInternalState {
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
	const dimensions = useTerminalDimensions()
	const listWidth = createMemo(() => {
		const dialogWidth = Math.floor(dimensions().width * 0.7)
		return Math.max(20, dialogWidth - 6)
	})
	const [state, setState] = createSignal<AskDialogInternalState>({
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
		<Dialog open={props.open} title={dialogTitle()} closeOnOverlayClick={false} onClose={() => props.onCancel("AskUserQuestion cancelled by user")}>
			<Show when={props.args && question()}>
				<box flexDirection="column" gap={1}>
					<text>{question()!.question}</text>
					<SelectList ref={(r: SelectListRef) => { listRef = r }} items={items()} maxVisible={6} width={listWidth()} />
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

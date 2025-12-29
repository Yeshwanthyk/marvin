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

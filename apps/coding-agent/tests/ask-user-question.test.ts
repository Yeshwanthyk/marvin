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

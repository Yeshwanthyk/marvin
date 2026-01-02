import { describe, it, expect } from "bun:test"
import {
	validateCustomCommand,
	validateCustomTool,
	validateHookDescriptor,
	formatValidationIssue,
	hasBlockingIssues,
	issueFromError,
} from "../src/extensibility/validation.js"

describe("extensibility validation", () => {
	it("flags invalid custom command manifests", () => {
		const issues = validateCustomCommand({ name: "good", description: "", template: "" }, "/tmp/good.md")
		expect(issues.length).toBeGreaterThan(0)
		expect(issues[0]?.kind).toBe("command")
		expect(hasBlockingIssues(issues)).toBe(true)
	})

	it("flags invalid custom tools", () => {
		const issues = validateCustomTool({ name: "tool", label: "", description: "" }, "/tmp/tool.ts")
		expect(issues.length).toBeGreaterThan(0)
		expect(issues[0]?.kind).toBe("tool")
	})

	it("warns on unsupported hook events", () => {
		const issues = validateHookDescriptor({ path: "/tmp/hook.ts", events: ["unknown.event" as any] })
		expect(issues.length).toBe(1)
		expect(issues[0]?.severity).toBe("warning")
	})

	it("formats issues consistently", () => {
		const issue = issueFromError("tool", "/tmp/tool.ts", new Error("boom"))
		const formatted = formatValidationIssue(issue)
		expect(formatted).toContain("[ERROR][tool]")
		expect(formatted).toContain("boom")
	})
})

import { describe, expect, it } from "bun:test"

async function loadMarkdownParser() {
	await import("@opentui/solid/preload")
	const markdown = await import("../src/components/markdown.js")
	return markdown.parseStreamingMarkdownLines
}

describe("parseStreamingMarkdownLines", () => {
	it("conceals common markdown while preserving streaming structure", async () => {
		const parseStreamingMarkdownLines = await loadMarkdownParser()
		const lines = parseStreamingMarkdownLines([
			"# **Plan**",
			"- `inspect` repo",
			"> careful",
			"```ts",
			"const ok = true",
			"```",
		].join("\n"))

		expect(lines).toEqual([
			{ kind: "heading", level: 1, text: "Plan" },
			{ kind: "list", marker: "-", text: "inspect repo" },
			{ kind: "quote", text: "careful" },
			{ kind: "codeFence", text: "code ts" },
			{ kind: "code", text: "const ok = true" },
			{ kind: "codeFence", text: "code" },
		])
	})
})

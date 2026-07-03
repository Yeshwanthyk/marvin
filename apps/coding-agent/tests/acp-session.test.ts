import { describe, expect, it } from "bun:test"
import { projectAcpStreamingDelta } from "../src/adapters/acp/session.js"

describe("ACP streaming projection", () => {
	it("emits only text and thinking growth across streaming updates", () => {
		let state = { textLength: 0, thinkingLength: 0 }
		const content = [
			{ type: "thinking", thinking: "plan" },
			{ type: "text", text: "he" },
		]

		const first = projectAcpStreamingDelta(content, state)
		expect(first.text).toBe("he")
		expect(first.thinking).toBe("plan")
		state = first.next

		content[0] = { type: "thinking", thinking: "plan more" }
		content[1] = { type: "text", text: "hello" }
		const second = projectAcpStreamingDelta(content, state)
		expect(second.text).toBe("llo")
		expect(second.thinking).toBe(" more")
		state = second.next

		content[1] = { type: "text", text: "hey" }
		const shrink = projectAcpStreamingDelta(content, state)
		expect(shrink.text).toBe("")
		expect(shrink.thinking).toBe("")
		state = shrink.next

		content[1] = { type: "text", text: "hello!" }
		const growth = projectAcpStreamingDelta(content, state)
		expect(growth.text).toBe("!")
		expect(growth.thinking).toBe("")
	})
})

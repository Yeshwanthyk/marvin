import { describe, expect, it } from "bun:test"
import { createPromptQueue } from "../src/runtime/session/prompt-queue.js"

describe("prompt queue", () => {
	it("tracks size when pushing and shifting", () => {
		const sizes: number[] = []
		const queue = createPromptQueue((size) => sizes.push(size))

		queue.push("one")
		queue.push("two")
		expect(queue.size()).toBe(2)
		expect(queue.shift()).toBe("one")
		expect(queue.size()).toBe(1)
		expect(queue.peekAll()).toEqual(["two"])

		expect(sizes).toEqual([1, 2, 1])
	})

	it("drains queued text", () => {
		const queue = createPromptQueue(() => {})
		expect(queue.drainToText()).toBeNull()
		queue.push("line 1")
		queue.push("line 2")
		expect(queue.drainToText()).toBe("line 1\nline 2")
		expect(queue.size()).toBe(0)
	})
})

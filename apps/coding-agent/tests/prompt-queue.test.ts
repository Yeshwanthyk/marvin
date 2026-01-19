import { describe, expect, it } from "bun:test"
import { createPromptQueue, type PromptQueueItem } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"

describe("prompt queue", () => {
	it("tracks size when pushing and shifting", () => {
		const snapshots: Array<{ steer: number; followUp: number }> = []
		const queue = createPromptQueue((counts) => snapshots.push(counts))

		const entries: PromptQueueItem[] = [
			{ text: "one", mode: "followUp" },
			{ text: "two", mode: "steer" },
		]

		queue.push(entries[0]!)
		queue.push(entries[1]!)
		expect(queue.size()).toBe(2)
		expect(queue.shift()).toEqual(entries[0])
		expect(queue.size()).toBe(1)
		expect(queue.peekAll()).toEqual([entries[1]])

		expect(snapshots).toEqual([
			{ followUp: 1, steer: 0 },
			{ followUp: 1, steer: 1 },
			{ followUp: 0, steer: 1 },
		])
	})

	it("drains queued text as slash command script", () => {
		const queue = createPromptQueue(() => {})
		expect(queue.drainToScript()).toBeNull()
		queue.push({ text: "line 1", mode: "followUp" })
		queue.push({ text: "line 2", mode: "steer" })
		expect(queue.drainToScript()).toBe("/followup line 1\n/steer line 2")
		expect(queue.size()).toBe(0)
	})

	it("preserves multiline content when draining", () => {
		const queue = createPromptQueue(() => {})
		queue.push({ text: "multi line\nvalue", mode: "followUp" })
		const script = queue.drainToScript()
		expect(script).toBe(`/followup multi line\nvalue`)
		expect(queue.size()).toBe(0)
	})
})

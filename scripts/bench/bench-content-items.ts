// Bench hint: bun scripts/bench/bench-content-items.ts
import type { ToolBlock, UIMessage } from "../../apps/coding-agent/src/types.js"

interface CaseResult {
	size: number
	items: number
	totalMs: number
	avgMs: number
	maxMs: number
}

const iterations = 25
const sizes = [100, 1_000, 5_000]

const formatMs = (value: number): string => value.toFixed(4)

const makeTool = (id: string, index: number): ToolBlock => ({
	id,
	name: "bash",
	args: { command: index % 3 === 0 ? "rg createAgentEventHandler" : "sed -n 1,120p apps/coding-agent/src/agent-events.ts" },
	output: `output-${index}\n`.repeat((index % 5) + 1),
	updateSeq: index,
	isError: index % 37 === 0,
	isComplete: true,
})

const makeMessages = (count: number): { messages: UIMessage[]; toolBlocks: ToolBlock[] } => {
	const messages: UIMessage[] = []
	const toolBlocks: ToolBlock[] = []

	for (let i = 0; i < count; i++) {
		messages.push({
			id: `user-${i}`,
			role: "user",
			content: `Prompt ${i}: inspect the transcript path and summarize relevant work.`,
		})

		const tool = makeTool(`tool-${i}`, i)
		messages.push({
			id: `assistant-${i}`,
			role: "assistant",
			content: "",
			contentBlocks: [
				{
					type: "thinking",
					id: `thinking-${i}`,
					summary: `Plan ${i}`,
					preview: `Plan ${i}`,
					full: `Plan ${i}\nCheck files, run targeted verification, report only blockers.`,
				},
				{ type: "tool", tool },
				{ type: "text", text: `Result ${i}: finished scoped check with deterministic fixture data.` },
			],
		})

		if (i % 10 === 0) {
			toolBlocks.push(makeTool(`orphan-tool-${i}`, i))
		}
	}

	return { messages, toolBlocks }
}

async function loadBuildContentItems() {
	await import("@opentui/solid/preload")
	await import("../../apps/coding-agent/src/solid-preload.js")
	const messageList = await import("../../apps/coding-agent/src/components/MessageList.js")
	return messageList.buildContentItems
}

async function runBench(): Promise<void> {
	const buildContentItems = await loadBuildContentItems()
	const results: CaseResult[] = []

	for (const size of sizes) {
		const { messages, toolBlocks } = makeMessages(size)
		buildContentItems(messages, toolBlocks, true)

		let totalMs = 0
		let maxMs = 0
		let items = 0

		for (let i = 0; i < iterations; i++) {
			const start = performance.now()
			const contentItems = buildContentItems(messages, toolBlocks, true)
			const elapsedMs = performance.now() - start
			totalMs += elapsedMs
			if (elapsedMs > maxMs) maxMs = elapsedMs
			items = contentItems.length
		}

		results.push({ size, items, totalMs, avgMs: totalMs / iterations, maxMs })
	}

	console.log("# bench-content-items")
	console.log(`iterations=${iterations}`)
	console.log("messages,toolBlocks,items,total_ms,avg_ms,max_ms")
	for (const result of results) {
		const toolBlocks = Math.floor((result.size + 9) / 10)
		console.log([
			result.size,
			toolBlocks,
			result.items,
			formatMs(result.totalMs),
			formatMs(result.avgMs),
			formatMs(result.maxMs),
		].join(","))
	}
}

await runBench()

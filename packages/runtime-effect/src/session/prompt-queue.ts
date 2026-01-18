export type PromptDeliveryMode = "steer" | "followUp"

export interface PromptQueueItem {
	text: string
	mode: PromptDeliveryMode
}

export interface QueueCounts {
	steer: number
	followUp: number
}

export interface PromptQueue {
	push: (item: PromptQueueItem) => void
	shift: () => PromptQueueItem | undefined
	drainToScript: () => string | null
	clear: () => void
	size: () => number
	peekAll: () => PromptQueueItem[]
	peek: () => PromptQueueItem | undefined
	counts: () => QueueCounts
}

export function createPromptQueue(updateCounts: (counts: QueueCounts) => void): PromptQueue {
	const queue: PromptQueueItem[] = []

	const computeCounts = (): QueueCounts => {
		return queue.reduce<QueueCounts>(
			(acc, item) => {
				acc[item.mode] += 1
				return acc
			},
			{ steer: 0, followUp: 0 },
		)
	}

	const syncCounts = () => updateCounts(computeCounts())

	const toScriptLine = (item: PromptQueueItem): string => {
		const command = item.mode === "steer" ? "/steer" : "/followup"
		const trimmed = item.text.trimEnd()
		return trimmed.length > 0 ? `${command} ${trimmed}` : command
	}

	return {
		push: (item: PromptQueueItem) => {
			queue.push(item)
			syncCounts()
		},
		shift: () => {
			const value = queue.shift()
			if (value !== undefined) {
				syncCounts()
			}
			return value
		},
		drainToScript: () => {
			if (queue.length === 0) return null
			const combined = queue.map((item) => toScriptLine(item)).join("\n")
			queue.length = 0
			syncCounts()
			return combined
		},
		clear: () => {
			if (queue.length === 0) return
			queue.length = 0
			syncCounts()
		},
		size: () => queue.length,
		peekAll: () => [...queue],
		peek: () => queue[0],
		counts: computeCounts,
	}
}

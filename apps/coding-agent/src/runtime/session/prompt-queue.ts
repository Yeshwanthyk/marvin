export interface PromptQueue {
	push: (text: string) => void
	shift: () => string | undefined
	drainToText: () => string | null
	clear: () => void
	size: () => number
	peekAll: () => string[]
}

export function createPromptQueue(updateSize: (size: number) => void): PromptQueue {
	const queue: string[] = []

	const syncSize = () => updateSize(queue.length)

	return {
		push: (text: string) => {
			queue.push(text)
			syncSize()
		},
		shift: () => {
			const value = queue.shift()
			if (value !== undefined) syncSize()
			return value
		},
		drainToText: () => {
			if (queue.length === 0) return null
			const combined = queue.join("\n")
			queue.length = 0
			syncSize()
			return combined
		},
		clear: () => {
			queue.length = 0
			syncSize()
		},
		size: () => queue.length,
		peekAll: () => [...queue],
	}
}

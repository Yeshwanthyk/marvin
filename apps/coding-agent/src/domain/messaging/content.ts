export const MESSAGE_CAP = 75

export const appendWithCap = <T,>(arr: T[], item: T, cap = MESSAGE_CAP): T[] => {
	const next = [...arr, item]
	return next.length > cap ? next.slice(-cap) : next
}

export const getToolText = (result: unknown): string => {
	if (!result || typeof result !== "object") return String(result)
	const maybe = result as { content?: unknown }
	const content = Array.isArray(maybe.content) ? maybe.content : []
	const parts: string[] = []
	for (const block of content) {
		if (typeof block === "object" && block !== null && (block as Record<string, unknown>).type === "text") {
			parts.push((block as Record<string, string>).text)
		}
	}
	return parts.join("")
}

export const getEditDiffText = (result: unknown): string | null => {
	if (!result || typeof result !== "object") return null
	const maybe = result as { details?: { diff?: string } }
	return maybe.details?.diff || null
}

export const extractText = (content: unknown[]): string => {
	let text = ""
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>
		if (b.type === "text" && typeof b.text === "string") {
			text += b.text
		}
	}
	return text
}

export const extractThinking = (content: unknown[]): { summary: string; full: string } | null => {
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>
		if (b.type === "thinking" && typeof b.thinking === "string") {
			const full = b.thinking
			const lines = full.trim().split("\n").filter((l) => l.trim().length > 20)
			const summary = lines[0]?.trim().slice(0, 80) || full.trim().slice(0, 80)
			const truncated = summary.length >= 80 ? summary + "..." : summary
			return { summary: truncated, full }
		}
	}
	return null
}

export interface ExtractedToolCall {
	id: string
	name: string
	args: unknown
}

export const extractToolCalls = (content: unknown[]): ExtractedToolCall[] => {
	const toolCalls: ExtractedToolCall[] = []
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>
		if (b.type === "toolCall" && typeof b.id === "string" && typeof b.name === "string") {
			toolCalls.push({ id: b.id, name: b.name, args: b.arguments ?? {} })
		}
	}
	return toolCalls
}

export type OrderedBlock =
	| { type: "thinking"; id: string; summary: string; full: string }
	| { type: "text"; text: string }
	| { type: "toolCall"; id: string; name: string; args: unknown }

export const extractOrderedBlocks = (content: unknown[]): OrderedBlock[] => {
	const blocks: OrderedBlock[] = []
	let thinkingCounter = 0

	for (const block of content) {
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>

		if (b.type === "thinking" && typeof b.thinking === "string") {
			const full = b.thinking
			const lines = full.trim().split("\n").filter((l) => l.trim().length > 20)
			const summary = lines[0]?.trim().slice(0, 80) || full.trim().slice(0, 80)
			const truncated = summary.length >= 80 ? summary + "..." : summary
			blocks.push({
				type: "thinking",
				id: `thinking-${thinkingCounter++}`,
				summary: truncated,
				full,
			})
		} else if (b.type === "text" && typeof b.text === "string") {
			blocks.push({ type: "text", text: b.text })
		} else if (b.type === "toolCall" && typeof b.id === "string" && typeof b.name === "string") {
			blocks.push({ type: "toolCall", id: b.id, name: b.name, args: b.arguments ?? {} })
		}
	}

	return blocks
}

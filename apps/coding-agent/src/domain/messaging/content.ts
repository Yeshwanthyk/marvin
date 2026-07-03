import type { UIContentBlock } from "../../types.js"

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

const THINKING_SUMMARY_MAX = 80
const THINKING_PREVIEW_MAX = 50

export const buildThinkingSummary = (full: string): { summary: string; preview: string } => {
	const trimmed = full.trim()
	const lines = trimmed.split("\n").filter((l) => l.trim().length > 20)
	const base = (lines[0]?.trim() || trimmed).slice(0, THINKING_SUMMARY_MAX)
	const summary = base.length >= THINKING_SUMMARY_MAX ? base + "..." : base
	const previewSource = summary || trimmed
	const firstLine = previewSource.split("\n")[0] || ""
	const preview = firstLine.length <= THINKING_PREVIEW_MAX
		? firstLine
		: firstLine.slice(0, THINKING_PREVIEW_MAX - 3) + "..."
	return { summary, preview }
}

export const extractThinking = (content: unknown[]): { summary: string; preview: string; full: string } | null => {
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>
		if (b.type === "thinking" && typeof b.thinking === "string") {
			const full = b.thinking
			const { summary, preview } = buildThinkingSummary(full)
			return { summary, preview, full }
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
	| { type: "thinking"; id: string; summary: string; preview: string; full: string }
	| { type: "text"; text: string }
	| { type: "toolCall"; id: string; name: string; args: unknown }

const appendOrderedThinking = (blocks: OrderedBlock[], id: string, full: string): void => {
	if (!full.trim()) return
	const last = blocks[blocks.length - 1]
	const mergedFull = last?.type === "thinking" ? `${last.full}\n\n${full}`.trim() : full
	const { summary, preview } = buildThinkingSummary(mergedFull)
	if (!summary && !preview) return
	const next: OrderedBlock = {
		type: "thinking",
		id: last?.type === "thinking" ? last.id : id,
		summary,
		preview,
		full: mergedFull,
	}
	if (last?.type === "thinking") {
		blocks[blocks.length - 1] = next
	} else {
		blocks.push(next)
	}
}

const appendOrderedText = (blocks: OrderedBlock[], text: string): void => {
	if (!text) return
	const last = blocks[blocks.length - 1]
	if (last?.type === "text") {
		blocks[blocks.length - 1] = { type: "text", text: last.text + text }
	} else {
		blocks.push({ type: "text", text })
	}
}

export const extractOrderedBlocks = (content: unknown[]): OrderedBlock[] => {
	const blocks: OrderedBlock[] = []

	for (let i = 0; i < content.length; i++) {
		const block = content[i]
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>

		if (b.type === "thinking" && typeof b.thinking === "string") {
			appendOrderedThinking(blocks, `thinking-${i}`, b.thinking)
		} else if (b.type === "text" && typeof b.text === "string") {
			appendOrderedText(blocks, b.text)
		} else if (b.type === "toolCall" && typeof b.id === "string" && typeof b.name === "string") {
			blocks.push({ type: "toolCall", id: b.id, name: b.name, args: b.arguments ?? {} })
		}
	}

	return blocks
}

export interface StreamingSnapshot {
	// Total streaming text length, even when the UI text is tailed.
	textLength: number
	textTail: string
	thinking: { summary: string; preview: string; full: string } | null
	contentBlocks: UIContentBlock[]
}

const appendTailedText = (current: string, next: string, tailChars: number): string => {
	if (next.length >= tailChars) return next.slice(-tailChars)
	if (current.length + next.length <= tailChars) return current + next
	return (current + next).slice(-tailChars)
}

const appendTailedTextBlock = (blocks: UIContentBlock[], text: string, tailChars: number): void => {
	if (!text) return
	const last = blocks[blocks.length - 1]
	const nextText = appendTailedText("", text, tailChars)
	if (last?.type === "text") {
		blocks[blocks.length - 1] = { type: "text", text: appendTailedText(last.text, nextText, tailChars) }
		return
	}
	blocks.push({ type: "text", text: nextText })
}

export const orderedBlocksToUiContentBlocks = (
	orderedBlocks: OrderedBlock[],
	options?: { tailTextChars?: number },
): UIContentBlock[] => {
	const blocks: UIContentBlock[] = []
	for (const block of orderedBlocks) {
		if (block.type === "thinking") {
			blocks.push({ type: "thinking", id: block.id, summary: block.summary, preview: block.preview, full: block.full })
		} else if (block.type === "text") {
			if (options?.tailTextChars === undefined) {
				blocks.push({ type: "text", text: block.text })
			} else {
				appendTailedTextBlock(blocks, block.text, options.tailTextChars)
			}
		} else {
			blocks.push({
				type: "tool",
				tool: { id: block.id, name: block.name, args: block.args, isError: false, isComplete: false },
			})
		}
	}
	return blocks
}

export const extractStreamingSnapshot = (content: unknown[], tailChars: number): StreamingSnapshot => {
	const text = extractText(content)
	const orderedBlocks = extractOrderedBlocks(content)
	const contentBlocks = orderedBlocksToUiContentBlocks(orderedBlocks, { tailTextChars: tailChars })
	return {
		textLength: text.length,
		textTail: appendTailedText("", text, tailChars),
		thinking: extractThinking(content),
		contentBlocks,
	}
}

/**
 * Pure utility functions for TUI application
 */

import { existsSync, readFileSync } from "fs"
import { dirname, join } from "path"
import { spawnSync } from "child_process"

// ----- Git helpers -----

export function findGitHeadPath(startDir: string = process.cwd()): string | null {
	let dir = startDir
	while (true) {
		const gitHeadPath = join(dir, ".git", "HEAD")
		if (existsSync(gitHeadPath)) return gitHeadPath
		const parent = dirname(dir)
		if (parent === dir) return null
		dir = parent
	}
}

export function getCurrentBranch(startDir?: string): string | null {
	try {
		const gitHeadPath = findGitHeadPath(startDir)
		if (!gitHeadPath) return null
		const content = readFileSync(gitHeadPath, "utf8").trim()
		if (content.startsWith("ref: refs/heads/")) return content.slice(16)
		return "detached"
	} catch {
		return null
	}
}

export function getGitDiffStats(cwd: string = process.cwd()): { ins: number; del: number } | null {
	try {
		const result = spawnSync("git", ["diff", "--shortstat"], { cwd, encoding: "utf8" })
		const output = (result.stdout || "").trim()
		if (!output) return { ins: 0, del: 0 }
		const ins = output.match(/(\d+) insertions?/)?.[1] ?? "0"
		const del = output.match(/(\d+) deletions?/)?.[1] ?? "0"
		return { ins: +ins, del: +del }
	} catch {
		return null
	}
}

// ----- Clipboard -----

export function copyToClipboard(text: string): void {
	// OSC52 escape sequence for clipboard copy
	const base64 = Buffer.from(text).toString("base64")
	let osc52: string
	if (process.env["TMUX"]) {
		osc52 = `\x1bPtmux;\x1b\x1b]52;c;${base64}\x07\x1b\\`
	} else {
		osc52 = `\x1b]52;c;${base64}\x07`
	}
	process.stdout.write(osc52)

	// Also use pbcopy as fallback on macOS
	if (process.platform === "darwin") {
		try {
			spawnSync("pbcopy", { input: text, encoding: "utf-8" })
		} catch {}
	}
}

// ----- Tool result extraction -----

export function getToolText(result: unknown): string {
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

export function getEditDiffText(result: unknown): string | null {
	if (!result || typeof result !== "object") return null
	const maybe = result as { details?: { diff?: string } }
	return maybe.details?.diff || null
}

// ----- Content extraction -----

export function extractText(content: unknown[]): string {
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

export function extractThinking(content: unknown[]): { summary: string; full: string } | null {
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

export function extractToolCalls(content: unknown[]): ExtractedToolCall[] {
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

/** Ordered content block for preserving API response order */
export type OrderedBlock =
	| { type: "thinking"; id: string; summary: string; full: string }
	| { type: "text"; text: string }
	| { type: "toolCall"; id: string; name: string; args: unknown }

/**
 * Extract content blocks in order, preserving interleaving of thinking, text, and tool calls.
 * Each content type appears in the order it was received from the API.
 */
export function extractOrderedBlocks(content: unknown[]): OrderedBlock[] {
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

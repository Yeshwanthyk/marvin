/**
 * Text width utilities for handling ANSI codes and terminal column widths
 *
 * Note: OpenTUI provides its own buffer-based width calculations, but these
 * utilities are useful for components that need to work with raw strings.
 */

// ANSI escape sequence pattern - uses ESC (0x1b) followed by CSI sequences
// biome-ignore lint/suspicious/noControlCharactersInRegex: Required for ANSI escape detection
const ANSI_PATTERN = /\x1b\[[0-9;]*[mGKHJ]/g

/**
 * Calculate the visible width of a string in terminal columns.
 * Excludes ANSI escape sequences from the count.
 */
export function visibleWidth(str: string): number {
	// Strip ANSI codes and normalize tabs
	const stripped = stripAnsi(str).replace(/\t/g, "   ")
	// Use Bun's built-in string width calculation
	return Bun.stringWidth(stripped)
}

/**
 * Strip ANSI escape codes from a string
 */
export function stripAnsi(str: string): string {
	return str.replace(ANSI_PATTERN, "")
}

interface TextSegment {
	type: "ansi" | "grapheme"
	value: string
}

/**
 * Parse text into segments of ANSI codes and graphemes
 */
function parseTextSegments(text: string): TextSegment[] {
	const segmenter = new Intl.Segmenter()
	const segments: TextSegment[] = []
	let i = 0

	while (i < text.length) {
		// Check for ANSI escape sequence (ESC [)
		if (text[i] === "\x1b" && text[i + 1] === "[") {
			let j = i + 2
			while (j < text.length && !/[mGKHJ]/.test(text[j] ?? "")) {
				j++
			}
			if (j < text.length) {
				segments.push({ type: "ansi", value: text.substring(i, j + 1) })
				i = j + 1
				continue
			}
		}

		// Find next ANSI code or end of string
		let end = i
		while (end < text.length) {
			if (text[end] === "\x1b" && text[end + 1] === "[") break
			end++
		}

		// Segment this non-ANSI portion into graphemes
		const textPortion = text.slice(i, end)
		for (const seg of segmenter.segment(textPortion)) {
			segments.push({ type: "grapheme", value: seg.segment })
		}
		i = end
	}

	return segments
}

/**
 * Truncate text to fit within a maximum visible width, adding ellipsis if needed.
 * Properly handles ANSI escape codes (they don't count toward width).
 *
 * @param text - Text to truncate (may contain ANSI codes)
 * @param maxWidth - Maximum visible width
 * @param ellipsis - Ellipsis string to append when truncating (default: "...")
 * @returns Truncated text with ellipsis if it exceeded maxWidth
 */
export function truncateToWidth(text: string, maxWidth: number, ellipsis: string = "..."): string {
	const textVisibleWidth = visibleWidth(text)

	if (textVisibleWidth <= maxWidth) {
		return text
	}

	const ellipsisWidth = visibleWidth(ellipsis)
	const targetWidth = maxWidth - ellipsisWidth

	if (targetWidth <= 0) {
		return ellipsis.substring(0, maxWidth)
	}

	const segments = parseTextSegments(text)
	let result = ""
	let currentWidth = 0

	for (const seg of segments) {
		if (seg.type === "ansi") {
			result += seg.value
			continue
		}

		const grapheme = seg.value
		const graphemeWidth = visibleWidth(grapheme)

		if (currentWidth + graphemeWidth > targetWidth) {
			break
		}

		result += grapheme
		currentWidth += graphemeWidth
	}

	// Add reset code before ellipsis to prevent styling leaking
	return `${result}\x1b[0m${ellipsis}`
}

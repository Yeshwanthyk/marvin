/**
 * Image component for rendering images in the terminal
 * 
 * Supports Kitty and iTerm2 image protocols with automatic detection.
 * Falls back to text placeholder when images aren't supported.
 */

import { createMemo, Show } from "solid-js"
import { type RGBA, useTheme } from "../context/theme.js"

// Terminal image protocol types
export type ImageProtocol = "kitty" | "iterm2" | null

export interface TerminalCapabilities {
	images: ImageProtocol
	trueColor: boolean
}

export interface ImageDimensions {
	widthPx: number
	heightPx: number
}

export interface CellDimensions {
	widthPx: number
	heightPx: number
}

export interface ImageProps {
	/** Base64 encoded image data */
	data: string
	/** MIME type of the image */
	mimeType: string
	/** Image dimensions (will be auto-detected if not provided) */
	dimensions?: ImageDimensions
	/** Maximum width in terminal cells */
	maxWidth?: number
	/** Maximum height in terminal cells */
	maxHeight?: number
	/** Filename for fallback display */
	filename?: string
	/** Fallback text color */
	fallbackColor?: RGBA
}

// Cache terminal capabilities
let cachedCapabilities: TerminalCapabilities | null = null

// Default cell dimensions
let cellDimensions: CellDimensions = { widthPx: 9, heightPx: 18 }

export function setCellDimensions(dims: CellDimensions): void {
	cellDimensions = dims
}

export function getCellDimensions(): CellDimensions {
	return cellDimensions
}

/**
 * Detect terminal image capabilities
 */
export function detectCapabilities(): TerminalCapabilities {
	const env = process.env
	const termProgram = env["TERM_PROGRAM"]?.toLowerCase() || ""
	const term = env["TERM"]?.toLowerCase() || ""
	const colorTerm = env["COLORTERM"]?.toLowerCase() || ""

	// Kitty protocol support
	if (env["KITTY_WINDOW_ID"] || termProgram === "kitty") {
		return { images: "kitty", trueColor: true }
	}
	if (termProgram === "ghostty" || term.includes("ghostty")) {
		return { images: "kitty", trueColor: true }
	}
	if (env["WEZTERM_PANE"] || termProgram === "wezterm") {
		return { images: "kitty", trueColor: true }
	}

	// iTerm2 protocol support
	if (env["ITERM_SESSION_ID"] || termProgram === "iterm.app") {
		return { images: "iterm2", trueColor: true }
	}

	// No image support
	const trueColor = colorTerm === "truecolor" || colorTerm === "24bit"
	return { images: null, trueColor }
}

export function getCapabilities(): TerminalCapabilities {
	if (!cachedCapabilities) {
		cachedCapabilities = detectCapabilities()
	}
	return cachedCapabilities
}

export function resetCapabilitiesCache(): void {
	cachedCapabilities = null
}

/**
 * Encode image using Kitty graphics protocol
 */
function encodeKitty(base64Data: string, columns: number, rows: number): string {
	const CHUNK_SIZE = 4096
	const params = ["a=T", "f=100", "q=2", `c=${columns}`, `r=${rows}`]

	if (base64Data.length <= CHUNK_SIZE) {
		return `\x1b_G${params.join(",")};${base64Data}\x1b\\`
	}

	const chunks: string[] = []
	let offset = 0
	let isFirst = true

	while (offset < base64Data.length) {
		const chunk = base64Data.slice(offset, offset + CHUNK_SIZE)
		const isLast = offset + CHUNK_SIZE >= base64Data.length

		if (isFirst) {
			chunks.push(`\x1b_G${params.join(",")},m=1;${chunk}\x1b\\`)
			isFirst = false
		} else if (isLast) {
			chunks.push(`\x1b_Gm=0;${chunk}\x1b\\`)
		} else {
			chunks.push(`\x1b_Gm=1;${chunk}\x1b\\`)
		}
		offset += CHUNK_SIZE
	}

	return chunks.join("")
}

/**
 * Encode image using iTerm2 inline image protocol
 */
function encodeITerm2(base64Data: string, width: number): string {
	const params = [`inline=1`, `width=${width}`, `height=auto`, `preserveAspectRatio=1`]
	return `\x1b]1337;File=${params.join(";")}:${base64Data}\x07`
}

/**
 * Calculate image rows based on dimensions and cell size
 */
function calculateRows(imageDims: ImageDimensions, targetWidthCells: number): number {
	const targetWidthPx = targetWidthCells * cellDimensions.widthPx
	const scale = targetWidthPx / imageDims.widthPx
	const scaledHeightPx = imageDims.heightPx * scale
	const rows = Math.ceil(scaledHeightPx / cellDimensions.heightPx)
	return Math.max(1, rows)
}

// Image dimension extractors
function getPngDimensions(base64Data: string): ImageDimensions | null {
	try {
		const buffer = Buffer.from(base64Data, "base64")
		if (buffer.length < 24) return null
		if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null
		return { widthPx: buffer.readUInt32BE(16), heightPx: buffer.readUInt32BE(20) }
	} catch {
		return null
	}
}

function getJpegDimensions(base64Data: string): ImageDimensions | null {
	try {
		const buffer = Buffer.from(base64Data, "base64")
		if (buffer.length < 2 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

		let offset = 2
		while (offset < buffer.length - 9) {
			if (buffer[offset] !== 0xff) { offset++; continue }
			const marker = buffer[offset + 1]
			if (marker !== undefined && marker >= 0xc0 && marker <= 0xc2) {
				return { widthPx: buffer.readUInt16BE(offset + 7), heightPx: buffer.readUInt16BE(offset + 5) }
			}
			if (offset + 3 >= buffer.length) return null
			const length = buffer.readUInt16BE(offset + 2)
			if (length < 2) return null
			offset += 2 + length
		}
		return null
	} catch {
		return null
	}
}

function getGifDimensions(base64Data: string): ImageDimensions | null {
	try {
		const buffer = Buffer.from(base64Data, "base64")
		if (buffer.length < 10) return null
		const sig = buffer.slice(0, 6).toString("ascii")
		if (sig !== "GIF87a" && sig !== "GIF89a") return null
		return { widthPx: buffer.readUInt16LE(6), heightPx: buffer.readUInt16LE(8) }
	} catch {
		return null
	}
}

function getWebpDimensions(base64Data: string): ImageDimensions | null {
	try {
		const buffer = Buffer.from(base64Data, "base64")
		if (buffer.length < 30) return null
		if (buffer.slice(0, 4).toString("ascii") !== "RIFF") return null
		if (buffer.slice(8, 12).toString("ascii") !== "WEBP") return null

		const chunk = buffer.slice(12, 16).toString("ascii")
		if (chunk === "VP8 " && buffer.length >= 30) {
			return { widthPx: buffer.readUInt16LE(26) & 0x3fff, heightPx: buffer.readUInt16LE(28) & 0x3fff }
		}
		if (chunk === "VP8L" && buffer.length >= 25) {
			const bits = buffer.readUInt32LE(21)
			return { widthPx: (bits & 0x3fff) + 1, heightPx: ((bits >> 14) & 0x3fff) + 1 }
		}
		if (chunk === "VP8X" && buffer.length >= 30) {
			return {
				widthPx: ((buffer[24] ?? 0) | ((buffer[25] ?? 0) << 8) | ((buffer[26] ?? 0) << 16)) + 1,
				heightPx: ((buffer[27] ?? 0) | ((buffer[28] ?? 0) << 8) | ((buffer[29] ?? 0) << 16)) + 1,
			}
		}
		return null
	} catch {
		return null
	}
}

/**
 * Get image dimensions from base64 data
 */
export function getImageDimensions(base64Data: string, mimeType: string): ImageDimensions | null {
	if (mimeType === "image/png") return getPngDimensions(base64Data)
	if (mimeType === "image/jpeg") return getJpegDimensions(base64Data)
	if (mimeType === "image/gif") return getGifDimensions(base64Data)
	if (mimeType === "image/webp") return getWebpDimensions(base64Data)
	return null
}

/**
 * Generate fallback text for images
 */
function imageFallback(mimeType: string, dimensions?: ImageDimensions, filename?: string): string {
	const parts: string[] = []
	if (filename) parts.push(filename)
	parts.push(`[${mimeType}]`)
	if (dimensions) parts.push(`${dimensions.widthPx}x${dimensions.heightPx}`)
	return `[Image: ${parts.join(" ")}]`
}

/**
 * Image component for rendering inline images in the terminal
 *
 * @example
 * ```tsx
 * <Image
 *   data={base64ImageData}
 *   mimeType="image/png"
 *   maxWidth={60}
 * />
 * ```
 */
export function Image(props: ImageProps) {
	const { theme } = useTheme()
	const caps = getCapabilities()
	const fallbackColor = () => props.fallbackColor ?? theme.textMuted

	// Get or detect dimensions
	const dimensions = createMemo(() => {
		if (props.dimensions) return props.dimensions
		return getImageDimensions(props.data, props.mimeType) ?? { widthPx: 800, heightPx: 600 }
	})

	const maxWidth = () => props.maxWidth ?? 60

	// Render image or fallback
	const renderResult = createMemo(() => {
		if (!caps.images) {
			return { type: "fallback" as const, text: imageFallback(props.mimeType, dimensions(), props.filename) }
		}

		const width = Math.min(maxWidth(), 80)
		const rows = calculateRows(dimensions(), width)

		if (caps.images === "kitty") {
			const sequence = encodeKitty(props.data, width, rows)
			return { type: "image" as const, sequence, rows }
		}

		if (caps.images === "iterm2") {
			const sequence = encodeITerm2(props.data, width)
			return { type: "image" as const, sequence, rows }
		}

		return { type: "fallback" as const, text: imageFallback(props.mimeType, dimensions(), props.filename) }
	})

	return (
		<Show
			when={renderResult().type === "image"}
			fallback={<text fg={fallbackColor()}>{(renderResult() as { type: "fallback"; text: string }).text}</text>}
		>
			{/* 
				For image rendering, we output the escape sequence directly.
				The rows are used to reserve space in the terminal.
				OpenTUI's text buffer should handle the escape sequences.
			*/}
			<box height={(renderResult() as { type: "image"; rows: number }).rows}>
				<text>{(renderResult() as { type: "image"; sequence: string }).sequence}</text>
			</box>
		</Show>
	)
}

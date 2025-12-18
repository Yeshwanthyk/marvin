import stringWidth from "string-width"

/**
 * Calculate the visible width of a string in terminal columns.
 * Handles ANSI codes (ignored) and tabs (3 spaces).
 */
export function visibleWidth(str: string): number {
  const normalized = str.replace(/\t/g, "   ")
  return stringWidth(normalized)
}

/**
 * Truncate text to fit within a maximum visible width.
 * Properly handles ANSI escape codes.
 */
export function truncateToWidth(text: string, maxWidth: number, ellipsis = "…"): string {
  const textWidth = visibleWidth(text)
  if (textWidth <= maxWidth) return text

  const ellipsisWidth = visibleWidth(ellipsis)
  const targetWidth = maxWidth - ellipsisWidth
  if (targetWidth <= 0) return ellipsis.slice(0, maxWidth)

  // Simple character-by-character truncation
  // Skip ANSI codes while counting visible width
  let result = ""
  let currentWidth = 0
  let i = 0

  while (i < text.length && currentWidth < targetWidth) {
    // Check for ANSI escape sequence
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      let j = i + 2
      while (j < text.length && !/[mGKHJ]/.test(text[j]!)) j++
      result += text.slice(i, j + 1)
      i = j + 1
      continue
    }

    const char = text[i]!
    const charWidth = visibleWidth(char)
    if (currentWidth + charWidth > targetWidth) break

    result += char
    currentWidth += charWidth
    i++
  }

  return result + "\x1b[0m" + ellipsis
}

/**
 * Wrap text to fit within a width, preserving ANSI codes.
 */
export function wrapText(text: string, width: number): string[] {
  if (!text) return [""]

  const lines: string[] = []
  const inputLines = text.split("\n")

  for (const line of inputLines) {
    if (visibleWidth(line) <= width) {
      lines.push(line)
      continue
    }

    // Word wrap
    const words = line.split(/(\s+)/)
    let currentLine = ""
    let currentWidth = 0

    for (const word of words) {
      const wordWidth = visibleWidth(word)

      if (currentWidth + wordWidth <= width) {
        currentLine += word
        currentWidth += wordWidth
      } else if (wordWidth > width) {
        // Word too long, break it
        if (currentLine) {
          lines.push(currentLine)
          currentLine = ""
          currentWidth = 0
        }
        // Break long word character by character
        for (const char of word) {
          const charWidth = visibleWidth(char)
          if (currentWidth + charWidth > width) {
            lines.push(currentLine)
            currentLine = char
            currentWidth = charWidth
          } else {
            currentLine += char
            currentWidth += charWidth
          }
        }
      } else {
        if (currentLine.trim()) lines.push(currentLine)
        currentLine = word.trimStart()
        currentWidth = visibleWidth(currentLine)
      }
    }

    if (currentLine) lines.push(currentLine)
  }

  return lines.length ? lines : [""]
}

/**
 * Format a number with k/M suffixes for display
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1) + "k"
  if (n < 1000000) return Math.round(n / 1000) + "k"
  return (n / 1000000).toFixed(1) + "M"
}

/**
 * Format cost in dollars
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) return "<$0.01"
  if (cost < 1) return "$" + cost.toFixed(2)
  return "$" + cost.toFixed(2)
}

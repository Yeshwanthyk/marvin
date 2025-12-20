/**
 * Clipboard utilities for terminal applications
 * Uses OSC 52 escape sequence for broad terminal support
 */

import { spawnSync } from "child_process"

/**
 * Copy text to clipboard using OSC 52 escape sequence
 * Falls back to pbcopy on macOS if OSC 52 fails
 */
export function copyToClipboard(text: string): boolean {
	if (!text) return false

	// Try OSC 52 first (works in iTerm2, kitty, Ghostty, tmux with set-clipboard on, etc.)
	const base64 = Buffer.from(text).toString("base64")
	const osc52 = `\x1b]52;c;${base64}\x07`
	process.stdout.write(osc52)

	// Also try pbcopy on macOS as fallback (OSC 52 may be disabled or unsupported)
	if (process.platform === "darwin") {
		try {
			const result = spawnSync("pbcopy", { input: text, encoding: "utf-8" })
			return result.status === 0
		} catch {
			// pbcopy not available, OSC 52 was our only attempt
		}
	}

	return true
}

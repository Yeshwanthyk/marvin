/**
 * Clipboard utilities for terminal applications
 * Uses native clipboard commands with OSC 52 fallback
 */

import { spawnSync } from "child_process"

/**
 * Copy text to clipboard using platform-native commands
 * Falls back to OSC 52 escape sequence for terminal support
 * 
 * @returns true if clipboard command succeeded, false if only OSC 52 was attempted
 */
export function copyToClipboard(text: string): boolean {
	if (!text) return false

	// Try platform-native clipboard first (verifiable)
	if (process.platform === "darwin") {
		try {
			const result = spawnSync("pbcopy", { input: text, encoding: "utf-8" })
			if (result.status === 0) return true
		} catch {
			// pbcopy not available
		}
	} else if (process.platform === "linux") {
		// Try xclip first, then xsel, then wl-copy (Wayland)
		const tools = [
			["xclip", ["-selection", "clipboard"]],
			["xsel", ["--clipboard", "--input"]],
			["wl-copy"],
		] as const

		for (const [cmd, args = []] of tools) {
			try {
				const result = spawnSync(cmd, args, { input: text, encoding: "utf-8" })
				if (result.status === 0) return true
			} catch {
				// Tool not available, try next
			}
		}
	}

	// Fall back to OSC 52 (works in iTerm2, kitty, Ghostty, tmux with set-clipboard on)
	// Note: We cannot verify if OSC 52 succeeded
	const base64 = Buffer.from(text).toString("base64")

	// In tmux, we need to wrap OSC 52 in DCS passthrough sequence
	if (process.env.TMUX) {
		process.stdout.write(`\x1bPtmux;\x1b\x1b]52;c;${base64}\x07\x1b\\`)
	} else {
		process.stdout.write(`\x1b]52;c;${base64}\x07`)
	}

	// Return false to indicate we couldn't verify success
	return false
}

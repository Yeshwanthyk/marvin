/**
 * Keyboard event handling for TUI application
 */

import type { KeyEvent } from "@opentui/core"

export interface KeyboardHandlerConfig {
	// Autocomplete state getters
	showAutocomplete: () => boolean
	autocompleteItems: () => Array<{ label: string; description?: string }>
	setAutocompleteIndex: (updater: (i: number) => number) => void
	setShowAutocomplete: (v: boolean) => void
	applyAutocomplete: () => boolean

	// Responding state
	isResponding: boolean
	retryStatus: string | null

	// Actions
	onAbort: () => string | null
	onToggleThinking: () => void
	onCycleModel: () => void
	onCycleThinking: () => void
	toggleLastToolExpanded: () => void
	copySelectionToClipboard: () => void

	// Editor control
	clearEditor: () => void
	setEditorText: (text: string) => void

	// Ctrl+C timing
	lastCtrlC: { current: number }
}

export function createKeyboardHandler(config: KeyboardHandlerConfig): (e: KeyEvent) => void {
	return (e: KeyEvent) => {
		// Autocomplete navigation
		if (config.showAutocomplete()) {
			const items = config.autocompleteItems()
			if (e.name === "up") {
				config.setAutocompleteIndex((i) => (i > 0 ? i - 1 : items.length - 1))
				e.preventDefault()
				return
			}
			if (e.name === "down") {
				config.setAutocompleteIndex((i) => (i < items.length - 1 ? i + 1 : 0))
				e.preventDefault()
				return
			}
			if (e.name === "tab" || e.name === "return") {
				if (config.applyAutocomplete()) {
					e.preventDefault()
					return
				}
			}
			if (e.name === "escape") {
				config.setShowAutocomplete(false)
				e.preventDefault()
				return
			}
		}

		// Ctrl+N/Ctrl+P for autocomplete navigation
		if (config.showAutocomplete() && e.ctrl && (e.name === "n" || e.name === "p")) {
			const items = config.autocompleteItems()
			if (e.name === "n") {
				config.setAutocompleteIndex((i) => (i < items.length - 1 ? i + 1 : 0))
			} else {
				config.setAutocompleteIndex((i) => (i > 0 ? i - 1 : items.length - 1))
			}
			e.preventDefault()
			return
		}

		// Ctrl+C - abort or exit
		if (e.ctrl && e.name === "c") {
			const now = Date.now()
			if (config.isResponding) {
				config.onAbort()
			} else if (now - config.lastCtrlC.current < 750) {
				process.exit(0)
			} else {
				config.clearEditor()
			}
			config.lastCtrlC.current = now
			e.preventDefault()
			return
		}

		// Escape - abort if responding
		if (e.name === "escape" && (config.isResponding || config.retryStatus)) {
			const restore = config.onAbort()
			if (restore) config.setEditorText(restore)
			e.preventDefault()
			return
		}

		// Ctrl+O - toggle latest tool block
		if (e.ctrl && e.name === "o") {
			config.toggleLastToolExpanded()
			e.preventDefault()
			return
		}

		// Ctrl+T - toggle thinking visibility
		if (e.ctrl && e.name === "t") {
			config.onToggleThinking()
			e.preventDefault()
			return
		}

		// Ctrl+P - cycle model
		if (e.ctrl && e.name === "p") {
			config.onCycleModel()
			e.preventDefault()
			return
		}

		// Ctrl+Y - copy selection to clipboard
		if (e.ctrl && e.name === "y") {
			config.copySelectionToClipboard()
			e.preventDefault()
			return
		}

		// Shift+Tab - cycle thinking level
		if (e.shift && e.name === "tab") {
			config.onCycleThinking()
			e.preventDefault()
			return
		}
	}
}

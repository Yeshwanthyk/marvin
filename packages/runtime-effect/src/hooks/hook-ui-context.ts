import type { HookUIContext } from "./types.js"
import type { JSX } from "solid-js"

/**
 * Handlers for creating a HookUIContext.
 */
export interface HookUIHandlers {
	setEditorText: (text: string) => void
	getEditorText: () => string
	showSelect: (title: string, options: string[]) => Promise<string | undefined>
	showInput: (title: string, placeholder?: string) => Promise<string | undefined>
	showConfirm: (title: string, message: string) => Promise<boolean>
	showNotify: (message: string, type?: "info" | "warning" | "error") => void
	showEditor?: (title: string, initialText?: string) => Promise<string | undefined>
	showCustom?: <T>(factory: (done: (result: T) => void) => JSX.Element) => Promise<T | undefined>
}

/**
 * Create a HookUIContext from UI handlers.
 */
export function createHookUIContext(handlers: HookUIHandlers): HookUIContext {
	return {
		select: handlers.showSelect,
		confirm: handlers.showConfirm,
		input: handlers.showInput,
		editor: handlers.showEditor ?? (async () => undefined),
		notify: handlers.showNotify,
		custom: handlers.showCustom ?? (async () => undefined),
		setEditorText: handlers.setEditorText,
		getEditorText: handlers.getEditorText,
	}
}

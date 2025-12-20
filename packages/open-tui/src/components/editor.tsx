/**
 * Editor component - wrapper around OpenTUI's TextareaRenderable
 *
 * Provides a multi-line text input with keyboard navigation, history,
 * and autocomplete support.
 */

import { TextareaRenderable, type KeyEvent } from "@opentui/core"
import { createEffect } from "solid-js"
import { type RGBA, useTheme } from "../context/theme.js"

export interface EditorTheme {
	border: RGBA
	borderActive: RGBA
	text: RGBA
	cursor: RGBA
	placeholder: RGBA
	background: RGBA
}

export interface EditorProps {
	/** Initial text content */
	initialValue?: string
	/** Placeholder text when empty */
	placeholder?: string
	/** Whether the editor is focused */
	focused?: boolean
	/** Whether input is disabled */
	disabled?: boolean
	/** Minimum height in lines */
	minHeight?: number
	/** Maximum height in lines */
	maxHeight?: number
	/** Optional width constraint */
	width?: number | "auto" | `${number}%`
	/** Optional max width constraint */
	maxWidth?: number | "auto" | `${number}%`
	/** Theme overrides */
	theme?: Partial<EditorTheme>
	/** Called when content changes */
	onChange?: (text: string) => void
	/** Called when Enter is pressed (submit) */
	onSubmit?: (text: string) => void
	/** Called when Escape is pressed */
	onEscape?: () => void
	/** Ref callback to get the textarea renderable */
	ref?: (ref: EditorRef) => void
}

export interface EditorRef {
	/** Get current text content */
	getText: () => string
	/** Set text content */
	setText: (text: string) => void
	/** Clear the editor */
	clear: () => void
	/** Focus the editor */
	focus: () => void
	/** Blur the editor */
	blur: () => void
	/** Get the underlying TextareaRenderable */
	getTextarea: () => TextareaRenderable | undefined
}

// Default keybindings for the textarea
const defaultKeybindings = [
	{ name: "left", action: "move-left" as const },
	{ name: "right", action: "move-right" as const },
	{ name: "up", action: "move-up" as const },
	{ name: "down", action: "move-down" as const },
	{ name: "home", action: "buffer-home" as const },
	{ name: "end", action: "buffer-end" as const },
	{ name: "a", ctrl: true, action: "line-home" as const },
	{ name: "e", ctrl: true, action: "line-end" as const },
	{ name: "backspace", action: "backspace" as const },
	{ name: "delete", action: "delete" as const },
	{ name: "w", ctrl: true, action: "delete-word-backward" as const },
	{ name: "k", ctrl: true, action: "delete-to-line-end" as const },
	{ name: "u", ctrl: true, action: "delete-to-line-start" as const },
	{ name: "return", meta: true, action: "newline" as const },
	{ name: "return", action: "submit" as const },
	{ name: "z", super: true, action: "undo" as const },
	{ name: "z", super: true, shift: true, action: "redo" as const },
]

/**
 * Editor component for multi-line text input
 */
export function Editor(props: EditorProps) {
	const { theme: globalTheme } = useTheme()
	let textareaRef: TextareaRenderable | undefined

	const theme = (): EditorTheme => ({
		border: props.theme?.border ?? globalTheme.border,
		borderActive: props.theme?.borderActive ?? globalTheme.borderActive,
		text: props.theme?.text ?? globalTheme.text,
		cursor: props.theme?.cursor ?? globalTheme.text,
		placeholder: props.theme?.placeholder ?? globalTheme.textMuted,
		background: props.theme?.background ?? globalTheme.backgroundPanel,
	})

	const editorRef: EditorRef = {
		getText: () => textareaRef?.plainText ?? "",
		setText: (text: string) => textareaRef?.setText(text),
		clear: () => textareaRef?.clear(),
		focus: () => textareaRef?.focus(),
		blur: () => textareaRef?.blur(),
		getTextarea: () => textareaRef,
	}

	createEffect(() => {
		if (props.ref && textareaRef) props.ref(editorRef)
	})

	const handleKeyDown = (e: KeyEvent) => {
		if (props.disabled) {
			e.preventDefault()
			return
		}

		if (e.name === "escape") {
			props.onEscape?.()
			e.preventDefault()
		}
	}

	const handleSubmit = () => {
		if (props.disabled) return
		const text = textareaRef?.plainText?.trim() ?? ""
		if (!text) return
		props.onSubmit?.(text)
	}

	const handleContentChange = () => {
		props.onChange?.(textareaRef?.plainText ?? "")
	}

	const borderColor = () => (props.focused ? theme().borderActive : theme().border)

	const textareaProps: Record<string, unknown> = {
		minHeight: props.minHeight ?? 1,
		maxHeight: props.maxHeight ?? 10,
		backgroundColor: theme().background,
		focusedBackgroundColor: theme().background,
		textColor: theme().text,
		focusedTextColor: theme().text,
		cursorColor: theme().cursor,
		keyBindings: defaultKeybindings,
		onKeyDown: handleKeyDown,
		onSubmit: handleSubmit,
		onContentChange: handleContentChange,
	}
	if (props.initialValue !== undefined) {
		textareaProps["initialValue"] = props.initialValue
	}
	if (props.placeholder) {
		textareaProps["placeholder"] = props.placeholder
	}
	if (props.focused !== undefined) {
		textareaProps["focused"] = props.focused
	}

	const boxProps: Record<string, unknown> = {
		flexDirection: "column",
		border: true,
		borderColor: borderColor(),
		backgroundColor: theme().background,
		paddingLeft: 1,
		paddingRight: 1,
	}
	if (props.width !== undefined) boxProps["width"] = props.width
	if (props.maxWidth !== undefined) boxProps["maxWidth"] = props.maxWidth

	return (
		<box {...boxProps}>
			<textarea
				ref={(r: TextareaRenderable) => {
					textareaRef = r
					props.ref?.(editorRef)
				}}
				{...textareaProps}
			/>
		</box>
	)
}

/**
 * Simple single-line input component
 */
export interface InputProps {
	/** Current value */
	value?: string
	/** Placeholder text */
	placeholder?: string
	/** Whether the input is focused */
	focused?: boolean
	/** Called when value changes */
	onChange?: (value: string) => void
	/** Called when Enter is pressed */
	onSubmit?: (value: string) => void
	/** Called when Escape is pressed */
	onEscape?: () => void
	/** Theme overrides */
	theme?: Partial<EditorTheme>
	/** Optional width constraint */
	width?: EditorProps["width"]
	/** Optional max width constraint */
	maxWidth?: EditorProps["maxWidth"]
}

export function Input(props: InputProps) {
	const editorProps: EditorProps = {
		minHeight: 1,
		maxHeight: 1,
	}
	if (props.value !== undefined) editorProps.initialValue = props.value
	if (props.placeholder !== undefined) editorProps.placeholder = props.placeholder
	if (props.focused !== undefined) editorProps.focused = props.focused
	if (props.theme !== undefined) editorProps.theme = props.theme
	if (props.onChange !== undefined) editorProps.onChange = props.onChange
	if (props.onSubmit !== undefined) editorProps.onSubmit = props.onSubmit
	if (props.onEscape !== undefined) editorProps.onEscape = props.onEscape
	if (props.width !== undefined) editorProps.width = props.width
	if (props.maxWidth !== undefined) editorProps.maxWidth = props.maxWidth

	return <Editor {...editorProps} />
}

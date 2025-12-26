/**
 * Markdown renderer using @opentui/core's tree-sitter based <code> component
 */

import type { JSX } from "solid-js"
import { useTheme } from "../context/theme.js"

export interface MarkdownProps {
	/** Markdown text to render */
	text: string
	/** Enable conceal mode (hides markdown syntax like **, #, etc.) */
	conceal?: boolean
	/** Whether content is actively streaming */
	streaming?: boolean
}

/**
 * Markdown component that renders markdown text with tree-sitter syntax highlighting
 *
 * @example
 * ```tsx
 * <Markdown text="# Hello\n\nThis is **bold** text." />
 * ```
 */
export function Markdown(props: MarkdownProps): JSX.Element {
	const { theme, syntaxStyle } = useTheme()

	return (
		<code
			filetype="markdown"
			content={props.text ?? ""}
			syntaxStyle={syntaxStyle}
			conceal={props.conceal ?? true}
			streaming={props.streaming ?? false}
			drawUnstyledText={false}
			fg={theme.markdownText}
		/>
	)
}

// Re-export for backwards compatibility
export interface MarkdownTheme {
	text?: string
	heading?: string
	// Note: granular theming now handled via ThemeColors
}

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
	/** Use dimmed/subtle styling (for secondary content like thinking blocks) */
	dim?: boolean
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
	const { theme, syntaxStyle, subtleSyntaxStyle } = useTheme()

	const isStreaming = props.streaming ?? false
	const commonProps = {
		content: props.text ?? "",
		syntaxStyle: props.dim ? subtleSyntaxStyle : syntaxStyle,
		conceal: props.conceal ?? true,
		streaming: isStreaming,
		drawUnstyledText: true as const,
		fg: props.dim ? theme.textMuted : theme.markdownText,
	}

	if (isStreaming) {
		// Skip tree-sitter while streaming to avoid O(n) highlight cost.
		return <code {...commonProps} />
	}

	return <code filetype="markdown" {...commonProps} />
}

// Re-export for backwards compatibility
export interface MarkdownTheme {
	text?: string
	heading?: string
	// Note: granular theming now handled via ThemeColors
}

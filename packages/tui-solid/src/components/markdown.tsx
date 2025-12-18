import { colors } from "../utils/colors.js"

export interface MarkdownProps {
  content: string
  /** Stream mode - for content that's being typed */
  streaming?: boolean
}

/**
 * Markdown component that renders markdown content.
 *
 * For now, renders as plain text. Can be enhanced with syntax highlighting
 * by using opentui's <code filetype="markdown"> with a SyntaxStyle.
 */
export function Markdown(props: MarkdownProps) {
  // Return just a span - don't wrap in <text> since we're often used inside <text>
  return <span style={{ fg: colors.text }}>{props.content}</span>
}

/**
 * Simple styled text for inline markdown elements.
 * For cases where full markdown parsing isn't needed.
 */
export function InlineCode(props: { children: string }) {
  return (
    <span style={{ fg: colors.codeAlt }}>{props.children}</span>
  )
}

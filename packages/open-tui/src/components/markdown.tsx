/**
 * Markdown renderer using @opentui/core's tree-sitter based <code> component
 */

import { createMemo, For, Match, Switch, type JSX } from "solid-js"
import { TextAttributes } from "@opentui/core"
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

export type StreamingMarkdownLine =
	| { kind: "blank"; text: "" }
	| { kind: "heading"; text: string; level: number }
	| { kind: "list"; text: string; marker: string }
	| { kind: "quote"; text: string }
	| { kind: "code"; text: string }
	| { kind: "codeFence"; text: string }
	| { kind: "paragraph"; text: string }

const stripInlineMarkdown = (text: string): string =>
	text
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/`([^`]+)`/g, "$1")

export function parseStreamingMarkdownLines(text: string, conceal = true): StreamingMarkdownLine[] {
	const lines = (text ?? "").split("\n")
	const parsed: StreamingMarkdownLine[] = []
	let inCodeFence = false

	for (const rawLine of lines) {
		const line = rawLine.replace(/\t/g, "  ")
		const trimmed = line.trim()

		if (trimmed.startsWith("```")) {
			inCodeFence = !inCodeFence
			parsed.push({ kind: "codeFence", text: conceal ? trimmed.replace(/^```/, "code ").trim() || "code" : trimmed })
			continue
		}

		if (inCodeFence) {
			parsed.push({ kind: "code", text: line })
			continue
		}

		if (trimmed.length === 0) {
			parsed.push({ kind: "blank", text: "" })
			continue
		}

		const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
		if (heading) {
			parsed.push({
				kind: "heading",
				level: heading[1]?.length ?? 1,
				text: conceal ? stripInlineMarkdown(heading[2] ?? "") : trimmed,
			})
			continue
		}

		const list = trimmed.match(/^([-*+]|\d+\.)\s+(.*)$/)
		if (list) {
			parsed.push({
				kind: "list",
				marker: list[1] ?? "-",
				text: conceal ? stripInlineMarkdown(list[2] ?? "") : trimmed,
			})
			continue
		}

		if (trimmed.startsWith(">")) {
			const quote = trimmed.replace(/^>\s?/, "")
			parsed.push({ kind: "quote", text: conceal ? stripInlineMarkdown(quote) : trimmed })
			continue
		}

		parsed.push({ kind: "paragraph", text: conceal ? stripInlineMarkdown(line) : line })
	}

	return parsed
}

function StreamingMarkdown(props: { text: string; conceal?: boolean | undefined; dim?: boolean | undefined }): JSX.Element {
	const { theme } = useTheme()
	const rows = createMemo(() => {
		const parsed = parseStreamingMarkdownLines(props.text, props.conceal ?? true)
		const lastIndex = parsed.length - 1
		return parsed.map((line, index) => ({ line, isLast: index === lastIndex }))
	})
	const textColor = () => props.dim ? theme.textMuted : theme.markdownText

	return (
		<box flexDirection="column">
			<For each={rows()}>
				{(row) => (
					<Switch>
						<Match when={row.line.kind === "blank"}>
							<box height={row.isLast ? 0 : 1} />
						</Match>
						<Match when={row.line.kind === "heading" && row.line}>
							{(heading) => (
								<text fg={props.dim ? theme.textMuted : theme.markdownHeading} attributes={TextAttributes.BOLD}>
									{heading().text}
								</text>
							)}
						</Match>
						<Match when={row.line.kind === "list" && row.line}>
							{(list) => (
								<text>
									<span style={{ fg: theme.markdownListBullet }}>{list().marker}</span>
									<span style={{ fg: theme.textMuted }}> </span>
									<span style={{ fg: textColor() }}>{list().text}</span>
								</text>
							)}
						</Match>
						<Match when={row.line.kind === "quote" && row.line}>
							{(quote) => (
								<text fg={theme.markdownBlockQuote} attributes={TextAttributes.ITALIC}>
									│ {quote().text}
								</text>
							)}
						</Match>
						<Match when={row.line.kind === "codeFence" && row.line}>
							{(fence) => (
								<text fg={theme.textMuted}>{fence().text}</text>
							)}
						</Match>
						<Match when={row.line.kind === "code" && row.line}>
							{(code) => (
								<box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
									<text fg={theme.markdownCodeBlock}>{code().text || " "}</text>
								</box>
							)}
						</Match>
						<Match when={row.line.kind === "paragraph" && row.line}>
							{(paragraph) => <text fg={textColor()}>{paragraph().text}</text>}
						</Match>
					</Switch>
				)}
			</For>
		</box>
	)
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
		return <StreamingMarkdown text={props.text ?? ""} conceal={props.conceal} dim={props.dim} />
	}

	return <code filetype="markdown" {...commonProps} />
}

// Re-export for backwards compatibility
export interface MarkdownTheme {
	text?: string
	heading?: string
	// Note: granular theming now handled via ThemeColors
}

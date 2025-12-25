/**
 * Markdown renderer using marked.js and OpenTUI text nodes
 */

import { TextAttributes } from "@opentui/core"
import { marked, type Token, type Tokens } from "marked"
import { createMemo, For, Show, type JSX } from "solid-js"
import { type RGBA, useTheme } from "../context/theme.js"
import { visibleWidth } from "../utils/text-width.js"

/**
 * Post-process tokens to fix ordered list numbering when lists are split by code blocks.
 * Marked.js breaks list continuity when non-list content appears between items.
 * This adds a _listStartOffset property to ordered lists to continue numbering.
 */
function mergeOrderedLists(tokens: Token[]): Token[] {
	const result: Token[] = []
	let inListContext = false
	let runningCount = 0

	for (const token of tokens) {
		if (token.type === "list" && (token as Tokens.List).ordered) {
			const list = token as Tokens.List
			if (inListContext) {
				// Continue numbering from previous list
				result.push({ ...list, _listStartOffset: runningCount } as Token)
				runningCount += list.items.length
			} else {
				// Start new list context
				inListContext = true
				runningCount = list.items.length
				result.push(token)
			}
		} else if (inListContext && (token.type === "code" || token.type === "space")) {
			// Code blocks and spaces don't break list context
			result.push(token)
		} else {
			// Non-list, non-code content breaks list context
			inListContext = false
			runningCount = 0
			result.push(token)
		}
	}

	return result
}

export interface MarkdownTheme {
	text: RGBA
	heading: RGBA
	link: RGBA
	linkUrl: RGBA
	code: RGBA
	codeBlock: RGBA
	codeBlockBorder: RGBA
	quote: RGBA
	quoteBorder: RGBA
	hr: RGBA
	listBullet: RGBA
	/** Syntax highlighter for fenced code blocks */
	highlightCode?: (code: string, lang?: string) => Array<{ text: string; fg?: RGBA }>
}

export interface MarkdownProps {
	/** Markdown text to render */
	text: string
	/** Horizontal padding */
	paddingX?: number
	/** Vertical padding */
	paddingY?: number
	/** Theme overrides */
	theme?: Partial<MarkdownTheme>
	/** Max width for content */
	maxWidth?: number
}

/**
 * Markdown component that renders markdown text with styling
 *
 * @example
 * ```tsx
 * <Markdown text="# Hello\n\nThis is **bold** text." />
 * ```
 */
export function Markdown(props: MarkdownProps) {
	const { theme } = useTheme()

	// Merge theme with defaults - all properties are required RGBA
	const mdTheme = createMemo((): MarkdownTheme => {
		const base: MarkdownTheme = {
			text: props.theme?.text ?? theme.markdownText,
			heading: props.theme?.heading ?? theme.markdownHeading,
			link: props.theme?.link ?? theme.markdownLink,
			linkUrl: props.theme?.linkUrl ?? theme.markdownLinkUrl,
			code: props.theme?.code ?? theme.markdownCode,
			codeBlock: props.theme?.codeBlock ?? theme.markdownCodeBlock,
			codeBlockBorder: props.theme?.codeBlockBorder ?? theme.markdownCodeBlockBorder,
			quote: props.theme?.quote ?? theme.markdownBlockQuote,
			quoteBorder: props.theme?.quoteBorder ?? theme.markdownBlockQuoteBorder,
			hr: props.theme?.hr ?? theme.markdownHr,
			listBullet: props.theme?.listBullet ?? theme.markdownListBullet,
		}
		if (props.theme?.highlightCode) {
			base.highlightCode = props.theme.highlightCode
		}
		return base
	})

	// Parse markdown to tokens
	const tokens = createMemo(() => {
		if (!props.text?.trim()) return []
		const normalized = props.text.replace(/\t/g, "   ")
		return mergeOrderedLists(marked.lexer(normalized))
	})

	const paddingX = () => props.paddingX ?? 0
	const paddingY = () => props.paddingY ?? 0

	return (
		<box
			paddingLeft={paddingX()}
			paddingRight={paddingX()}
			paddingTop={paddingY()}
			paddingBottom={paddingY()}
			flexDirection="column"
		>
			<For each={tokens()}>
				{(token, i) => (
					<TokenRenderer
						token={token}
						theme={mdTheme()}
						nextTokenType={tokens()[i() + 1]?.type}
						maxWidth={props.maxWidth}
					/>
				)}
			</For>
		</box>
	)
}

interface TokenRendererProps {
	token: Token
	theme: MarkdownTheme
	nextTokenType: string | undefined
	maxWidth: number | undefined
	depth?: number
}

function TokenRenderer(props: TokenRendererProps): JSX.Element {
	const { token, theme, nextTokenType, maxWidth } = props

	switch (token.type) {
		case "heading":
			return <HeadingToken token={token as Tokens.Heading} theme={theme} nextTokenType={nextTokenType} />

		case "paragraph":
			return <ParagraphToken token={token as Tokens.Paragraph} theme={theme} nextTokenType={nextTokenType} />

		case "code":
			return <CodeBlockToken token={token as Tokens.Code} theme={theme} nextTokenType={nextTokenType} />

		case "list":
			return <ListToken token={token as Tokens.List} theme={theme} depth={props.depth ?? 0} />

		case "blockquote":
			return <BlockquoteToken token={token as Tokens.Blockquote} theme={theme} nextTokenType={nextTokenType} />

		case "hr":
			return <HrToken theme={theme} nextTokenType={nextTokenType} maxWidth={maxWidth} />

		case "table":
			return <TableToken token={token as Tokens.Table} theme={theme} />

		case "space":
			return <box height={1} />

		case "html":
			return null

		default:
			if ("text" in token && typeof token.text === "string") {
				return <text fg={theme.text}>{token.text}</text>
			}
			return null
	}
}

// --- Block-level token renderers ---

function HeadingToken(props: { token: Tokens.Heading; theme: MarkdownTheme; nextTokenType: string | undefined }): JSX.Element {
	const { token, theme, nextTokenType } = props
	const prefix = () => (token.depth > 2 ? "#".repeat(token.depth) + " " : "")
	const attrs = () => {
		let a = TextAttributes.BOLD
		if (token.depth === 1) a |= TextAttributes.UNDERLINE
		return a
	}

	return (
		<box flexDirection="column">
			<text fg={theme.heading} attributes={attrs()}>
				{prefix()}
				<InlineTokens tokens={token.tokens ?? []} theme={theme} />
			</text>
			<Show when={nextTokenType !== "space"}>
				<box height={1} />
			</Show>
		</box>
	)
}

function ParagraphToken(props: { token: Tokens.Paragraph; theme: MarkdownTheme; nextTokenType: string | undefined }): JSX.Element {
	const { token, theme, nextTokenType } = props
	const showSpacing = () => nextTokenType && nextTokenType !== "list" && nextTokenType !== "space"

	return (
		<box flexDirection="column">
			<text fg={theme.text}>
				<InlineTokens tokens={token.tokens ?? []} theme={theme} />
			</text>
			<Show when={showSpacing()}>
				<box height={1} />
			</Show>
		</box>
	)
}

function CodeBlockToken(props: { token: Tokens.Code; theme: MarkdownTheme; nextTokenType: string | undefined }): JSX.Element {
	const { token, theme, nextTokenType } = props
	const lines = () => token.text.split("\n")

	// If highlighter provided, use it
	const highlightedLines = createMemo(() => {
		if (theme.highlightCode) {
			return theme.highlightCode(token.text, token.lang)
		}
		return null
	})

	return (
		<box flexDirection="column">
			<text fg={theme.codeBlockBorder}>{"```" + (token.lang || "")}</text>
			<Show
				when={highlightedLines()}
				fallback={
					<For each={lines()}>
						{(line) => (
							<text fg={theme.codeBlock}>{"  " + line}</text>
						)}
					</For>
				}
			>
				<For each={highlightedLines()!}>
					{(segment) => (
						<text fg={segment.fg ?? theme.codeBlock}>{"  " + segment.text}</text>
					)}
				</For>
			</Show>
			<text fg={theme.codeBlockBorder}>{"```"}</text>
			<Show when={nextTokenType !== "space"}>
				<box height={1} />
			</Show>
		</box>
	)
}

function ListToken(props: { token: Tokens.List; theme: MarkdownTheme; depth: number }): JSX.Element {
	const { token, theme, depth } = props
	const indent = "  ".repeat(depth)
	// Use offset from mergeOrderedLists if present (for continued lists)
	const startOffset = (token as Tokens.List & { _listStartOffset?: number })._listStartOffset ?? 0

	return (
		<box flexDirection="column">
			<For each={token.items}>
				{(item, i) => {
					const bullet = token.ordered ? `${startOffset + i() + 1}. ` : "- "
					return <ListItemToken item={item} bullet={bullet} indent={indent} theme={theme} depth={depth} />
				}}
			</For>
		</box>
	)
}

function ListItemToken(props: {
	item: Tokens.ListItem
	bullet: string
	indent: string
	theme: MarkdownTheme
	depth: number
}): JSX.Element {
	const { item, bullet, indent, theme, depth } = props

	// Separate text content from nested lists
	const textTokens = () => (item.tokens ?? []).filter((t) => t.type !== "list")
	const nestedLists = () => (item.tokens ?? []).filter((t) => t.type === "list") as Tokens.List[]

	// Task list checkbox rendering
	const checkbox = () => {
		if (!item.task) return null
		return item.checked ? "☑ " : "☐ "
	}
	const checkboxColor = () => item.checked ? theme.text : theme.listBullet

	return (
		<box flexDirection="column">
			{/* First line with bullet */}
			<text>
				<span style={{ fg: theme.text }}>{indent}</span>
				<span style={{ fg: theme.listBullet }}>{bullet}</span>
				{checkbox() && <span style={{ fg: checkboxColor() }}>{checkbox()}</span>}
				<For each={textTokens()}>
					{(t) => {
						if (t.type === "text") {
							const textToken = t as Tokens.Text
							return <InlineTokens tokens={textToken.tokens ?? [{ type: "text", text: textToken.text, raw: textToken.raw }]} theme={theme} />
						}
						if (t.type === "paragraph") {
							const paraToken = t as Tokens.Paragraph
							return <InlineTokens tokens={paraToken.tokens ?? []} theme={theme} />
						}
						return null
					}}
				</For>
			</text>
			{/* Nested lists */}
			<For each={nestedLists()}>
				{(list) => <ListToken token={list} theme={theme} depth={depth + 1} />}
			</For>
		</box>
	)
}

function BlockquoteToken(props: { token: Tokens.Blockquote; theme: MarkdownTheme; nextTokenType: string | undefined }): JSX.Element {
	const { token, theme, nextTokenType } = props

	return (
		<box flexDirection="column">
			<For each={token.tokens ?? []}>
				{(t) => (
					<text>
						<span style={{ fg: theme.quoteBorder }}>{"│ "}</span>
						<span style={{ fg: theme.quote, attributes: TextAttributes.ITALIC }}>
							{t.type === "paragraph" ? <InlineTokens tokens={(t as Tokens.Paragraph).tokens ?? []} theme={theme} /> : "text" in t ? String(t.text) : ""}
						</span>
					</text>
				)}
			</For>
			<Show when={nextTokenType !== "space"}>
				<box height={1} />
			</Show>
		</box>
	)
}

function HrToken(props: { theme: MarkdownTheme; nextTokenType: string | undefined; maxWidth: number | undefined }): JSX.Element {
	const width = () => Math.min(props.maxWidth ?? 80, 80)

	return (
		<box flexDirection="column">
			<text fg={props.theme.hr}>{"─".repeat(width())}</text>
			<Show when={props.nextTokenType !== "space"}>
				<box height={1} />
			</Show>
		</box>
	)
}

function TableToken(props: { token: Tokens.Table; theme: MarkdownTheme }): JSX.Element {
	const { token, theme } = props
	const numCols = token.header.length
	if (numCols === 0) return null

	// Calculate column widths based on content
	const columnWidths = createMemo(() => {
		const widths: number[] = []
		for (let i = 0; i < numCols; i++) {
			const headerText = extractText(token.header[i]?.tokens ?? [])
			widths[i] = visibleWidth(headerText)
		}
		for (const row of token.rows) {
			for (let i = 0; i < row.length; i++) {
				const cellText = extractText(row[i]?.tokens ?? [])
				widths[i] = Math.max(widths[i] || 0, visibleWidth(cellText))
			}
		}
		return widths
	})

	const getWidth = (index: number) => columnWidths()[index] ?? 0

	return (
		<box flexDirection="column">
			{/* Header */}
			<text fg={theme.text}>
				{"│ "}
				<For each={token.header}>
					{(cell, i) => (
						<>
							<span style={{ attributes: TextAttributes.BOLD }}>
								<InlineTokens tokens={cell?.tokens ?? []} theme={theme} />
							</span>
							{padTo(extractText(cell?.tokens ?? []), getWidth(i()))}
							{i() < numCols - 1 ? " │ " : " │"}
						</>
					)}
				</For>
			</text>
			{/* Separator */}
			<text fg={theme.text}>
				{"├─"}
				<For each={columnWidths()}>
					{(w, i) => (
						<>
							{"─".repeat(w)}
							{i() < numCols - 1 ? "─┼─" : "─┤"}
						</>
					)}
				</For>
			</text>
			{/* Rows */}
			<For each={token.rows}>
				{(row) => (
					<text fg={theme.text}>
						{"│ "}
						<For each={row}>
							{(cell, i) => (
								<>
									<InlineTokens tokens={cell?.tokens ?? []} theme={theme} />
									{padTo(extractText(cell?.tokens ?? []), getWidth(i()))}
									{i() < numCols - 1 ? " │ " : " │"}
								</>
							)}
						</For>
					</text>
				)}
			</For>
			<box height={1} />
		</box>
	)
}

// --- Inline token renderer ---

function InlineTokens(props: { tokens: Token[]; theme: MarkdownTheme }): JSX.Element {
	return (
		<For each={props.tokens}>
			{(token) => <InlineToken token={token} theme={props.theme} />}
		</For>
	)
}

function InlineToken(props: { token: Token; theme: MarkdownTheme }): JSX.Element {
	const { token, theme } = props

	switch (token.type) {
		case "text": {
			const t = token as Tokens.Text
			if (t.tokens && t.tokens.length > 0) {
				return <InlineTokens tokens={t.tokens} theme={theme} />
			}
			return <span style={{ fg: theme.text }}>{t.text}</span>
		}

		case "strong": {
			const t = token as Tokens.Strong
			return (
				<span style={{ fg: theme.text, attributes: TextAttributes.BOLD }}>
					<InlineTokens tokens={t.tokens ?? []} theme={theme} />
				</span>
			)
		}

		case "em": {
			const t = token as Tokens.Em
			return (
				<span style={{ fg: theme.text, attributes: TextAttributes.ITALIC }}>
					<InlineTokens tokens={t.tokens ?? []} theme={theme} />
				</span>
			)
		}

		case "codespan": {
			const t = token as Tokens.Codespan
			return <span style={{ fg: theme.code }}>{t.text}</span>
		}

		case "link": {
			const t = token as Tokens.Link
			const showUrl = t.text !== t.href
			return (
				<>
					<span style={{ fg: theme.link, attributes: TextAttributes.UNDERLINE }}>
						<InlineTokens tokens={t.tokens ?? []} theme={theme} />
					</span>
					<Show when={showUrl}>
						<span style={{ fg: theme.linkUrl }}>{` (${t.href})`}</span>
					</Show>
				</>
			)
		}

		case "image": {
			const t = token as Tokens.Image
			// Terminal can't display images, show as [img: alt] (url)
			return (
				<>
					<span style={{ fg: theme.link }}>[img: {t.text || "image"}]</span>
					<span style={{ fg: theme.linkUrl }}>{` (${t.href})`}</span>
				</>
			)
		}

		case "br":
			return "\n"

		case "del": {
			const t = token as Tokens.Del
			return (
				<span style={{ fg: theme.text, attributes: TextAttributes.STRIKETHROUGH }}>
					<InlineTokens tokens={t.tokens ?? []} theme={theme} />
				</span>
			)
		}

		default:
			if ("text" in token && typeof token.text === "string") {
				return <span style={{ fg: theme.text }}>{token.text}</span>
			}
			return null
	}
}

// --- Helpers ---

function extractText(tokens: Token[]): string {
	let result = ""
	for (const token of tokens) {
		if ("text" in token && typeof token.text === "string") {
			result += token.text
		}
		if ("tokens" in token && Array.isArray(token.tokens)) {
			result += extractText(token.tokens)
		}
	}
	return result
}

function padTo(text: string, width: number): string {
	const currentWidth = visibleWidth(text)
	const needed = Math.max(0, width - currentWidth)
	return " ".repeat(needed)
}

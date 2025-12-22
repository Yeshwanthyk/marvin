/**
 * OpenTUI-native rendering components for tool output.
 */

import { CodeBlock, Diff, TextAttributes, useTheme, parseColor, type MouseEvent, type Theme } from "@marvin-agents/open-tui"
import { Show, type JSX } from "solid-js"
import { getLanguageFromPath, replaceTabs } from "./syntax-highlighting.js"
import { getToolText, getEditDiffText } from "./utils.js"

// Re-export for backwards compatibility
export { getToolText, getEditDiffText }

// Design tokens
const toolSymbol = "◆"

const shortenPath = (p: string): string => {
	const home = process.env.HOME || process.env.USERPROFILE || ""
	if (home && p.startsWith(home)) return "~" + p.slice(home.length)
	return p
}

// Simple diff preview with manual line coloring (tree-sitter lacks diff grammar)
const diffAddedColor = parseColor("#98c379")
const diffRemovedColor = parseColor("#e06c75")
const diffHunkColor = parseColor("#61afef")

function DiffPreview(props: { text: string }): JSX.Element {
	const { theme } = useTheme()

	const coloredLines = () => props.text.split("\n").map((line, i) => {
		let fg = theme.text
		if (line.startsWith("+") && !line.startsWith("+++")) fg = diffAddedColor
		else if (line.startsWith("-") && !line.startsWith("---")) fg = diffRemovedColor
		else if (line.startsWith("@@")) fg = diffHunkColor
		return { line, fg, key: i }
	})

	return (
		<box flexDirection="column" backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
			{coloredLines().map(({ line, fg, key }) => (
				<text fg={fg}>{line}</text>
			))}
		</box>
	)
}



function truncateHeadTail(text: string, headCount: number, tailCount: number): { text: string; truncated: boolean; omitted: number } {
	const lines = replaceTabs(text).split("\n")
	if (lines.length <= headCount + tailCount) {
		return { text: lines.join("\n"), truncated: false, omitted: 0 }
	}

	const head = lines.slice(0, headCount)
	const tail = lines.slice(-tailCount)
	return {
		text: [...head, "", `… ${lines.length - (headCount + tailCount)} lines omitted …`, "", ...tail].join("\n"),
		truncated: true,
		omitted: lines.length - (headCount + tailCount),
	}
}

function truncateLines(text: string, maxLines: number): { text: string; truncated: boolean; omitted: number } {
	const lines = replaceTabs(text).split("\n")
	if (lines.length <= maxLines) return { text: lines.join("\n"), truncated: false, omitted: 0 }
	return {
		text: [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines …`].join("\n"),
		truncated: true,
		omitted: lines.length - maxLines,
	}
}

/** Extract +/- line counts from unified diff */
function getDiffStats(diffText: string): { added: number; removed: number } {
	let added = 0
	let removed = 0
	for (const line of diffText.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++
		else if (line.startsWith("-") && !line.startsWith("---")) removed++
	}
	return { added, removed }
}



function toolTitle(name: string, args: any): string {
	switch (name) {
		case "bash": {
			const cmd = String(args?.command || "…")
			return cmd.split("\n")[0] || "…"
		}
		case "read":
			return shortenPath(String(args?.path || args?.file_path || "…"))
		case "write":
			return shortenPath(String(args?.path || args?.file_path || "…"))
		case "edit":
			return shortenPath(String(args?.path || args?.file_path || "…"))
		default:
			return name
	}
}

export function Thinking(props: { summary: string }): JSX.Element {
	const { theme } = useTheme()
	return (
		<text selectable={false} fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
			thinking {props.summary}
		</text>
	)
}

export interface ToolBlockProps {
	name: string
	args: any
	output: string | null
	editDiff: string | null
	isError: boolean
	isComplete: boolean
	expanded?: boolean
	onToggleExpanded?: () => void
	diffWrapMode?: "word" | "none"
	// Custom tool metadata
	label?: string
	source?: "builtin" | "custom"
	sourcePath?: string
	result?: { content: any[]; details: any }
	renderCall?: (args: any, theme: Theme) => JSX.Element
	renderResult?: (result: any, opts: { expanded: boolean; isPartial: boolean }, theme: Theme) => JSX.Element
}

type ToolRenderMode = "inline" | "block"

interface ToolRenderContext {
	name: string
	args: any
	output: string | null
	editDiff: string | null
	isError: boolean
	isComplete: boolean
	expanded: boolean
	diffWrapMode: "word" | "none"
}

interface ToolRenderer {
	mode: (ctx: ToolRenderContext) => ToolRenderMode
	renderHeader?: (ctx: ToolRenderContext) => JSX.Element
	renderBody?: (ctx: ToolRenderContext) => JSX.Element
}

function defaultHeader(ctx: ToolRenderContext): JSX.Element {
	const title = toolTitle(ctx.name, ctx.args)
	const suffix = !ctx.isComplete ? "◌" : ctx.isError ? "error" : ""
	return <ToolHeader label={ctx.name} detail={title} suffix={suffix} />
}

// Dot leader fill for alignment
function dotFill(width: number): string {
	return width > 0 ? " " + "·".repeat(width) + " " : " "
}

// Tool header with symbol, label, detail, and right-aligned suffix
// Format: ◆ label detail ···················· suffix ▸
function ToolHeader(props: { label: string; detail?: string; suffix?: string; maxWidth?: number }): JSX.Element {
	const { theme } = useTheme()
	const maxW = props.maxWidth ?? 72
	
	const contentWidth = () => {
		const labelW = props.label.length + 2 // "◆ " + label
		const detailW = props.detail ? props.detail.length + 1 : 0
		const suffixW = props.suffix ? props.suffix.length + 2 : 0 // suffix + " ▸"
		return labelW + detailW + suffixW
	}
	
	const dots = () => dotFill(Math.max(0, maxW - contentWidth()))
	
	return (
		<text selectable={false}>
			<span style={{ fg: theme.accent }}>{toolSymbol}</span>
			{" "}
			<span style={{ fg: theme.accent }}>{props.label}</span>
			<Show when={props.detail}>
				<span style={{ fg: theme.text }}> {props.detail}</span>
			</Show>
			<span style={{ fg: theme.textMuted }}>{dots()}</span>
			<Show when={props.suffix}>
				<span style={{ fg: theme.textMuted }}>{props.suffix}</span>
			</Show>
		</text>
	)
}

const registry: Record<string, ToolRenderer> = {
	bash: {
		// Inline when collapsed (just command), block when expanded (show output)
		mode: (ctx) => (ctx.expanded ? "block" : "inline"),
		renderHeader: (ctx) => {
			const cmd = String(ctx.args?.command || "…").split("\n")[0] || "…"
			const lines = ctx.output ? ctx.output.split("\n").length : null
			let suffix = ""
			if (!ctx.isComplete) suffix = "◌"
			else if (ctx.isError) suffix = "error"
			else if (lines !== null) suffix = String(lines)
			return <ToolHeader label="bash" detail={cmd} suffix={suffix} />
		},
		renderBody: (ctx) => {
			const { theme } = useTheme()
			// Only show body when expanded
			if (!ctx.expanded) return null
			if (!ctx.output) return <text fg={theme.textMuted}>no output</text>
			return <CodeBlock content={replaceTabs(ctx.output)} filetype="text" showLineNumbers={false} wrapMode="none" />
		},
	},
	read: {
		mode: (ctx) => (ctx.expanded ? "block" : "inline"),
		renderHeader: (ctx) => {
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const lines = ctx.output ? replaceTabs(ctx.output).split("\n").length : null
			const suffix = lines !== null ? String(lines) : "◌"
			return <ToolHeader label="read" detail={path} suffix={suffix} />
		},
		renderBody: (ctx) => {
			const { theme } = useTheme()
			if (!ctx.output) return <text fg={theme.textMuted}>reading…</text>
			const rendered = ctx.expanded ? replaceTabs(ctx.output) : truncateLines(ctx.output, 20).text
			const filetype = getLanguageFromPath(String(ctx.args?.path || ctx.args?.file_path || ""))
			return <CodeBlock content={rendered} filetype={filetype} title="preview" />
		},
	},
	write: {
		mode: () => "block",
		renderHeader: (ctx) => {
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const content = String(ctx.args?.content || "")
			const lines = content ? content.split("\n").length : null
			const suffix = !ctx.isComplete ? "◌" : lines !== null ? String(lines) : ""
			return <ToolHeader label="write" detail={path} suffix={suffix} />
		},
		renderBody: (ctx) => {
			const { theme } = useTheme()
			const content = String(ctx.args?.content || "")
			if (!content && !ctx.isComplete) return <text fg={theme.textMuted}>writing…</text>
			if (!content) return <text fg={theme.textMuted}>no content</text>

			const filetype = getLanguageFromPath(String(ctx.args?.path || ctx.args?.file_path || ""))
			const rendered = ctx.expanded ? replaceTabs(content) : truncateLines(content, 40).text
			return <CodeBlock content={rendered} filetype={filetype} title="write" />
		},
	},
	edit: {
		mode: (ctx) => (ctx.expanded ? "block" : "inline"),
		renderHeader: (ctx) => {
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const diffStats = ctx.editDiff ? getDiffStats(ctx.editDiff) : null
			let suffix = ""
			if (!ctx.isComplete) suffix = "◌"
			else if (ctx.isError) suffix = "error"
			else if (diffStats) suffix = `+${diffStats.added}/-${diffStats.removed}`
			return <ToolHeader label="edit" detail={path} suffix={suffix} />
		},
		renderBody: (ctx) => {
			const { theme } = useTheme()
			// Only show body when expanded
			if (!ctx.expanded) return null
			if (ctx.editDiff) {
				const filetype = getLanguageFromPath(String(ctx.args?.path || ctx.args?.file_path || ""))
				const diffLines = ctx.editDiff.split("\n").length
				if (diffLines > 150) {
					const truncated = truncateHeadTail(ctx.editDiff, 60, 40)
					return <DiffPreview text={truncated.text} />
				}
				return <Diff diffText={ctx.editDiff} filetype={filetype} wrapMode={ctx.diffWrapMode} />
			}
			if (!ctx.output && !ctx.isComplete) return <text fg={theme.textMuted}>editing…</text>
			return <text fg={ctx.isError ? theme.error : theme.text}>{ctx.output ?? ""}</text>
		},
	},
}

export function ToolBlock(props: ToolBlockProps): JSX.Element {
	const { theme } = useTheme()

	// Use a getter for expanded to maintain reactivity
	const ctx: ToolRenderContext = {
		name: props.name,
		args: props.args,
		output: props.output,
		editDiff: props.editDiff,
		isError: props.isError,
		isComplete: props.isComplete,
		get expanded() { return props.expanded ?? false },
		get diffWrapMode() { return props.diffWrapMode ?? "word" },
	}

	const renderer = registry[props.name] ?? {
		mode: () => "block",
		renderBody: (innerCtx) => {
			const out = innerCtx.output ? innerCtx.output : JSON.stringify(innerCtx.args ?? {}, null, 2)
			const rendered = innerCtx.expanded ? replaceTabs(out) : truncateLines(out, 20).text
			return <CodeBlock content={rendered} filetype="text" title="output" showLineNumbers={false} />
		},
	}

	// Custom tool rendering: prefer tool-provided renderers, fallback to registry
	const tryCustomRenderCall = (): JSX.Element | null => {
		if (!props.renderCall) return null
		try {
			return props.renderCall(props.args, theme)
		} catch {
			return null // Fallback to default on error
		}
	}

	const tryCustomRenderResult = (): JSX.Element | null => {
		if (!props.renderResult || !props.result) return null
		try {
			return props.renderResult(props.result, { expanded: props.expanded ?? false, isPartial: !props.isComplete }, theme)
		} catch {
			return null // Fallback to default on error
		}
	}

	// Use functions to ensure reactivity
	const mode = () => renderer.mode(ctx)
	const header = () => tryCustomRenderCall() ?? renderer.renderHeader?.(ctx) ?? defaultHeader(ctx)
	const body = () => tryCustomRenderResult() ?? renderer.renderBody?.(ctx)

	return (
		<Show when={mode() === "inline"} fallback={
			// Block layout - entire block is clickable to toggle
			<box
				flexDirection="column"
				gap={0}
				onMouseUp={(e: MouseEvent) => {
					if (e.isSelecting) return
					props.onToggleExpanded?.()
				}}
			>
				<box flexDirection="row" gap={1}>
					{header()}
					<Show when={!props.expanded && props.isComplete}>
						<text selectable={false} fg={theme.textMuted}>▾</text>
					</Show>
					<Show when={props.expanded && props.isComplete}>
						<text selectable={false} fg={theme.textMuted}>▴</text>
					</Show>
				</box>
				<Show when={body()}>
					<box paddingLeft={0} paddingTop={1}>
						{body()}
					</box>
				</Show>
			</box>
		}>
			{/* Inline layout */}
			<box
				flexDirection="row"
				gap={1}
				onMouseUp={(e: MouseEvent) => {
					if (e.isSelecting) return
					props.onToggleExpanded?.()
				}}
			>
				{header()}
				<Show when={props.isComplete}>
					<text selectable={false} fg={theme.textMuted}>▸</text>
				</Show>
			</box>
		</Show>
	)
}

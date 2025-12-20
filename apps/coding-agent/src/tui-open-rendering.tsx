/**
 * OpenTUI-native rendering components for tool output.
 */

import { CodeBlock, Diff, TextAttributes, useTheme, type MouseEvent } from "@marvin-agents/open-tui"
import { Show, type JSX } from "solid-js"
import { getLanguageFromPath, replaceTabs } from "./syntax-highlighting.js"

// Design tokens
const badgeColor = "#A66E7A"  // dusty rose
const badgeTextColor = "#ffffff"
const toolSymbol = "◆"

// Get text content from tool result
export const getToolText = (result: unknown): string => {
	if (!result || typeof result !== "object") return String(result)
	const maybe = result as { content?: unknown }
	const content = Array.isArray(maybe.content) ? maybe.content : []
	const parts: string[] = []
	for (const block of content) {
		if (typeof block === "object" && block !== null && (block as any).type === "text") {
			parts.push((block as any).text)
		}
	}
	return parts.join("")
}

// Get diff text from tool result details (edit tool)
export const getEditDiffText = (result: unknown): string | null => {
	if (!result || typeof result !== "object") return null
	const maybe = result as { details?: { diff?: string } }
	return maybe.details?.diff || null
}

const shortenPath = (p: string): string => {
	const home = process.env.HOME || process.env.USERPROFILE || ""
	if (home && p.startsWith(home)) return "~" + p.slice(home.length)
	return p
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
	const { theme } = useTheme()
	const title = toolTitle(ctx.name, ctx.args)
	const suffix = (
		<>
			<Show when={!ctx.isComplete}>
				<span style={{ fg: theme.textMuted }}> …</span>
			</Show>
			<Show when={ctx.isError}>
				<span style={{ fg: theme.error }}> error</span>
			</Show>
		</>
	)
	return <ToolHeader label={ctx.name.toUpperCase()} detail={title} suffix={suffix} />
}

// Badge component - dusty rose background, white text, uppercase
function Badge(props: { label: string }): JSX.Element {
	return (
		<span style={{ bg: badgeColor, fg: badgeTextColor, attributes: TextAttributes.BOLD }}> {props.label} </span>
	)
}

// Tool header with symbol and badge
function ToolHeader(props: { label: string; detail?: string; suffix?: JSX.Element }): JSX.Element {
	const { theme } = useTheme()
	return (
		<text selectable={false}>
			<span style={{ fg: badgeColor }}>{toolSymbol}</span>
			{" "}
			<Badge label={props.label} />
			<Show when={props.detail}>
				<span style={{ fg: theme.text }}> {props.detail}</span>
			</Show>
			{props.suffix}
		</text>
	)
}

const registry: Record<string, ToolRenderer> = {
	bash: {
		// Inline when collapsed (just command), block when expanded (show output)
		mode: (ctx) => (ctx.expanded ? "block" : "inline"),
		renderHeader: (ctx) => {
			const { theme } = useTheme()
			const cmd = String(ctx.args?.command || "…").split("\n")[0] || "…"
			const lines = ctx.output ? ctx.output.split("\n").length : null
			const suffix = (
				<>
					<Show when={!ctx.isComplete}>
						<span style={{ fg: theme.textMuted }}> …</span>
					</Show>
					<Show when={ctx.isComplete && lines !== null}>
						<span style={{ fg: theme.textMuted }}> ({lines})</span>
					</Show>
					<Show when={ctx.isError}>
						<span style={{ fg: theme.error }}> error</span>
					</Show>
				</>
			)
			return <ToolHeader label="BASH" detail={cmd} suffix={suffix} />
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
			const { theme } = useTheme()
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const lines = ctx.output ? replaceTabs(ctx.output).split("\n").length : null
			const suffix = (
				<Show when={lines !== null}>
					<span style={{ fg: theme.textMuted }}> ({lines})</span>
				</Show>
			)
			return <ToolHeader label="READ" detail={path} suffix={suffix} />
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
			const { theme } = useTheme()
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const suffix = (
				<Show when={!ctx.isComplete}>
					<span style={{ fg: theme.textMuted }}> …</span>
				</Show>
			)
			return <ToolHeader label="WRITE" detail={path} suffix={suffix} />
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
		mode: () => "block",
		renderHeader: (ctx) => {
			const { theme } = useTheme()
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const suffix = (
				<>
					<Show when={!ctx.isComplete}>
						<span style={{ fg: theme.textMuted }}> …</span>
					</Show>
					<Show when={ctx.isError}>
						<span style={{ fg: theme.error }}> error</span>
					</Show>
				</>
			)
			return <ToolHeader label="EDIT" detail={path} suffix={suffix} />
		},
		renderBody: (ctx) => {
			const { theme } = useTheme()
			if (ctx.editDiff) {
				const filetype = getLanguageFromPath(String(ctx.args?.path || ctx.args?.file_path || ""))
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

	// Use functions to ensure reactivity
	const mode = () => renderer.mode(ctx)
	const header = () => renderer.renderHeader?.(ctx) ?? defaultHeader(ctx)
	const body = () => renderer.renderBody?.(ctx)

	return (
		<Show when={mode() === "inline"} fallback={
			// Block layout
			<box flexDirection="column" gap={0}>
				<box
					flexDirection="row"
					gap={1}
					onMouseUp={(e: MouseEvent) => {
						if (e.isSelecting) return
						props.onToggleExpanded?.()
					}}
				>
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

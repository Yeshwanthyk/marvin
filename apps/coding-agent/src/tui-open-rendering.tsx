/**
 * OpenTUI-native rendering components for tool output.
 */

import { CodeBlock, Diff, TextAttributes, useTheme, type MouseEvent } from "@marvin-agents/open-tui"
import { Show, type JSX } from "solid-js"
import { getLanguageFromPath, replaceTabs } from "./syntax-highlighting.js"

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

const bashBadge = (cmd: string): string => {
	const first = cmd.trim().split(/\s+/)[0] || ""
	return (
		{
			git: "GIT",
			ls: "LIST",
			fd: "LIST",
			cat: "READ",
			head: "READ",
			tail: "READ",
			rg: "SEARCH",
			grep: "SEARCH",
			npm: "NPM",
			cargo: "CARGO",
			bun: "BUN",
		}[first] || "RUN"
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

function toolColor(theme: ReturnType<typeof useTheme>["theme"], name: string) {
	switch (name) {
		case "bash":
			return theme.success
		case "read":
			return theme.info
		case "write":
			return theme.warning
		case "edit":
			return theme.secondary
		default:
			return theme.textMuted
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
		<text>
			<span style={{ fg: theme.textMuted, attributes: TextAttributes.ITALIC }}>thinking </span>
			<span style={{ fg: theme.textMuted, attributes: TextAttributes.ITALIC }}>{props.summary}</span>
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
}

interface ToolRenderer {
	mode: (ctx: ToolRenderContext) => ToolRenderMode
	renderHeader?: (ctx: ToolRenderContext) => JSX.Element
	renderBody?: (ctx: ToolRenderContext) => JSX.Element
}

function defaultHeader(ctx: ToolRenderContext): JSX.Element {
	const { theme } = useTheme()
	const color = toolColor(theme, ctx.name)
	const title = toolTitle(ctx.name, ctx.args)

	return (
		<text>
			<span style={{ fg: color, attributes: TextAttributes.BOLD }}>{ctx.name.toUpperCase()}</span>
			<span style={{ fg: theme.text }}>{" "}{title}</span>
			<Show when={!ctx.isComplete}>
				<span style={{ fg: theme.textMuted }}> …</span>
			</Show>
			<Show when={ctx.isError}>
				<span style={{ fg: theme.error, attributes: TextAttributes.BOLD }}> ERROR</span>
			</Show>
		</text>
	)
}

const registry: Record<string, ToolRenderer> = {
	bash: {
		mode: () => "block",
		renderHeader: (ctx) => {
			const { theme } = useTheme()
			const cmd = String(ctx.args?.command || "…").split("\n")[0] || "…"
			const badge = bashBadge(cmd)
			return (
				<text>
					<span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>{badge}</span>
					<span style={{ fg: theme.text }}>{" "}{cmd}</span>
					<Show when={!ctx.isComplete}>
						<span style={{ fg: theme.textMuted }}> …</span>
					</Show>
					<Show when={ctx.isError}>
						<span style={{ fg: theme.error, attributes: TextAttributes.BOLD }}> ERROR</span>
					</Show>
				</text>
			)
		},
		renderBody: (ctx) => {
			const { theme } = useTheme()
			if (!ctx.output && !ctx.isComplete) return <text fg={theme.textMuted}>running…</text>
			if (!ctx.output) return <text fg={theme.textMuted}>no output</text>

			const rendered = ctx.expanded ? replaceTabs(ctx.output) : truncateHeadTail(ctx.output, 2, 6).text
			return <CodeBlock content={rendered} filetype="text" showLineNumbers={false} wrapMode="none" />
		},
	},
	read: {
		mode: (ctx) => (ctx.expanded ? "block" : "inline"),
		renderHeader: (ctx) => {
			const { theme } = useTheme()
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const lines = ctx.output ? replaceTabs(ctx.output).split("\n").length : null
			return (
				<text>
					<span style={{ fg: theme.info, attributes: TextAttributes.BOLD }}>READ</span>
					<span style={{ fg: theme.text }}>{" "}{path}</span>
					<Show when={lines !== null}>
						<span style={{ fg: theme.textMuted }}> ({lines} lines)</span>
					</Show>
				</text>
			)
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
			return (
				<text>
					<span style={{ fg: theme.warning, attributes: TextAttributes.BOLD }}>WRITE</span>
					<span style={{ fg: theme.text }}>{" "}{path}</span>
					<Show when={!ctx.isComplete}>
						<span style={{ fg: theme.textMuted }}> …</span>
					</Show>
				</text>
			)
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
			return (
				<text>
					<span style={{ fg: theme.secondary, attributes: TextAttributes.BOLD }}>EDIT</span>
					<span style={{ fg: theme.text }}>{" "}{path}</span>
					<Show when={!ctx.isComplete}>
						<span style={{ fg: theme.textMuted }}> …</span>
					</Show>
					<Show when={ctx.isError}>
						<span style={{ fg: theme.error, attributes: TextAttributes.BOLD }}> ERROR</span>
					</Show>
				</text>
			)
		},
		renderBody: (ctx) => {
			const { theme } = useTheme()
			if (ctx.editDiff) {
				const filetype = getLanguageFromPath(String(ctx.args?.path || ctx.args?.file_path || ""))
				return <Diff diffText={ctx.editDiff} filetype={filetype} wrapMode="word" />
			}
			if (!ctx.output && !ctx.isComplete) return <text fg={theme.textMuted}>editing…</text>
			return <text fg={ctx.isError ? theme.error : theme.text}>{ctx.output ?? ""}</text>
		},
	},
}

export function ToolBlock(props: ToolBlockProps): JSX.Element {
	const { theme } = useTheme()

	const ctx: ToolRenderContext = {
		name: props.name,
		args: props.args,
		output: props.output,
		editDiff: props.editDiff,
		isError: props.isError,
		isComplete: props.isComplete,
		expanded: props.expanded ?? false,
	}

	const renderer = registry[props.name] ?? {
		mode: () => "block",
		renderBody: (ctx) => {
			const out = ctx.output ? ctx.output : JSON.stringify(ctx.args ?? {}, null, 2)
			const rendered = ctx.expanded ? replaceTabs(out) : truncateLines(out, 20).text
			return <CodeBlock content={rendered} filetype="text" title="output" showLineNumbers={false} />
		},
	}

	const mode = renderer.mode(ctx)
	const header = renderer.renderHeader?.(ctx) ?? defaultHeader(ctx)
	const body = renderer.renderBody?.(ctx)

	if (mode === "inline") {
		return (
			<box
				flexDirection="column"
				onMouseUp={(event: MouseEvent) => {
					if (event.isSelecting) return
					props.onToggleExpanded?.()
				}}
			>
				{header}
			</box>
		)
	}

	// Minimal block layout - no heavy borders
	return (
		<box
			flexDirection="column"
			gap={0}
			onMouseUp={(event: MouseEvent) => {
				if (event.isSelecting) return
				props.onToggleExpanded?.()
			}}
		>
			{header}
			<Show when={body}>
				<box paddingLeft={0} paddingTop={1}>
					{body}
				</box>
			</Show>
			<Show when={!props.expanded && props.isComplete}>
				<text fg={theme.textMuted}>(click to expand)</text>
			</Show>
		</box>
	)
}

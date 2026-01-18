/**
 * OpenTUI-native rendering components for tool output.
 */

import { CodeBlock, Diff, Image, TextAttributes, useTheme, parseColor, type MouseEvent, type Theme } from "@marvin-agents/open-tui"
import { Show, type JSX } from "solid-js"
import { getLanguageFromPath, replaceTabs } from "./syntax-highlighting.js"
import { getToolText, getEditDiffText } from "@domain/messaging/content.js"
import { getAgentDelegationArgs, getAgentDelegationUi, type AgentDelegationArgs, type AgentDelegationUi, type DelegationStatus } from "./tool-ui-contracts.js"

// Re-export for backwards compatibility
export { getToolText, getEditDiffText }

// Design tokens - minimal symbols
const symbols = {
	running: "·",
	complete: "▸",
	expanded: "▾",
	error: "✕",
}

export const shortenPath = (p: string, maxLen = 40): string => {
	const home = process.env.HOME || process.env.USERPROFILE || ""
	let shortened = p

	// Replace home with ~
	if (home && shortened.startsWith(home)) {
		shortened = "~" + shortened.slice(home.length)
	}

	// If still long, show .../{parent}/{file}
	const parts = shortened.split("/")
	if (parts.length > 3) {
		shortened = "…/" + parts.slice(-2).join("/")
	}

	// Final truncation if still too long
	if (shortened.length > maxLen) {
		shortened = "…" + shortened.slice(-(maxLen - 1))
	}

	return shortened
}

// Simple diff preview with manual line coloring (tree-sitter lacks diff grammar)
const diffAddedColor = parseColor("#98c379")
const diffRemovedColor = parseColor("#e06c75")
const diffHunkColor = parseColor("#61afef")

function DiffPreview(props: { text: string }): JSX.Element {
	const { theme } = useTheme()

		const coloredLines = () => props.text.split("\n").map((line) => {
			let fg = theme.text
			if (line.startsWith("+") && !line.startsWith("+++")) fg = diffAddedColor
			else if (line.startsWith("-") && !line.startsWith("---")) fg = diffRemovedColor
			else if (line.startsWith("@@")) fg = diffHunkColor
			return { line, fg }
		})

	return (
			<box flexDirection="column" backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
				{coloredLines().map(({ line, fg }) => (
					<text fg={fg}>{line}</text>
				))}
			</box>
	)
}

const delegationOkColor = diffAddedColor

function firstLine(s: string): string {
	return s.split("\n")[0] || ""
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s
	return s.slice(0, Math.max(0, max - 1)) + "…"
}

function delegationSymbol(status: DelegationStatus | "unknown"): string {
	switch (status) {
		case "running":
			return "◌"
		case "pending":
			return "○"
		case "ok":
			return "✓"
		case "error":
			return "✕"
		default:
			return "·"
	}
}

function delegationColor(theme: Theme, status: DelegationStatus | "unknown"): ReturnType<typeof parseColor> {
	if (status === "error") return theme.error
	if (status === "ok") return delegationOkColor
	if (status === "running") return theme.accent
	return theme.textMuted
}

function formatDelegationSuffix(ui: AgentDelegationUi): string {
	const ok = ui.items.filter((i) => i.status === "ok").length
	const err = ui.items.filter((i) => i.status === "error").length
	const total = ui.items.length
	if (err > 0) return `${ok} ok · ${err} err / ${total}`
	return `${ok} ok / ${total}`
}

function AgentDelegationView(props: {
	args: AgentDelegationArgs | null
	ui: AgentDelegationUi | null
	expanded: boolean
}): JSX.Element {
	const { theme } = useTheme()
	const maxItems = () => props.expanded ? 50 : 8

	const rows = () => {
		if (props.ui) {
			return props.ui.items.slice(0, maxItems()).map((item) => ({
				id: item.id,
				agent: item.agent,
				task: item.task,
				status: item.status as DelegationStatus | "unknown",
				preview: item.preview,
				active: props.ui?.activeId === item.id,
			}))
		}
		if (props.args?.chain?.length) {
			return props.args.chain.slice(0, maxItems()).map((item, idx) => ({
				id: String(idx + 1),
				agent: item.agent,
				task: item.task,
				status: "unknown" as const,
				preview: undefined,
				active: false,
			}))
		}
		if (props.args?.tasks?.length) {
			return props.args.tasks.slice(0, maxItems()).map((item, idx) => ({
				id: String(idx + 1),
				agent: item.agent,
				task: item.task,
				status: "unknown" as const,
				preview: undefined,
				active: false,
			}))
		}
		if (props.args?.agent && props.args?.task) {
			return [{
				id: "1",
				agent: props.args.agent,
				task: props.args.task,
				status: "unknown" as const,
				preview: undefined,
				active: false,
			}]
		}
		return []
	}

	return (
		<box flexDirection="column" backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
			{rows().map((row) => (
				<box flexDirection="column" gap={0}>
					<box flexDirection="row" gap={1}>
						<text selectable={false} fg={delegationColor(theme, row.status)}>{delegationSymbol(row.status)}</text>
						<text fg={row.active ? theme.accent : theme.text}>{truncate(row.agent, 24)}</text>
						<text fg={theme.textMuted}>{truncate(firstLine(row.task), 80)}</text>
					</box>
					<Show when={props.expanded && row.preview}>
						<box paddingLeft={2}>
							<text fg={theme.textMuted}>{truncate(firstLine(String(row.preview)), 120)}</text>
						</box>
					</Show>
				</box>
			))}
			<Show when={props.ui && props.ui.items.length > maxItems()}>
				<text fg={theme.textMuted}>… {props.ui!.items.length - maxItems()} more …</text>
			</Show>
			<Show when={!props.ui && ((props.args?.chain?.length ?? 0) > maxItems() || (props.args?.tasks?.length ?? 0) > maxItems())}>
				<text fg={theme.textMuted}>… more …</text>
			</Show>
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

function getDiffStartLine(diffText: string): number | undefined {
	const match = diffText.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m)
	if (!match) return undefined
	const line = Number.parseInt(match[1], 10)
	if (!Number.isFinite(line) || line <= 0) return undefined
	return line
}

function toolTitle(name: string, args: any): string {
	switch (name) {
		case "bash": {
			// Prefer description if available
			if (args?.description) return truncate(String(args.description), 50)
			const cmd = String(args?.command || "…")
			return truncate(cmd.split("\n")[0] || "…", 40)
		}
		case "read":
			return shortenPath(String(args?.path || args?.file_path || "…"), 35)
		case "write":
			return shortenPath(String(args?.path || args?.file_path || "…"), 35)
		case "edit":
			return shortenPath(String(args?.path || args?.file_path || "…"), 35)
		// ask_user_question removed - use interview custom tool
		default: {
			const delegation = getAgentDelegationArgs(args)
			if (delegation?.chain?.length) return `chain ${delegation.chain.length}`
			if (delegation?.tasks?.length) return `${delegation.tasks.length} tasks`
			if (delegation?.agent) return truncate(delegation.agent, 30)
			return ""
		}
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
	// Edit file callback - opens file in editor for user review
	onEditFile?: (path: string, line?: number) => void
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
	result: ToolBlockProps["result"] | null
	isError: boolean
	isComplete: boolean
	expanded: boolean
	diffWrapMode: "word" | "none"
	onEditFile?: (path: string, line?: number) => void
}

interface ToolRenderer {
	mode: (ctx: ToolRenderContext) => ToolRenderMode
	renderHeader?: (ctx: ToolRenderContext) => JSX.Element
	renderBody?: (ctx: ToolRenderContext) => JSX.Element
}

function defaultHeader(ctx: ToolRenderContext): JSX.Element {
	const title = toolTitle(ctx.name, ctx.args)
	const delegationUi = getAgentDelegationUi(ctx.result?.details)
	const suffix = delegationUi ? formatDelegationSuffix(delegationUi) : undefined
	return <ToolHeader label={ctx.name} detail={title} suffix={suffix} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
}

// Tool header: compact "▸ label detail" format
interface ToolHeaderProps {
	label: string
	detail?: string
	suffix?: string
	isComplete: boolean
	isError: boolean
	expanded: boolean
}

function ToolHeader(props: ToolHeaderProps): JSX.Element {
	const { theme } = useTheme()

	const symbol = () => {
		if (!props.isComplete) return symbols.running
		if (props.isError) return symbols.error
		if (props.expanded) return symbols.expanded
		return symbols.complete
	}

	const symbolColor = () => {
		if (props.isError) return theme.error
		return theme.textMuted
	}

	// Tool name gets subtle accent, rest muted
	return (
		<text selectable={false}>
			<span style={{ fg: symbolColor() }}>{symbol()}</span>
			<span style={{ fg: theme.accent }}> {props.label}</span>
			<Show when={props.detail}>
				<span style={{ fg: theme.textMuted }}> {props.detail}</span>
			</Show>
			<Show when={props.suffix}>
				<span style={{ fg: theme.textMuted }}> · {props.suffix}</span>
			</Show>
		</text>
	)
}

const registry: Record<string, ToolRenderer> = {
	bash: {
		// Inline when collapsed (just command), block when expanded (show output)
		mode: (ctx) => (ctx.expanded ? "block" : "inline"),
		renderHeader: (ctx) => {
			// Prefer description if available, otherwise truncate command
			let detail: string
			if (ctx.args?.description) {
				detail = truncate(String(ctx.args.description), 60)
			} else {
				const cmd = String(ctx.args?.command || "…").split("\n")[0] || "…"
				detail = truncate(cmd, 50)
			}
			return <ToolHeader label="bash" detail={detail} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
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
			return <ToolHeader label="read" detail={path} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
		},
		renderBody: (ctx) => {
			const { theme } = useTheme()
			const imageBlocks = (ctx.result?.content ?? []).filter(
				(block) =>
					typeof block === "object" &&
					block !== null &&
					(block as { type?: string }).type === "image" &&
					typeof (block as { data?: string }).data === "string" &&
					typeof (block as { mimeType?: string }).mimeType === "string",
			) as Array<{ data: string; mimeType: string }>

			if (!ctx.output && imageBlocks.length === 0) return <text fg={theme.textMuted}>reading…</text>
			const rendered = ctx.output ? (ctx.expanded ? replaceTabs(ctx.output) : truncateLines(ctx.output, 20).text) : ""
			const filetype = getLanguageFromPath(String(ctx.args?.path || ctx.args?.file_path || ""))
			const preview = rendered ? <CodeBlock content={rendered} filetype={filetype} title="preview" /> : null
			if (imageBlocks.length === 0) return preview ?? <text fg={theme.textMuted}>no preview</text>

			return (
				<box flexDirection="column" gap={1}>
					{preview}
					{imageBlocks.map((img) => (
						<Image data={img.data} mimeType={img.mimeType} maxWidth={60} />
					))}
				</box>
			)
		},
	},

	write: {
		mode: () => "block",
		renderHeader: (ctx) => {
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			return <ToolHeader label="write" detail={path} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
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
			const { theme } = useTheme()
			const path = shortenPath(String(ctx.args?.path || ctx.args?.file_path || "…"))
			const fullPath = String(ctx.args?.path || ctx.args?.file_path || "")
			const diffStats = ctx.editDiff ? getDiffStats(ctx.editDiff) : null
			const startLine = ctx.editDiff ? getDiffStartLine(ctx.editDiff) : undefined
			const suffix = ctx.isComplete && !ctx.isError && diffStats ? `+${diffStats.added}/-${diffStats.removed}` : undefined
			const showEditButton = ctx.isComplete && !ctx.isError && ctx.onEditFile && fullPath
			return (
				<box flexDirection="row">
					<ToolHeader label="edit" detail={path} suffix={suffix} isComplete={ctx.isComplete} isError={ctx.isError} expanded={ctx.expanded} />
					{showEditButton && (
						<text
							fg={theme.textMuted}
							onMouseUp={(e: { stopPropagation?: () => void }) => {
								e.stopPropagation?.()
								ctx.onEditFile?.(fullPath, startLine)
							}}
						>
							{" [e]"}
						</text>
					)}
				</box>
			)
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
		result: props.result ?? null,
		isError: props.isError,
		isComplete: props.isComplete,
		get expanded() { return props.expanded ?? false },
		get diffWrapMode() { return props.diffWrapMode ?? "word" },
		onEditFile: props.onEditFile,
	}

	const renderer = registry[props.name] ?? {
		mode: () => "block",
		renderBody: (innerCtx) => {
			const delegationUi = getAgentDelegationUi(innerCtx.result?.details)
			const delegationArgs = getAgentDelegationArgs(innerCtx.args)

			if (delegationUi || delegationArgs) {
				return <AgentDelegationView args={delegationArgs} ui={delegationUi} expanded={innerCtx.expanded} />
			}

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
				{header()}
				<Show when={body()}>
					<box paddingLeft={2} paddingTop={1}>
						{body()}
					</box>
				</Show>
			</box>
		}>
			{/* Inline layout - clickable to expand */}
			<box
				flexDirection="row"
				gap={0}
				onMouseUp={(e: MouseEvent) => {
					if (e.isSelecting) return
					props.onToggleExpanded?.()
				}}
			>
				{header()}
			</box>
		</Show>
	)
}

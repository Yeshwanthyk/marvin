/**
 * OpenTUI-native rendering components for tool output
 * Replaces chalk-based message-rendering.ts for use with OpenTUI
 */

import { TextAttributes } from "@marvin-agents/open-tui"
import { Show, For } from "solid-js"
import type { JSX } from "solid-js"
import * as Diff from "diff"
import { colors as themeColors } from "./tui/themes.js"
import { getLanguageFromPath, replaceTabs } from "./syntax-highlighting.js"

// Tool-specific colors
const toolColors: Record<string, string> = {
	bash: "#98c379",
	read: "#61afef",
	write: "#e5c07b",
	edit: "#c678dd",
}

const colors = {
	dimmed: themeColors.dimmed,
	text: themeColors.text,
	accent: themeColors.accent,
	removed: "#bf616a",
	added: "#a3be8c",
	output: "#c5c5c0",
}

// Shorten path with ~ for home directory
const shortenPath = (p: string): string => {
	const home = process.env.HOME || process.env.USERPROFILE || ""
	if (home && p.startsWith(home)) return "~" + p.slice(home.length)
	return p
}

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

const bashBadge = (cmd: string): string => {
	const first = cmd.trim().split(/\s+/)[0] || ""
	return (
		{ git: "GIT", ls: "LIST", fd: "LIST", cat: "READ", head: "READ", tail: "READ", rg: "SEARCH", grep: "SEARCH", npm: "NPM", cargo: "CARGO", bun: "BUN" }[first] || "RUN"
	)
}

// ----- Tool Header Components -----

interface ToolHeaderProps {
	name: string
	args: any
	isError?: boolean
}

export function ToolHeader(props: ToolHeaderProps): JSX.Element {
	const toolColor = () => toolColors[props.name] || themeColors.code

	return (
		<box flexDirection="row">
			<Show when={props.name === "bash"}>
				<BashHeader args={props.args} color={toolColor()} />
			</Show>
			<Show when={props.name === "read"}>
				<ReadHeader args={props.args} color={toolColor()} />
			</Show>
			<Show when={props.name === "write"}>
				<WriteHeader args={props.args} color={toolColor()} />
			</Show>
			<Show when={props.name === "edit"}>
				<EditHeader args={props.args} color={toolColor()} />
			</Show>
			<Show when={!["bash", "read", "write", "edit"].includes(props.name)}>
				<text fg={toolColor()} attributes={TextAttributes.BOLD}>
					{props.name}
				</text>
			</Show>
		</box>
	)
}

function BashHeader(props: { args: any; color: string }): JSX.Element {
	const cmd = () => props.args?.command || "..."
	const badge = () => bashBadge(cmd())
	const firstLine = () => {
		const line = cmd().split("\n")[0]
		return line.length > 80 ? line.slice(0, 77) + "..." : line
	}

	return (
		<>
			<text fg={props.color} attributes={TextAttributes.BOLD}>
				{badge()}
			</text>
			<text> </text>
			<text fg={colors.dimmed}>{firstLine()}</text>
		</>
	)
}

function ReadHeader(props: { args: any; color: string }): JSX.Element {
	const path = () => shortenPath(props.args?.path || props.args?.file_path || "")
	const offset = () => props.args?.offset
	const limit = () => props.args?.limit

	const range = () => {
		if (!offset() && !limit()) return ""
		const start = offset() || 1
		const end = limit() ? start + limit() - 1 : ""
		return `:${start}${end ? `-${end}` : ""}`
	}

	return (
		<>
			<text fg={props.color} attributes={TextAttributes.BOLD}>
				read{" "}
			</text>
			<text fg={colors.text}>{path() || "..."}</text>
			<Show when={range()}>
				<text fg={colors.dimmed}>{range()}</text>
			</Show>
		</>
	)
}

function WriteHeader(props: { args: any; color: string }): JSX.Element {
	const path = () => shortenPath(props.args?.path || props.args?.file_path || "")
	const content = () => props.args?.content || ""
	const lineCount = () => content().split("\n").length

	return (
		<>
			<text fg={props.color} attributes={TextAttributes.BOLD}>
				write{" "}
			</text>
			<text fg={colors.text}>{path() || "..."}</text>
			<Show when={lineCount() > 1}>
				<text fg={colors.dimmed}> ({lineCount()} lines)</text>
			</Show>
		</>
	)
}

function EditHeader(props: { args: any; color: string }): JSX.Element {
	const path = () => shortenPath(props.args?.path || props.args?.file_path || "")

	return (
		<>
			<text fg={props.color} attributes={TextAttributes.BOLD}>
				edit{" "}
			</text>
			<text fg={colors.text}>{path() || "..."}</text>
		</>
	)
}

// ----- Tool Body Components -----

interface ToolBodyProps {
	name: string
	args: any
	output: string | null
	isPartial: boolean
}

export function ToolBody(props: ToolBodyProps): JSX.Element {
	return (
		<>
			<Show when={props.name === "bash"}>
				<BashBody output={props.output} isPartial={props.isPartial} />
			</Show>
			<Show when={props.name === "read"}>
				<ReadBody output={props.output} isPartial={props.isPartial} />
			</Show>
			<Show when={props.name === "write"}>
				<WriteBody args={props.args} isPartial={props.isPartial} />
			</Show>
			<Show when={!["bash", "read", "write", "edit"].includes(props.name)}>
				<GenericBody args={props.args} output={props.output} isPartial={props.isPartial} />
			</Show>
		</>
	)
}

function BashBody(props: { output: string | null; isPartial: boolean }): JSX.Element {
	const lines = () => (props.output || "").trim().split("\n").filter(Boolean)
	const total = () => lines().length

	const headCount = 2
	const tailCount = 3
	const maxShow = headCount + tailCount

	const shouldTruncate = () => total() > maxShow
	const head = () => lines().slice(0, headCount)
	const tail = () => lines().slice(-tailCount)
	const skipped = () => total() - maxShow

	return (
		<box flexDirection="column">
			<Show when={!props.output && props.isPartial}>
				<text fg={colors.dimmed}>...</text>
			</Show>
			<Show when={props.output && !shouldTruncate()}>
				<For each={lines()}>{(line) => <text fg={colors.output}>{line}</text>}</For>
			</Show>
			<Show when={props.output && shouldTruncate()}>
				<For each={head()}>{(line) => <text fg={colors.output}>{line}</text>}</For>
				<text fg={colors.dimmed}>  ... {skipped()} lines, Ctrl+O to expand ...</text>
				<For each={tail()}>{(line) => <text fg={colors.output}>{line}</text>}</For>
			</Show>
		</box>
	)
}

function ReadBody(props: { output: string | null; isPartial: boolean }): JSX.Element {
	const lineCount = () => (props.output || "").split("\n").length

	return (
		<>
			<Show when={props.isPartial && !props.output}>
				<text fg={colors.dimmed}>reading...</text>
			</Show>
			<Show when={props.output}>
				<text fg={colors.dimmed}>{lineCount()} lines</text>
			</Show>
		</>
	)
}

function WriteBody(props: { args: any; isPartial: boolean }): JSX.Element {
	const content = () => props.args?.content || ""
	const lines = () => replaceTabs(content()).split("\n")
	const maxLines = 8

	const shouldTruncate = () => lines().length > maxLines
	const shownLines = () => lines().slice(0, maxLines)
	const remaining = () => lines().length - maxLines

	return (
		<box flexDirection="column">
			<Show when={!content() && props.isPartial}>
				<text fg={colors.dimmed}>writing...</text>
			</Show>
			<Show when={content()}>
				<Show when={props.isPartial}>
					<text fg={colors.dimmed}>Creating file:</text>
					<text />
				</Show>
				<For each={shouldTruncate() ? shownLines() : lines()}>
					{(line) => <text fg={colors.output}>{line}</text>}
				</For>
				<Show when={shouldTruncate()}>
					<text fg={colors.dimmed}>... {remaining()} more lines, Ctrl+O to expand</text>
				</Show>
			</Show>
		</box>
	)
}

function GenericBody(props: { args: any; output: string | null; isPartial: boolean }): JSX.Element {
	const hasArgs = () => props.args && Object.keys(props.args).length > 0

	return (
		<box flexDirection="column">
			<Show when={hasArgs()}>
				<text fg={colors.dimmed}>{JSON.stringify(props.args, null, 2)}</text>
			</Show>
			<Show when={props.output}>
				<text fg={colors.output}>{props.output}</text>
			</Show>
			<Show when={!props.output && props.isPartial}>
				<text fg={colors.dimmed}>...</text>
			</Show>
		</box>
	)
}

// ----- Edit Diff Component -----

interface DiffLine {
	type: "+" | "-" | " "
	prefix: string
	content: string
	raw: string
}

function parseDiffLines(diffText: string): DiffLine[] {
	const lines = diffText.split("\n")
	const parsed: DiffLine[] = []

	for (const line of lines) {
		const normalized = replaceTabs(line)
		if (normalized.length === 0) {
			parsed.push({ type: " ", prefix: "", content: "", raw: normalized })
			continue
		}

		const firstChar = normalized[0]
		if (firstChar === "+" || firstChar === "-" || firstChar === " ") {
			const match = normalized.match(/^([+\- ])(\s*\d+\s)/)
			if (match) {
				const prefix = match[0]
				const content = normalized.slice(prefix.length)
				parsed.push({ type: firstChar as "+" | "-" | " ", prefix, content, raw: normalized })
			} else {
				parsed.push({ type: firstChar as "+" | "-" | " ", prefix: normalized, content: "", raw: normalized })
			}
		} else {
			parsed.push({ type: " ", prefix: "", content: normalized, raw: normalized })
		}
	}

	return parsed
}

interface EditDiffProps {
	diffText: string
}

export function EditDiff(props: EditDiffProps): JSX.Element {
	const parsed = () => parseDiffLines(props.diffText)

	// Process lines into renderable groups
	const processedLines = () => {
		const lines = parsed()
		const result: Array<{ type: "context" | "removed" | "added" | "wordDiff"; lines: DiffLine[]; compare?: DiffLine }> = []
		let i = 0

		while (i < lines.length) {
			const line = lines[i]

			if (line.type === "-") {
				// Collect consecutive removed lines
				const removedLines: DiffLine[] = []
				let j = i
				while (j < lines.length && lines[j].type === "-") {
					removedLines.push(lines[j])
					j++
				}

				// Collect consecutive added lines after
				const addedLines: DiffLine[] = []
				while (j < lines.length && lines[j].type === "+") {
					addedLines.push(lines[j])
					j++
				}

				// 1:1 pair gets word diff treatment
				if (removedLines.length === 1 && addedLines.length === 1) {
					result.push({ type: "wordDiff", lines: [removedLines[0]], compare: addedLines[0] })
					result.push({ type: "wordDiff", lines: [addedLines[0]], compare: removedLines[0] })
				} else {
					for (const r of removedLines) {
						result.push({ type: "removed", lines: [r] })
					}
					for (const a of addedLines) {
						result.push({ type: "added", lines: [a] })
					}
				}
				i = j
				continue
			}

			if (line.type === "+") {
				result.push({ type: "added", lines: [line] })
			} else {
				result.push({ type: "context", lines: [line] })
			}
			i++
		}

		return result
	}

	return (
		<box flexDirection="column">
			<For each={processedLines()}>
				{(group) => (
					<>
						<Show when={group.type === "context"}>
							<text fg={colors.dimmed}>{group.lines[0].raw}</text>
						</Show>
						<Show when={group.type === "removed"}>
							<text fg={colors.removed}>{group.lines[0].raw}</text>
						</Show>
						<Show when={group.type === "added"}>
							<text fg={colors.added}>{group.lines[0].raw}</text>
						</Show>
						<Show when={group.type === "wordDiff"}>
							<WordDiffLine line={group.lines[0]} compare={group.compare!} />
						</Show>
					</>
				)}
			</For>
		</box>
	)
}

function WordDiffLine(props: { line: DiffLine; compare: DiffLine }): JSX.Element {
	const isAdded = () => props.line.type === "+"
	const baseColor = () => (isAdded() ? colors.added : colors.removed)

	// Extract leading whitespace
	const leadingWs = () => {
		const match = props.line.content.match(/^(\s*)/)
		return match ? match[1] : ""
	}
	const textContent = () => props.line.content.slice(leadingWs().length)

	const compareLeadingWs = () => {
		const match = props.compare.content.match(/^(\s*)/)
		return match ? match[1] : ""
	}
	const compareTextContent = () => props.compare.content.slice(compareLeadingWs().length)

	// Get word diff parts
	const diffParts = () => Diff.diffWords(compareTextContent(), textContent())

	return (
		<text>
			<span style={{ fg: baseColor() }}>{props.line.prefix + leadingWs()}</span>
			<For each={diffParts()}>
				{(part) => (
					<>
						<Show when={isAdded() && part.added}>
							<span style={{ fg: baseColor(), attributes: TextAttributes.INVERSE }}>{part.value}</span>
						</Show>
						<Show when={isAdded() && !part.added && !part.removed}>
							<span style={{ fg: baseColor() }}>{part.value}</span>
						</Show>
						<Show when={!isAdded() && part.removed}>
							<span style={{ fg: baseColor(), attributes: TextAttributes.INVERSE }}>{part.value}</span>
						</Show>
						<Show when={!isAdded() && !part.removed && !part.added}>
							<span style={{ fg: baseColor() }}>{part.value}</span>
						</Show>
					</>
				)}
			</For>
		</text>
	)
}

// ----- Thinking Component -----

interface ThinkingProps {
	summary: string
}

export function Thinking(props: ThinkingProps): JSX.Element {
	return (
		<box flexDirection="row">
			<text fg="#8a7040">thinking </text>
			<text fg={colors.dimmed} attributes={TextAttributes.ITALIC}>
				{props.summary}
			</text>
		</box>
	)
}

// ----- Complete Tool Block Component -----

interface ToolBlockProps {
	name: string
	args: any
	output: string | null
	editDiff: string | null
	isError: boolean
	isComplete: boolean
}

export function ToolBlock(props: ToolBlockProps): JSX.Element {
	return (
		<box flexDirection="column" gap={1}>
			<ToolHeader name={props.name} args={props.args} isError={props.isError} />
			<Show when={props.name === "edit" && props.editDiff}>
				<EditDiff diffText={props.editDiff!} />
			</Show>
			<Show when={props.name !== "edit" || !props.editDiff}>
				<ToolBody name={props.name} args={props.args} output={props.output} isPartial={!props.isComplete} />
			</Show>
		</box>
	)
}

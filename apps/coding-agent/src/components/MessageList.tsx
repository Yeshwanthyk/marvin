/**
 * MessageList component for rendering conversation content
 */

import { For, Show, Switch, Match, createMemo, type JSX } from "solid-js"
import { CodeBlock, Markdown, TextAttributes, useTheme, type RGBA, type Theme } from "@yeshwanthyk/open-tui"
import type { UIMessage, ToolBlock, ContentItem } from "../types.js"
import type { ToolArgs } from "../types/tool-rendering.js"
import { profile } from "../profiler.js"
import { ToolBlock as ToolBlockComponent } from "../tui-open-rendering.js"

// ----- Tool Block Wrapper -----

export type TranscriptMarkKind = "prompt" | "assistant" | "thinking" | "tool" | "error" | "shell"

export interface TranscriptMark {
	id: string
	kind: TranscriptMarkKind
	label: string
	detail?: string
}

export type TranscriptContentItem = ContentItem & { mark: TranscriptMark }

const sanitizeMarkId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "item"

export const transcriptMarkId = (kind: TranscriptMarkKind, rawId: string): string =>
	`transcript-${kind}-${sanitizeMarkId(rawId)}`

const makeMark = (kind: TranscriptMarkKind, rawId: string, label: string, detail?: string): TranscriptMark => ({
	id: transcriptMarkId(kind, rawId),
	kind,
	label,
	detail,
})

const toolLabel = (tool: ToolBlock): string => {
	if (tool.isError) return "error"
	if (tool.name === "bash") return "cmd"
	return tool.name.slice(0, 6) || "tool"
}

const firstLine = (text: string): string => text.split("\n")[0]?.trim() ?? ""

const shellStatus = (exitCode: number | null): string | undefined => {
	if (exitCode === null || exitCode === 0) return undefined
	return `exit ${exitCode}`
}

export function buildTranscriptMarkIds(
	messages: UIMessage[],
	toolBlocks: ToolBlock[],
	thinkingVisible: boolean,
): string[] {
	const ids: string[] = []
	const renderedToolIds = new Set<string>()
	let promptCount = 0

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		const isLastMessage = i === messages.length - 1

		if (msg.role === "user") {
			promptCount += 1
			ids.push(transcriptMarkId("prompt", msg.id || String(promptCount)))
			continue
		}

		if (msg.role === "shell") {
			ids.push(transcriptMarkId(msg.exitCode !== null && msg.exitCode !== 0 ? "error" : "shell", msg.id))
			continue
		}

		if (msg.contentBlocks && msg.contentBlocks.length > 0) {
			for (let blockIdx = 0; blockIdx < msg.contentBlocks.length; blockIdx++) {
				const block = msg.contentBlocks[blockIdx]
				if (block.type === "thinking" && thinkingVisible) {
					ids.push(transcriptMarkId("thinking", block.id))
				} else if (block.type === "text" && block.text) {
					ids.push(transcriptMarkId("assistant", `${msg.id}-${blockIdx}`))
				} else if (block.type === "tool" && !renderedToolIds.has(block.tool.id)) {
					ids.push(transcriptMarkId(block.tool.isError ? "error" : "tool", block.tool.id))
					renderedToolIds.add(block.tool.id)
				}
			}
		} else {
			if (thinkingVisible && msg.thinking) ids.push(transcriptMarkId("thinking", `thinking-${msg.id}`))
			for (const tool of msg.tools || []) {
				if (renderedToolIds.has(tool.id)) continue
				ids.push(transcriptMarkId(tool.isError ? "error" : "tool", tool.id))
				renderedToolIds.add(tool.id)
			}
			if (msg.content) ids.push(transcriptMarkId("assistant", `${msg.id}-final`))
		}

		if (isLastMessage) {
			for (const tool of toolBlocks) {
				if (renderedToolIds.has(tool.id)) continue
				ids.push(transcriptMarkId(tool.isError ? "error" : "tool", tool.id))
				renderedToolIds.add(tool.id)
			}
		}
	}

	return ids
}

function ToolBlockWrapper(props: {
	tool: ToolBlock
	isExpanded: (id: string) => boolean
	onToggle: (id: string) => void
	diffWrapMode: "word" | "none"
	onEditFile?: (path: string, line?: number) => void
}) {
	const expanded = createMemo(() => props.isExpanded(props.tool.id))

	return (
		<ToolBlockComponent
			name={props.tool.name}
			args={props.tool.args as ToolArgs}
			output={props.tool.output || null}
			editDiff={props.tool.editDiff || null}
			isError={props.tool.isError}
			isComplete={props.tool.isComplete}
			expanded={expanded()}
			diffWrapMode={props.diffWrapMode}
			onToggleExpanded={() => props.onToggle(props.tool.id)}
			onEditFile={props.onEditFile}
			// Custom tool metadata for first-class rendering
			label={props.tool.label}
			source={props.tool.source}
			sourcePath={props.tool.sourcePath}
			result={props.tool.result}
			renderCall={props.tool.renderCall}
			renderResult={props.tool.renderResult}
		/>
	)
}

// ----- Thinking Block Wrapper -----

const THINKING_MAX_WIDTH = 50

function truncateThinking(text: string): string {
	const firstLine = text.split("\n")[0] || ""
	if (firstLine.length <= THINKING_MAX_WIDTH) return firstLine
	return firstLine.slice(0, THINKING_MAX_WIDTH - 3) + "..."
}

function isSelectingMouseEvent(event: unknown): boolean {
	return typeof event === "object" && event !== null && "isSelecting" in event && event.isSelecting === true
}

function ThinkingBlockWrapper(props: {
	id: string
	summary: string
	preview?: string
	full: string
	isExpanded: (id: string) => boolean
	onToggle: (id: string) => void
	concealMarkdown?: boolean
}) {
	const { theme } = useTheme()
	const expanded = createMemo(() => props.isExpanded(props.id))
	const preview = () => props.preview || truncateThinking(props.summary || props.full)

	return (
		<box paddingLeft={4} flexDirection="column">
			<box
				flexDirection="row"
				onMouseUp={(e) => {
					if (isSelectingMouseEvent(e)) return
					props.onToggle(props.id)
				}}
			>
				<text selectable={false} fg={theme.textMuted}>
					{expanded() ? "▾" : "▸"} {preview()}
				</text>
			</box>
			<Show when={expanded()}>
				<box paddingLeft={2} paddingTop={1}>
					<Markdown text={props.full} conceal={props.concealMarkdown} dim />
				</box>
			</Show>
		</box>
	)
}

// ----- Content Items Builder -----

// Per-item cache: reuse ContentItem objects when data unchanged
// Key format: "type:id" or "type:msgId:blockIdx"
const itemCache = new Map<string, TranscriptContentItem>()
let activeCacheKeys = new Set<string>()
let lastMessageCount = 0
let lastFirstMessageId: string | null = null

/** Get or create a cached ContentItem, preserving object identity when data matches */
function getCachedItem<T extends TranscriptContentItem>(
	key: string,
	current: T,
	isEqual: (a: T, b: T) => boolean
): T {
	activeCacheKeys.add(key)
	const cached = itemCache.get(key) as T | undefined
	if (cached && cached.type === current.type && isEqual(cached, current)) {
		return cached
	}
	itemCache.set(key, current)
	return current
}

export function buildContentItems(
	messages: UIMessage[],
	toolBlocks: ToolBlock[],
	thinkingVisible: boolean
): TranscriptContentItem[] {
	// Prune stale cache entries when message count decreases (e.g., clear)
	if (messages.length < lastMessageCount) {
		itemCache.clear()
	}
	lastMessageCount = messages.length
	const firstMessageId = messages.length > 0 ? messages[0].id : null
	if (firstMessageId !== lastFirstMessageId) {
		if (lastFirstMessageId !== null) itemCache.clear()
		lastFirstMessageId = firstMessageId
	}

	activeCacheKeys = new Set()
	const items: TranscriptContentItem[] = []
	const renderedToolIds = new Set<string>()
	let promptCount = 0

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		const isLastMessage = i === messages.length - 1

		if (msg.role === "user") {
			promptCount += 1
			const item: TranscriptContentItem = {
				type: "user",
				content: msg.content,
				mark: makeMark("prompt", msg.id || String(promptCount), `§${promptCount}`, firstLine(msg.content)),
			}
			items.push(
				getCachedItem(`user:${msg.id}`, item, (a, b) => a.content === b.content)
			)
		} else if (msg.role === "assistant") {
			// Use contentBlocks if available (preserves interleaved order)
			if (msg.contentBlocks && msg.contentBlocks.length > 0) {
				for (let blockIdx = 0; blockIdx < msg.contentBlocks.length; blockIdx++) {
					const block = msg.contentBlocks[blockIdx]
					if (block.type === "thinking") {
						if (thinkingVisible) {
							const item: TranscriptContentItem = {
								type: "thinking",
								id: block.id,
								summary: block.summary,
								preview: block.preview,
								full: block.full,
								isStreaming: msg.isStreaming,
								mark: makeMark("thinking", block.id, "think", block.preview || block.summary),
							}
							items.push(
								getCachedItem(`thinking:${msg.id}:${block.id}`, item, (a, b) =>
									a.type === "thinking" && b.type === "thinking" &&
									a.full === b.full && a.isStreaming === b.isStreaming
								)
							)
						}
					} else if (block.type === "text") {
						if (block.text) {
							const item: TranscriptContentItem = {
								type: "assistant",
								content: block.text,
								isStreaming: msg.isStreaming,
								mark: makeMark("assistant", `${msg.id}-${blockIdx}`, msg.isStreaming ? "live" : "out", firstLine(block.text)),
							}
							if (msg.isStreaming) {
								items.push(item)
							} else {
								items.push(
									getCachedItem(`text:${msg.id}:${blockIdx}:final`, item, (a, b) =>
										a.type === "assistant" && b.type === "assistant" &&
										a.content === b.content && a.isStreaming === b.isStreaming
									)
								)
							}
						}
					} else if (block.type === "tool") {
						if (!renderedToolIds.has(block.tool.id)) {
							const item: TranscriptContentItem = {
								type: "tool",
								tool: block.tool,
								mark: makeMark(block.tool.isError ? "error" : "tool", block.tool.id, toolLabel(block.tool), block.tool.name),
							}
							items.push(
								getCachedItem(`tool:${block.tool.id}:${block.tool.isComplete}`, item, (a, b) =>
									a.type === "tool" && b.type === "tool" &&
									a.tool.id === b.tool.id && a.tool.isComplete === b.tool.isComplete &&
									a.tool.output === b.tool.output &&
									(a.tool.updateSeq ?? 0) === (b.tool.updateSeq ?? 0)
								)
							)
							renderedToolIds.add(block.tool.id)
						}
					}
				}
			} else {
				// Fallback: legacy format without contentBlocks
				if (thinkingVisible && msg.thinking) {
					const item: TranscriptContentItem = {
						type: "thinking",
						id: `thinking-${msg.id}`,
						summary: msg.thinking.summary,
						preview: msg.thinking.preview || truncateThinking(msg.thinking.summary || msg.thinking.full),
						full: msg.thinking.full,
						isStreaming: msg.isStreaming,
						mark: makeMark("thinking", `thinking-${msg.id}`, "think", msg.thinking.preview || msg.thinking.summary),
					}
					items.push(
						getCachedItem(`thinking:${msg.id}`, item, (a, b) =>
							a.type === "thinking" && b.type === "thinking" &&
							a.full === b.full && a.isStreaming === b.isStreaming
						)
					)
				}

				for (const tool of msg.tools || []) {
					if (!renderedToolIds.has(tool.id)) {
						const item: TranscriptContentItem = {
							type: "tool",
							tool,
							mark: makeMark(tool.isError ? "error" : "tool", tool.id, toolLabel(tool), tool.name),
						}
						items.push(
							getCachedItem(`tool:${tool.id}:${tool.isComplete}`, item, (a, b) =>
								a.type === "tool" && b.type === "tool" &&
								a.tool.id === b.tool.id && a.tool.isComplete === b.tool.isComplete &&
								a.tool.output === b.tool.output &&
								(a.tool.updateSeq ?? 0) === (b.tool.updateSeq ?? 0)
							)
						)
						renderedToolIds.add(tool.id)
					}
				}

				if (msg.content) {
					const item: TranscriptContentItem = {
						type: "assistant",
						content: msg.content,
						isStreaming: msg.isStreaming,
						mark: makeMark("assistant", `${msg.id}-final`, msg.isStreaming ? "live" : "out", firstLine(msg.content)),
					}
					if (msg.isStreaming) {
						items.push(item)
					} else {
						items.push(
							getCachedItem(`text:${msg.id}:final`, item, (a, b) =>
								a.type === "assistant" && b.type === "assistant" &&
								a.content === b.content && a.isStreaming === b.isStreaming
							)
						)
					}
				}
			}

			// For last message, include orphan toolBlocks from global state
			if (isLastMessage) {
				for (const tool of toolBlocks) {
					if (!renderedToolIds.has(tool.id)) {
						const item: TranscriptContentItem = {
							type: "tool",
							tool,
							mark: makeMark(tool.isError ? "error" : "tool", tool.id, toolLabel(tool), tool.name),
						}
						items.push(
							getCachedItem(`tool:${tool.id}:${tool.isComplete}`, item, (a, b) =>
								a.type === "tool" && b.type === "tool" &&
								a.tool.id === b.tool.id && a.tool.isComplete === b.tool.isComplete &&
								a.tool.output === b.tool.output &&
								(a.tool.updateSeq ?? 0) === (b.tool.updateSeq ?? 0)
							)
						)
						renderedToolIds.add(tool.id)
					}
				}
			}
		} else if (msg.role === "shell") {
			const isError = msg.exitCode !== null && msg.exitCode !== 0
			const item: TranscriptContentItem = {
				type: "shell",
				command: msg.command,
				output: msg.output,
				exitCode: msg.exitCode,
				truncated: msg.truncated,
				tempFilePath: msg.tempFilePath,
				mark: makeMark(isError ? "error" : "shell", msg.id, "$", shellStatus(msg.exitCode) ?? firstLine(msg.command)),
			}
			items.push(
				getCachedItem(`shell:${msg.id}`, item, (a, b) =>
					a.type === "shell" && b.type === "shell" &&
					a.command === b.command && a.output === b.output
				)
			)
		}
	}

	for (const key of itemCache.keys()) {
		if (!activeCacheKeys.has(key)) itemCache.delete(key)
	}

	return items
}

function markColor(theme: Theme, kind: TranscriptMarkKind): RGBA {
	switch (kind) {
		case "prompt":
			return theme.primary
		case "assistant":
			return theme.textMuted
		case "thinking":
			return theme.secondary
		case "tool":
			return theme.accent
		case "error":
			return theme.error
		case "shell":
			return theme.warning
	}
}

function TranscriptRow(props: {
	mark: TranscriptMark
	children: JSX.Element
}) {
	const { theme } = useTheme()
	const color = () => markColor(theme, props.mark.kind)
	return (
		<box id={props.mark.id} flexDirection="row" gap={1} paddingLeft={1}>
			<box width={7} flexShrink={0}>
				<text selectable={false} fg={color()}>
					{props.mark.label}
				</text>
			</box>
			<box width={1} backgroundColor={props.mark.kind === "error" ? theme.error : theme.borderSubtle} flexShrink={0} />
			<box flexDirection="column" flexGrow={1} minWidth={0}>
				{props.children}
			</box>
		</box>
	)
}

function StreamingCursor(): JSX.Element {
	const { theme } = useTheme()
	return (
		<text selectable={false} fg={theme.textMuted}>
			{"▌"}
		</text>
	)
}

// ----- MessageList Component -----

export interface MessageListProps {
	messages: UIMessage[]
	toolBlocks: ToolBlock[]
	thinkingVisible: boolean
	diffWrapMode: "word" | "none"
	concealMarkdown?: boolean
	isToolExpanded: (id: string) => boolean
	toggleToolExpanded: (id: string) => void
	isThinkingExpanded: (id: string) => boolean
	toggleThinkingExpanded: (id: string) => void
	onEditFile?: (path: string, line?: number) => void
}

export function MessageList(props: MessageListProps) {
	const { theme } = useTheme()

	const contentItems = createMemo(() =>
		profile("build_content_items", () =>
			buildContentItems(props.messages, props.toolBlocks, props.thinkingVisible)
		)
	)

	return (
		<box flexDirection="column" gap={1} paddingTop={1}>
			<For each={contentItems()}>
				{(item) => (
					<Switch>
						<Match when={item.type === "user" && item}>
							{(userItem) => (
								<TranscriptRow mark={userItem().mark}>
									<text fg={theme.text} attributes={TextAttributes.BOLD}>
										{userItem().content}
									</text>
								</TranscriptRow>
							)}
						</Match>
						<Match when={item.type === "thinking" && item}>
							{(thinkingItem) => (
								<TranscriptRow mark={thinkingItem().mark}>
									<ThinkingBlockWrapper
										id={thinkingItem().id}
										summary={thinkingItem().summary}
										preview={thinkingItem().preview}
										full={thinkingItem().full}
										isExpanded={props.isThinkingExpanded}
										onToggle={props.toggleThinkingExpanded}
										concealMarkdown={props.concealMarkdown}
									/>
								</TranscriptRow>
							)}
						</Match>
						<Match when={item.type === "assistant" && item}>
							{(assistantItem) => (
								<TranscriptRow mark={assistantItem().mark}>
									<Markdown
										text={assistantItem().content}
										conceal={props.concealMarkdown}
										streaming={assistantItem().isStreaming}
									/>
									<Show when={assistantItem().isStreaming}>
										<StreamingCursor />
									</Show>
								</TranscriptRow>
							)}
						</Match>
						<Match when={item.type === "tool" && item}>
							{(toolItem) => (
								<TranscriptRow mark={toolItem().mark}>
									<ToolBlockWrapper
										tool={toolItem().tool}
										isExpanded={props.isToolExpanded}
										onToggle={props.toggleToolExpanded}
										diffWrapMode={props.diffWrapMode}
										onEditFile={props.onEditFile}
									/>
								</TranscriptRow>
							)}
						</Match>
						<Match when={item.type === "shell" && item}>
							{(shellItem) => (
								<TranscriptRow mark={shellItem().mark}>
									<text fg={theme.warning} attributes={TextAttributes.BOLD}>
										{shellItem().command}
									</text>
									<Show when={shellItem().output}>
										<CodeBlock content={shellItem().output} filetype="text" showLineNumbers={false} wrapMode="none" />
									</Show>
									<Show when={shellItem().exitCode !== null && shellItem().exitCode !== 0}>
										<text fg={theme.error}>{`exit ${shellItem().exitCode}`}</text>
									</Show>
									<Show when={shellItem().truncated && shellItem().tempFilePath}>
										<text fg={theme.textMuted}>{`[truncated, full output: ${shellItem().tempFilePath}]`}</text>
									</Show>
								</TranscriptRow>
							)}
						</Match>
					</Switch>
				)}
			</For>
		</box>
	)
}

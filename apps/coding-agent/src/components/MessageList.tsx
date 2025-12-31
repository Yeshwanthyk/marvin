/**
 * MessageList component for rendering conversation content
 */

import { For, Show, Switch, Match, createMemo } from "solid-js"
import { Markdown, TextAttributes, useTheme } from "@marvin-agents/open-tui"
import type { UIMessage, ToolBlock, ContentItem } from "../types.js"
import { profile } from "../profiler.js"
import { ToolBlock as ToolBlockComponent } from "../tui-open-rendering.js"

// ----- Tool Block Wrapper -----

function ToolBlockWrapper(props: {
	tool: ToolBlock
	isExpanded: (id: string) => boolean
	onToggle: (id: string) => void
	diffWrapMode: "word" | "none"
	onEditFile?: (path: string) => void
}) {
	const expanded = createMemo(() => props.isExpanded(props.tool.id))

	return (
		<ToolBlockComponent
			name={props.tool.name}
			args={props.tool.args}
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
	return firstLine.slice(0, THINKING_MAX_WIDTH - 1) + "…"
}

function ThinkingBlockWrapper(props: {
	id: string
	summary: string
	full: string
	isExpanded: (id: string) => boolean
	onToggle: (id: string) => void
	concealMarkdown?: boolean
}) {
	const { theme } = useTheme()
	const expanded = createMemo(() => props.isExpanded(props.id))
	const preview = () => truncateThinking(props.summary || props.full)

	return (
		<box paddingLeft={4} flexDirection="column">
			<box
				flexDirection="row"
				onMouseUp={(e: { isSelecting?: boolean }) => {
					if (e.isSelecting) return
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
const itemCache = new Map<string, ContentItem>()
let lastMessageCount = 0

/** Get or create a cached ContentItem, preserving object identity when data matches */
function getCachedItem<T extends ContentItem>(
	key: string,
	current: T,
	isEqual: (a: T, b: T) => boolean
): T {
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
): ContentItem[] {
	// Prune stale cache entries when message count decreases (e.g., clear)
	if (messages.length < lastMessageCount) {
		itemCache.clear()
	}
	lastMessageCount = messages.length

	const items: ContentItem[] = []
	const renderedToolIds = new Set<string>()

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		const isLastMessage = i === messages.length - 1

		if (msg.role === "user") {
			const item: ContentItem = { type: "user", content: msg.content }
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
							const item: ContentItem = {
								type: "thinking",
								id: block.id,
								summary: block.summary,
								full: block.full,
								isStreaming: msg.isStreaming,
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
							const item: ContentItem = { type: "assistant", content: block.text, isStreaming: msg.isStreaming }
							// For streaming text, use content length in key to allow updates
							// but still cache when length stabilizes
							const contentKey = msg.isStreaming ? "streaming" : "final"
							items.push(
								getCachedItem(`text:${msg.id}:${blockIdx}:${contentKey}`, item, (a, b) =>
									a.type === "assistant" && b.type === "assistant" &&
									a.content === b.content && a.isStreaming === b.isStreaming
								)
							)
						}
					} else if (block.type === "tool") {
						if (!renderedToolIds.has(block.tool.id)) {
							const item: ContentItem = { type: "tool", tool: block.tool }
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
					const item: ContentItem = {
						type: "thinking",
						id: `thinking-${msg.id}`,
						summary: msg.thinking.summary,
						full: msg.thinking.full,
						isStreaming: msg.isStreaming,
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
						const item: ContentItem = { type: "tool", tool }
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
					const item: ContentItem = { type: "assistant", content: msg.content, isStreaming: msg.isStreaming }
					const contentKey = msg.isStreaming ? "streaming" : "final"
					items.push(
						getCachedItem(`text:${msg.id}:${contentKey}`, item, (a, b) =>
							a.type === "assistant" && b.type === "assistant" &&
							a.content === b.content && a.isStreaming === b.isStreaming
						)
					)
				}
			}

			// For last message, include orphan toolBlocks from global state
			if (isLastMessage) {
				for (const tool of toolBlocks) {
					if (!renderedToolIds.has(tool.id)) {
						const item: ContentItem = { type: "tool", tool }
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
			const item: ContentItem = {
				type: "shell",
				command: msg.command,
				output: msg.output,
				exitCode: msg.exitCode,
				truncated: msg.truncated,
				tempFilePath: msg.tempFilePath,
			}
			items.push(
				getCachedItem(`shell:${msg.id}`, item, (a, b) =>
					a.type === "shell" && b.type === "shell" &&
					a.command === b.command && a.output === b.output
				)
			)
		}
	}

	return items
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
	onEditFile?: (path: string) => void
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
								<box paddingLeft={1}>
									<text fg={theme.primary}>
										<span>{"§ "}</span>
										{userItem().content}
									</text>
								</box>
							)}
						</Match>
						<Match when={item.type === "thinking" && item}>
							{(thinkingItem) => (
								<ThinkingBlockWrapper
									id={thinkingItem().id}
									summary={thinkingItem().summary}
									full={thinkingItem().full}
									isExpanded={props.isThinkingExpanded}
									onToggle={props.toggleThinkingExpanded}
									concealMarkdown={props.concealMarkdown}
								/>
							)}
						</Match>
						<Match when={item.type === "assistant" && item}>
							{(assistantItem) => (
								<box paddingLeft={1}>
									<Markdown
										text={assistantItem().content}
										conceal={props.concealMarkdown}
										streaming={assistantItem().isStreaming}
									/>
								</box>
							)}
						</Match>
						<Match when={item.type === "tool" && item}>
							{(toolItem) => (
								<box paddingLeft={6}>
									<ToolBlockWrapper
										tool={toolItem().tool}
										isExpanded={props.isToolExpanded}
										onToggle={props.toggleToolExpanded}
										diffWrapMode={props.diffWrapMode}
										onEditFile={props.onEditFile}
									/>
								</box>
							)}
						</Match>
						<Match when={item.type === "shell" && item}>
							{(shellItem) => (
								<box paddingLeft={1} flexDirection="column">
									<text fg={theme.warning}>
										<span>{"$ "}</span>
										{shellItem().command}
									</text>
									<Show when={shellItem().output}>
										<box paddingLeft={2} paddingTop={1}>
											<text fg={theme.textMuted}>{shellItem().output}</text>
										</box>
									</Show>
									<Show when={shellItem().exitCode !== null && shellItem().exitCode !== 0}>
										<text fg={theme.error}>{`exit ${shellItem().exitCode}`}</text>
									</Show>
									<Show when={shellItem().truncated && shellItem().tempFilePath}>
										<text fg={theme.textMuted}>{`[truncated, full output: ${shellItem().tempFilePath}]`}</text>
									</Show>
								</box>
							)}
						</Match>
					</Switch>
				)}
			</For>
		</box>
	)
}

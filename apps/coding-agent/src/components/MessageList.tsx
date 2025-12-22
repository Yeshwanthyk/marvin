/**
 * MessageList component for rendering conversation content
 */

import { For, Show, Switch, Match, createMemo } from "solid-js"
import { Markdown, TextAttributes, useTheme } from "@marvin-agents/open-tui"
import type { UIMessage, ToolBlock, ContentItem } from "../types.js"
import { ToolBlock as ToolBlockComponent } from "../tui-open-rendering.js"

// ----- Tool Block Wrapper -----

function ToolBlockWrapper(props: {
	tool: ToolBlock
	isExpanded: (id: string) => boolean
	onToggle: (id: string) => void
	diffWrapMode: "word" | "none"
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

function ThinkingBlockWrapper(props: {
	id: string
	summary: string
	full: string
	isExpanded: (id: string) => boolean
	onToggle: (id: string) => void
}) {
	const { theme } = useTheme()
	const expanded = createMemo(() => props.isExpanded(props.id))

	return (
		<box paddingLeft={1} flexDirection="column">
			<box
				flexDirection="row"
				gap={1}
				onMouseUp={(e: { isSelecting?: boolean }) => {
					if (e.isSelecting) return
					props.onToggle(props.id)
				}}
			>
				<text selectable={false} fg={theme.textMuted}>◦</text>
				<text selectable={false} fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
					{expanded() ? "" : props.summary}
				</text>
				<text selectable={false} fg={theme.textMuted}>{expanded() ? "▴" : "▸"}</text>
			</box>
			<Show when={expanded()}>
				<box paddingLeft={2} paddingTop={1}>
					<text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
						{props.full}
					</text>
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
							const contentKey = msg.isStreaming ? block.text.length : "final"
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
									a.tool.output === b.tool.output
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
								a.tool.output === b.tool.output
							)
						)
						renderedToolIds.add(tool.id)
					}
				}

				if (msg.content) {
					const item: ContentItem = { type: "assistant", content: msg.content, isStreaming: msg.isStreaming }
					const contentKey = msg.isStreaming ? msg.content.length : "final"
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
								a.tool.output === b.tool.output
							)
						)
						renderedToolIds.add(tool.id)
					}
				}
			}
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
	isToolExpanded: (id: string) => boolean
	toggleToolExpanded: (id: string) => void
	isThinkingExpanded: (id: string) => boolean
	toggleThinkingExpanded: (id: string) => void
}

export function MessageList(props: MessageListProps) {
	const { theme } = useTheme()

	const contentItems = createMemo(() =>
		buildContentItems(props.messages, props.toolBlocks, props.thinkingVisible)
	)

	return (
		<box flexDirection="column" gap={1} paddingTop={1}>
			<For each={contentItems()}>
				{(item) => (
					<Switch>
						<Match when={item.type === "user" && item}>
							{(userItem) => (
								<box paddingLeft={1}>
									<text fg={theme.text}>
										<span style={{ fg: theme.textMuted }}>{"› "}</span>
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
								/>
							)}
						</Match>
						<Match when={item.type === "assistant" && item}>
							{(assistantItem) => (
								<box paddingLeft={1}>
									{/* Plain text while streaming (avoids O(n²) markdown re-lex), Markdown when complete */}
									<Show when={assistantItem().isStreaming} fallback={<Markdown text={assistantItem().content} />}>
										<text fg={theme.text}>{assistantItem().content}<span style={{ fg: theme.textMuted }}>▁</span></text>
									</Show>
								</box>
							)}
						</Match>
						<Match when={item.type === "tool" && item}>
							{(toolItem) => (
								<box paddingLeft={3}>
									<ToolBlockWrapper
										tool={toolItem().tool}
										isExpanded={props.isToolExpanded}
										onToggle={props.toggleToolExpanded}
										diffWrapMode={props.diffWrapMode}
									/>
								</box>
							)}
						</Match>
					</Switch>
				)}
			</For>
		</box>
	)
}

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
				<text selectable={false} fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
					thinking {expanded() ? "" : props.summary}
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

// Cache key for memoization
let cachedKey = ""
let cachedItems: ContentItem[] = []

export function buildContentItems(
	messages: UIMessage[],
	toolBlocks: ToolBlock[],
	thinkingVisible: boolean
): ContentItem[] {
	// Build a cache key from message IDs, streaming states, and tool completion states
	const keyParts = [
		thinkingVisible ? "t" : "f",
		messages.map(m => `${m.id}:${m.isStreaming ? 1 : 0}:${m.content?.length || 0}`).join(","),
		toolBlocks.map(t => `${t.id}:${t.isComplete ? 1 : 0}`).join(","),
	]
	const key = keyParts.join("|")
	if (key === cachedKey) return cachedItems

	const items: ContentItem[] = []
	const renderedToolIds = new Set<string>()

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		const isLastMessage = i === messages.length - 1

		if (msg.role === "user") {
			items.push({ type: "user", content: msg.content })
		} else if (msg.role === "assistant") {
			// Use contentBlocks if available (preserves interleaved order)
			if (msg.contentBlocks && msg.contentBlocks.length > 0) {
				for (const block of msg.contentBlocks) {
					if (block.type === "thinking") {
						if (thinkingVisible) {
							items.push({
								type: "thinking",
								id: block.id,
								summary: block.summary,
								full: block.full,
								isStreaming: msg.isStreaming,
							})
						}
					} else if (block.type === "text") {
						if (block.text) {
							items.push({ type: "assistant", content: block.text, isStreaming: msg.isStreaming })
						}
					} else if (block.type === "tool") {
						if (!renderedToolIds.has(block.tool.id)) {
							items.push({ type: "tool", tool: block.tool })
							renderedToolIds.add(block.tool.id)
						}
					}
				}
			} else {
				// Fallback: legacy format without contentBlocks
				if (thinkingVisible && msg.thinking) {
					items.push({
						type: "thinking",
						id: `thinking-${msg.id}`,
						summary: msg.thinking.summary,
						full: msg.thinking.full,
						isStreaming: msg.isStreaming,
					})
				}

				for (const tool of msg.tools || []) {
					if (!renderedToolIds.has(tool.id)) {
						items.push({ type: "tool", tool })
						renderedToolIds.add(tool.id)
					}
				}

				if (msg.content) {
					items.push({ type: "assistant", content: msg.content, isStreaming: msg.isStreaming })
				}
			}

			// For last message, include orphan toolBlocks from global state
			if (isLastMessage) {
				for (const tool of toolBlocks) {
					if (!renderedToolIds.has(tool.id)) {
						items.push({ type: "tool", tool })
						renderedToolIds.add(tool.id)
					}
				}
			}
		}
	}

	cachedKey = key
	cachedItems = items
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
										<text fg={theme.text}>{assistantItem().content}</text>
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

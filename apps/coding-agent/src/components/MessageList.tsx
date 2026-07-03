/**
 * MessageList component for rendering conversation content
 */

import { For, Show, Switch, Match, createMemo, createSignal, type JSX } from "solid-js"
import { CodeBlock, Markdown, TextAttributes, useTheme, type RGBA, type Theme } from "@yeshwanthyk/open-tui"
import type { UIMessage, ToolBlock, ContentItem } from "../types.js"
import type { ToolArgs } from "../types/tool-rendering.js"
import { ToolBlock as ToolBlockComponent } from "../tui-open-rendering.js"

// ----- Tool Block Wrapper -----

export type TranscriptMarkKind = "prompt" | "assistant" | "thinking" | "tool" | "error" | "shell"

export interface TranscriptMark {
	id: string
	kind: TranscriptMarkKind
	label: string
	detail?: string
}

export type TranscriptSingleItem = ContentItem & { mark: TranscriptMark }
export type TranscriptWorkEntry =
	| (Extract<ContentItem, { type: "thinking" }> & { mark: TranscriptMark })
	| (Extract<ContentItem, { type: "tool" }> & { mark: TranscriptMark })
export interface TranscriptWorkGroup {
	type: "work"
	entries: TranscriptWorkEntry[]
	mark: TranscriptMark
}
export type TranscriptContentItem =
	| TranscriptSingleItem
	| TranscriptWorkGroup

export const TRANSCRIPT_WINDOW_CHUNK_SIZE = 75

export interface TranscriptWindow {
	items: TranscriptContentItem[]
	startIndex: number
	endIndex: number
	hiddenBefore: number
}

const sanitizeMarkId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "item"

export const transcriptMarkId = (kind: TranscriptMarkKind, rawId: string): string =>
	`transcript-${kind}-${sanitizeMarkId(rawId)}`

const makeMark = (kind: TranscriptMarkKind, rawId: string, label: string, detail?: string): TranscriptMark => ({
	id: transcriptMarkId(kind, rawId),
	kind,
	label,
	detail,
})

const firstLine = (text: string): string => text.split("\n")[0]?.trim() ?? ""
const hasThinkingContent = (
	value?: { summary: string; preview: string; full: string } | null,
): value is { summary: string; preview: string; full: string } =>
	Boolean(value && (value.full?.trim() || value.preview?.trim() || value.summary?.trim()))

const shellStatus = (exitCode: number | null): string | undefined => {
	if (exitCode === null || exitCode === 0) return undefined
	return `exit ${exitCode}`
}

export function buildTranscriptMarkIds(
	messages: UIMessage[],
	toolBlocks: ToolBlock[],
	thinkingVisible: boolean,
	cache?: TranscriptContentCache,
): string[] {
	return buildContentItems(messages, toolBlocks, thinkingVisible, cache).map((item) => item.mark.id)
}

export function transcriptWindowForItems(
	items: TranscriptContentItem[],
	visibleCount: number,
): TranscriptWindow {
	const boundedVisibleCount = Math.max(0, Math.floor(visibleCount))
	const startIndex = Math.max(0, items.length - boundedVisibleCount)
	return {
		items: items.slice(startIndex),
		startIndex,
		endIndex: items.length,
		hiddenBefore: startIndex,
	}
}

export function expandedTranscriptWindowSizeForIndex(
	totalItems: number,
	currentVisibleCount: number,
	targetIndex: number,
	chunkSize = TRANSCRIPT_WINDOW_CHUNK_SIZE,
): number {
	if (totalItems <= 0) return 0
	const boundedTargetIndex = Math.max(0, Math.min(totalItems - 1, Math.floor(targetIndex)))
	const current = Math.max(0, Math.floor(currentVisibleCount))
	if (boundedTargetIndex >= Math.max(0, totalItems - current)) return Math.min(totalItems, current)
	const minimumVisibleCount = totalItems - boundedTargetIndex
	const chunk = Math.max(1, Math.floor(chunkSize))
	const expanded = Math.max(current, minimumVisibleCount)
	return Math.min(totalItems, Math.ceil(expanded / chunk) * chunk)
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
		<box paddingLeft={1} flexDirection="column">
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

export interface TranscriptContentCache {
	itemCache: Map<string, TranscriptSingleItem>
	settledMessageRefs: UIMessage[]
	settledThinkingVisible: boolean
	settledItems: TranscriptSingleItem[]
	settledGroupedItems: TranscriptContentItem[]
	settledPromptCount: number
	settledRenderedToolIds: Set<string>
}

export function createTranscriptContentCache(): TranscriptContentCache {
	return {
		itemCache: new Map(),
		settledMessageRefs: [],
		settledThinkingVisible: true,
		settledItems: [],
		settledGroupedItems: [],
		settledPromptCount: 0,
		settledRenderedToolIds: new Set(),
	}
}

/** Get or create a cached ContentItem, preserving object identity when data matches */
function getCachedItem(
	cache: TranscriptContentCache,
	activeCacheKeys: Set<string>,
	key: string,
	current: TranscriptSingleItem,
	isEqual: (a: TranscriptSingleItem, b: TranscriptSingleItem) => boolean
): TranscriptSingleItem {
	activeCacheKeys.add(key)
	const cached = cache.itemCache.get(key)
	if (cached && cached.type === current.type && isEqual(cached, current)) {
		return cached
	}
	cache.itemCache.set(key, current)
	return current
}

const sameMark = (a: TranscriptSingleItem, b: TranscriptSingleItem): boolean =>
	a.mark.id === b.mark.id && a.mark.kind === b.mark.kind && a.mark.label === b.mark.label && a.mark.detail === b.mark.detail

const plural = (count: number, singular: string, pluralLabel = `${singular}s`): string =>
	`${count} ${count === 1 ? singular : pluralLabel}`

const isRuntimeWorkItem = (item: TranscriptSingleItem): item is TranscriptWorkEntry =>
	item.type === "thinking" || item.type === "tool"

type WorkTone = "think" | "read" | "run" | "edit" | "tool" | "fail"
type WorkGroupLabel = WorkTone | "work"

const LOOK_COMMAND_PATTERN =
	/^(pwd|ls\b|find\b|fd\b|rg\b|grep\b|sed\b|cat\b|nl\b|head\b|tail\b|wc\b|git\s+(status|show|diff|log|grep|ls-files|branch|rev-parse)\b)/

const stringProperty = (value: unknown, key: string): string | undefined => {
	if (typeof value !== "object" || value === null) return undefined
	const raw = (value as Record<string, unknown>)[key]
	return typeof raw === "string" ? raw : undefined
}

const bashCommand = (tool: ToolBlock): string | undefined =>
	tool.name === "bash" ? stringProperty(tool.args, "command")?.trim() : undefined

const workToneForTool = (tool: ToolBlock): WorkTone => {
	if (tool.isError) return "fail"
	if (tool.editDiff || tool.name === "edit" || tool.name === "write") return "edit"
	const command = bashCommand(tool)
	if (command) return LOOK_COMMAND_PATTERN.test(command) ? "read" : "run"
	return "tool"
}

const workToneForEntry = (entry: TranscriptWorkEntry): WorkTone =>
	entry.type === "thinking" ? "think" : workToneForTool(entry.tool)

const toolLabel = (tool: ToolBlock): string => workToneForTool(tool)

const workGroupLabel = (entries: TranscriptWorkEntry[]): WorkGroupLabel => {
	const tones = entries.map(workToneForEntry)
	if (tones.includes("fail")) return "fail"
	const actionTones = Array.from(new Set(tones.filter((tone) => tone !== "think")))
	if (actionTones.length > 1) return "work"
	const onlyActionTone = actionTones[0]
	if (onlyActionTone) return onlyActionTone
	return "think"
}

interface WorkSummaryPart {
	tone: WorkTone
	count: number
	label: string
}

const workSummaryLabel = (tone: WorkTone): string => {
	switch (tone) {
		case "think":
			return "think"
		case "read":
			return "read"
		case "run":
			return "run"
		case "edit":
			return "edit"
		case "tool":
			return "tool"
		case "fail":
			return "fail"
	}
}

const workSummaryParts = (entries: TranscriptWorkEntry[]): WorkSummaryPart[] => {
	const counts: Record<WorkTone, number> = { think: 0, read: 0, run: 0, edit: 0, tool: 0, fail: 0 }
	for (const entry of entries) counts[workToneForEntry(entry)] += 1
	return (["think", "read", "edit", "run", "tool", "fail"] as const)
		.filter((tone) => counts[tone] > 0)
		.map((tone) => ({
			tone,
			count: counts[tone],
			label: workSummaryLabel(tone),
		}))
}

const summarizeWorkItems = (entries: TranscriptWorkEntry[]): string => {
	const parts = workSummaryParts(entries).map((part) => `${part.count} ${part.label}`)
	return parts.length > 0 ? parts.join(" · ") : plural(entries.length, "item")
}

const makeWorkGroup = (entries: TranscriptWorkEntry[]): TranscriptWorkGroup => {
	const label = workGroupLabel(entries)
	const firstId = entries[0]?.mark.id ?? "work"
	return {
		type: "work",
		entries,
		mark: makeMark(
			label === "fail" ? "error" : label === "think" ? "thinking" : "tool",
			`work-${firstId}`,
			label,
			summarizeWorkItems(entries),
		),
	}
}

const groupRuntimeWorkItems = (items: TranscriptSingleItem[]): TranscriptContentItem[] => {
	const grouped: TranscriptContentItem[] = []
	let run: TranscriptWorkEntry[] = []

	const flushRun = () => {
		if (run.length > 1) {
			grouped.push(makeWorkGroup(run))
		} else {
			grouped.push(...run)
		}
		run = []
	}

	for (const item of items) {
		if (isRuntimeWorkItem(item)) {
			run.push(item)
			continue
		}
		flushRun()
		grouped.push(item)
	}

	flushRun()
	return grouped
}

const workEntriesForItem = (item: TranscriptContentItem): TranscriptWorkEntry[] | null => {
	if (item.type === "work") return item.entries
	if (item.type === "thinking" || item.type === "tool") return [item]
	return null
}

const mergeGroupedItems = (
	prefixItems: TranscriptContentItem[],
	tailItems: TranscriptContentItem[],
): TranscriptContentItem[] => {
	if (prefixItems.length === 0) return tailItems
	if (tailItems.length === 0) return prefixItems
	const prefixLast = prefixItems[prefixItems.length - 1]
	const tailFirst = tailItems[0]
	if (!prefixLast || !tailFirst) return [...prefixItems, ...tailItems]
	const prefixEntries = workEntriesForItem(prefixLast)
	const tailEntries = workEntriesForItem(tailFirst)
	if (!prefixEntries || !tailEntries) return [...prefixItems, ...tailItems]
	const mergedWork = makeWorkGroup([...prefixEntries, ...tailEntries])
	return [...prefixItems.slice(0, -1), mergedWork, ...tailItems.slice(1)]
}

interface MessageBuildResult {
	items: TranscriptSingleItem[]
	renderedToolIds: Set<string>
	promptCount: number
}

const sameSettledRefs = (
	refs: UIMessage[],
	messages: UIMessage[],
	length: number,
	thinkingVisible: boolean,
	cachedThinkingVisible: boolean,
): boolean => {
	if (refs.length !== length || thinkingVisible !== cachedThinkingVisible) return false
	for (let i = 0; i < length; i++) {
		if (refs[i] !== messages[i]) return false
	}
	return true
}

function buildMessageItems(
	messages: UIMessage[],
	startIndex: number,
	endIndex: number,
	toolBlocks: ToolBlock[],
	thinkingVisible: boolean,
	includeOrphanToolBlocks: boolean,
	cache: TranscriptContentCache,
	activeCacheKeys: Set<string>,
	initialRenderedToolIds: Set<string>,
	initialPromptCount: number,
): MessageBuildResult {
	const items: TranscriptSingleItem[] = []
	const renderedToolIds = new Set(initialRenderedToolIds)
	let promptCount = initialPromptCount

	for (let i = startIndex; i < endIndex; i++) {
		const msg = messages[i]
		const isLastMessage = i === messages.length - 1

		if (msg.role === "user") {
			promptCount += 1
			const item: TranscriptSingleItem = {
				type: "user",
				content: msg.content,
				mark: makeMark("prompt", msg.id || String(promptCount), `§${promptCount}`, firstLine(msg.content)),
			}
			items.push(
				getCachedItem(cache, activeCacheKeys, `user:${msg.id}`, item, (a, b) =>
					a.type === "user" && b.type === "user" && a.content === b.content && sameMark(a, b)
				)
			)
		} else if (msg.role === "assistant") {
			if (msg.contentBlocks && msg.contentBlocks.length > 0) {
				for (let blockIdx = 0; blockIdx < msg.contentBlocks.length; blockIdx++) {
					const block = msg.contentBlocks[blockIdx]
					if (block.type === "thinking") {
						if (thinkingVisible && hasThinkingContent(block)) {
							const item: TranscriptSingleItem = {
								type: "thinking",
								id: block.id,
								summary: block.summary,
								preview: block.preview,
								full: block.full,
								isStreaming: msg.isStreaming,
								mark: makeMark("thinking", block.id, "think", block.preview || block.summary),
							}
							items.push(
								getCachedItem(cache, activeCacheKeys, `thinking:${msg.id}:${block.id}`, item, (a, b) =>
									a.type === "thinking" && b.type === "thinking" &&
									a.full === b.full && a.isStreaming === b.isStreaming && sameMark(a, b)
								)
							)
						}
					} else if (block.type === "text") {
						if (block.text) {
							const item: TranscriptSingleItem = {
								type: "assistant",
								content: block.text,
								isStreaming: msg.isStreaming,
								mark: makeMark("assistant", `${msg.id}-${blockIdx}`, msg.isStreaming ? "live" : "out", firstLine(block.text)),
							}
							if (msg.isStreaming) {
								items.push(item)
							} else {
								items.push(
									getCachedItem(cache, activeCacheKeys, `text:${msg.id}:${blockIdx}:final`, item, (a, b) =>
										a.type === "assistant" && b.type === "assistant" &&
										a.content === b.content && a.isStreaming === b.isStreaming && sameMark(a, b)
									)
								)
							}
						}
					} else if (block.type === "tool") {
						if (!renderedToolIds.has(block.tool.id)) {
							const item: TranscriptSingleItem = {
								type: "tool",
								tool: block.tool,
								mark: makeMark(block.tool.isError ? "error" : "tool", block.tool.id, toolLabel(block.tool), block.tool.name),
							}
							items.push(
								getCachedItem(cache, activeCacheKeys, `tool:${block.tool.id}:${block.tool.isComplete}`, item, (a, b) =>
									a.type === "tool" && b.type === "tool" &&
									a.tool.id === b.tool.id && a.tool.isComplete === b.tool.isComplete &&
									a.tool.output === b.tool.output &&
									(a.tool.updateSeq ?? 0) === (b.tool.updateSeq ?? 0) &&
									sameMark(a, b)
								)
							)
							renderedToolIds.add(block.tool.id)
						}
					}
				}
			} else {
				const thinking = msg.thinking
				if (thinkingVisible && hasThinkingContent(thinking)) {
					const item: TranscriptSingleItem = {
						type: "thinking",
						id: `thinking-${msg.id}`,
						summary: thinking.summary,
						preview: thinking.preview || truncateThinking(thinking.summary || thinking.full),
						full: thinking.full,
						isStreaming: msg.isStreaming,
						mark: makeMark("thinking", `thinking-${msg.id}`, "think", thinking.preview || thinking.summary),
					}
					items.push(
						getCachedItem(cache, activeCacheKeys, `thinking:${msg.id}`, item, (a, b) =>
							a.type === "thinking" && b.type === "thinking" &&
							a.full === b.full && a.isStreaming === b.isStreaming && sameMark(a, b)
						)
					)
				}

				for (const tool of msg.tools || []) {
					if (!renderedToolIds.has(tool.id)) {
						const item: TranscriptSingleItem = {
							type: "tool",
							tool,
							mark: makeMark(tool.isError ? "error" : "tool", tool.id, toolLabel(tool), tool.name),
						}
						items.push(
							getCachedItem(cache, activeCacheKeys, `tool:${tool.id}:${tool.isComplete}`, item, (a, b) =>
								a.type === "tool" && b.type === "tool" &&
								a.tool.id === b.tool.id && a.tool.isComplete === b.tool.isComplete &&
								a.tool.output === b.tool.output &&
								(a.tool.updateSeq ?? 0) === (b.tool.updateSeq ?? 0) &&
								sameMark(a, b)
							)
						)
						renderedToolIds.add(tool.id)
					}
				}

				if (msg.content) {
					const item: TranscriptSingleItem = {
						type: "assistant",
						content: msg.content,
						isStreaming: msg.isStreaming,
						mark: makeMark("assistant", `${msg.id}-final`, msg.isStreaming ? "live" : "out", firstLine(msg.content)),
					}
					if (msg.isStreaming) {
						items.push(item)
					} else {
						items.push(
							getCachedItem(cache, activeCacheKeys, `text:${msg.id}:final`, item, (a, b) =>
								a.type === "assistant" && b.type === "assistant" &&
								a.content === b.content && a.isStreaming === b.isStreaming && sameMark(a, b)
							)
						)
					}
				}
			}

			if (includeOrphanToolBlocks && isLastMessage) {
				for (const tool of toolBlocks) {
					if (!renderedToolIds.has(tool.id)) {
						const item: TranscriptSingleItem = {
							type: "tool",
							tool,
							mark: makeMark(tool.isError ? "error" : "tool", tool.id, toolLabel(tool), tool.name),
						}
						items.push(
							getCachedItem(cache, activeCacheKeys, `tool:${tool.id}:${tool.isComplete}`, item, (a, b) =>
								a.type === "tool" && b.type === "tool" &&
								a.tool.id === b.tool.id && a.tool.isComplete === b.tool.isComplete &&
								a.tool.output === b.tool.output &&
								(a.tool.updateSeq ?? 0) === (b.tool.updateSeq ?? 0) &&
								sameMark(a, b)
							)
						)
						renderedToolIds.add(tool.id)
					}
				}
			}
		} else if (msg.role === "shell") {
			const isError = msg.exitCode !== null && msg.exitCode !== 0
			const item: TranscriptSingleItem = {
				type: "shell",
				command: msg.command,
				output: msg.output,
				exitCode: msg.exitCode,
				truncated: msg.truncated,
				tempFilePath: msg.tempFilePath,
				mark: makeMark(isError ? "error" : "shell", msg.id, isError ? "fail" : "shell", shellStatus(msg.exitCode) ?? firstLine(msg.command)),
			}
			items.push(
				getCachedItem(cache, activeCacheKeys, `shell:${msg.id}`, item, (a, b) =>
					a.type === "shell" && b.type === "shell" &&
					a.command === b.command && a.output === b.output && sameMark(a, b)
				)
			)
		}
	}

	return { items, renderedToolIds, promptCount }
}

export function buildContentItems(
	messages: UIMessage[],
	toolBlocks: ToolBlock[],
	thinkingVisible: boolean,
	cache: TranscriptContentCache = createTranscriptContentCache(),
): TranscriptContentItem[] {
	const lastMessage = messages[messages.length - 1]
	const hasLiveTail = Boolean(lastMessage && lastMessage.role === "assistant" && lastMessage.isStreaming) || toolBlocks.length > 0
	const settledLength = hasLiveTail ? Math.max(0, messages.length - 1) : messages.length
	const activeCacheKeys = new Set<string>()

	if (!sameSettledRefs(cache.settledMessageRefs, messages, settledLength, thinkingVisible, cache.settledThinkingVisible)) {
		const settled = buildMessageItems(
			messages,
			0,
			settledLength,
			[],
			thinkingVisible,
			false,
			cache,
			activeCacheKeys,
			new Set(),
			0,
		)
		cache.settledMessageRefs = messages.slice(0, settledLength)
		cache.settledThinkingVisible = thinkingVisible
		cache.settledItems = settled.items
		cache.settledGroupedItems = groupRuntimeWorkItems(settled.items)
		cache.settledPromptCount = settled.promptCount
		cache.settledRenderedToolIds = settled.renderedToolIds
	}

	const tail = buildMessageItems(
		messages,
		settledLength,
		messages.length,
		toolBlocks,
		thinkingVisible,
		true,
		cache,
		activeCacheKeys,
		cache.settledRenderedToolIds,
		cache.settledPromptCount,
	)
	const tailGroupedItems = groupRuntimeWorkItems(tail.items)
	const contentItems = mergeGroupedItems(cache.settledGroupedItems, tailGroupedItems)

	return contentItems
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

function railColor(theme: Theme, kind: TranscriptMarkKind): RGBA {
	if (kind === "error") return theme.error
	if (kind === "prompt") return theme.primary
	return theme.borderSubtle
}

function TranscriptRow(props: {
	mark: TranscriptMark
	children: JSX.Element
}) {
	const { theme } = useTheme()
	const color = () => markColor(theme, props.mark.kind)
	return (
		<box id={props.mark.id} flexDirection="row" gap={1} paddingLeft={1}>
			<box width={5} flexShrink={0}>
				<text selectable={false} fg={color()}>
					{props.mark.label}
				</text>
			</box>
			<text selectable={false} fg={railColor(theme, props.mark.kind)}>
				│
			</text>
			<box flexDirection="column" flexGrow={1} minWidth={0} paddingLeft={1}>
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

function WorkGroupContent(props: {
	group: TranscriptWorkGroup
	isWorkExpanded: (id: string) => boolean
	toggleWorkExpanded: (id: string) => void
	isToolExpanded: (id: string) => boolean
	toggleToolExpanded: (id: string) => void
	isThinkingExpanded: (id: string) => boolean
	toggleThinkingExpanded: (id: string) => void
	diffWrapMode: "word" | "none"
	concealMarkdown?: boolean
	onEditFile?: (path: string, line?: number) => void
}) {
	const { theme } = useTheme()
	const expanded = createMemo(() => props.isWorkExpanded(props.group.mark.id))
	const summaryParts = createMemo(() => workSummaryParts(props.group.entries))
	const toggleExpanded = () => {
		props.toggleWorkExpanded(props.group.mark.id)
	}
	const summaryColor = () => props.group.mark.kind === "error" ? theme.error : theme.textMuted
	const summaryPartColor = (tone: WorkTone): RGBA => tone === "fail" ? theme.error : theme.textMuted

	return (
		<box flexDirection="column" gap={expanded() ? 1 : 0}>
			<box
				flexDirection="row"
				gap={1}
				onMouseUp={(e) => {
					if (isSelectingMouseEvent(e)) return
					toggleExpanded()
				}}
			>
				<text selectable={false} fg={summaryColor()}>
					{expanded() ? "▾" : "▸"}
				</text>
				<For each={summaryParts()}>
					{(part, index) => (
						<>
							<Show when={index() > 0}>
								<text selectable={false} fg={theme.borderSubtle}>·</text>
							</Show>
							<text selectable={false} fg={summaryPartColor(part.tone)}>{part.count}</text>
							<text selectable={false} fg={summaryPartColor(part.tone)}>{part.label}</text>
						</>
					)}
				</For>
			</box>
			<Show when={expanded()}>
				<box flexDirection="column" gap={1} paddingLeft={1}>
					<For each={props.group.entries}>
						{(entry) => (
							<WorkEntryContent
								entry={entry}
								isToolExpanded={props.isToolExpanded}
								toggleToolExpanded={props.toggleToolExpanded}
								isThinkingExpanded={props.isThinkingExpanded}
								toggleThinkingExpanded={props.toggleThinkingExpanded}
								diffWrapMode={props.diffWrapMode}
								concealMarkdown={props.concealMarkdown}
								onEditFile={props.onEditFile}
							/>
						)}
					</For>
				</box>
			</Show>
		</box>
	)
}

function WorkEntryContent(props: {
	entry: TranscriptWorkEntry
	isToolExpanded: (id: string) => boolean
	toggleToolExpanded: (id: string) => void
	isThinkingExpanded: (id: string) => boolean
	toggleThinkingExpanded: (id: string) => void
	diffWrapMode: "word" | "none"
	concealMarkdown?: boolean
	onEditFile?: (path: string, line?: number) => void
}) {
	return (
		<Switch>
			<Match when={props.entry.type === "thinking" && props.entry}>
				{(thinkingItem) => (
					<ThinkingBlockWrapper
						id={thinkingItem().id}
						summary={thinkingItem().summary}
						preview={thinkingItem().preview}
						full={thinkingItem().full}
						isExpanded={props.isThinkingExpanded}
						onToggle={props.toggleThinkingExpanded}
						concealMarkdown={props.concealMarkdown}
					/>
				)}
			</Match>
			<Match when={props.entry.type === "tool" && props.entry}>
				{(toolItem) => (
					<ToolBlockWrapper
						tool={toolItem().tool}
						isExpanded={props.isToolExpanded}
						onToggle={props.toggleToolExpanded}
						diffWrapMode={props.diffWrapMode}
						onEditFile={props.onEditFile}
					/>
				)}
			</Match>
		</Switch>
	)
}

// ----- MessageList Component -----

export interface MessageListProps {
	contentItems: TranscriptContentItem[]
	hiddenBefore?: number
	onExpandOlder?: () => void
	sessionKey: string
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
	const expandedWorkGroupsBySession = new Map<string, Set<string>>()
	const [workGroupExpansionVersion, setWorkGroupExpansionVersion] = createSignal(0)
	const workGroupSet = (): Set<string> => {
		const existing = expandedWorkGroupsBySession.get(props.sessionKey)
		if (existing) return existing
		const next = new Set<string>()
		expandedWorkGroupsBySession.set(props.sessionKey, next)
		return next
	}
	const isWorkExpanded = (id: string) => {
		workGroupExpansionVersion()
		return workGroupSet().has(id)
	}
	const toggleWorkExpanded = (id: string) => {
		const expanded = workGroupSet()
		if (expanded.has(id)) expanded.delete(id)
		else expanded.add(id)
		setWorkGroupExpansionVersion((version) => version + 1)
	}

	return (
		<box flexDirection="column" gap={1} paddingTop={1}>
			<Show when={(props.hiddenBefore ?? 0) > 0}>
				<box
					id="transcript-older-messages"
					paddingLeft={1}
					onMouseUp={(e) => {
						if (isSelectingMouseEvent(e)) return
						props.onExpandOlder?.()
					}}
				>
					<text selectable={false} fg={theme.textMuted}>
						{`… ${props.hiddenBefore ?? 0} older messages hidden (Ctrl+Shift+U)`}
					</text>
				</box>
			</Show>
			<For each={props.contentItems}>
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
						<Match when={item.type === "work" && item}>
							{(workItem) => (
								<TranscriptRow mark={workItem().mark}>
									<WorkGroupContent
										group={workItem()}
										isWorkExpanded={isWorkExpanded}
										toggleWorkExpanded={toggleWorkExpanded}
										isToolExpanded={props.isToolExpanded}
										toggleToolExpanded={props.toggleToolExpanded}
										isThinkingExpanded={props.isThinkingExpanded}
										toggleThinkingExpanded={props.toggleThinkingExpanded}
										diffWrapMode={props.diffWrapMode}
										concealMarkdown={props.concealMarkdown}
										onEditFile={props.onEditFile}
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

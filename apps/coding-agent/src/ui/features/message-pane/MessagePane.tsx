import type { ToolBlock, UIMessage } from "../../../types.js"
import { useKeyboard, type ScrollBoxRenderable } from "@yeshwanthyk/open-tui"
import { createEffect, createMemo, createSignal } from "solid-js"
import {
	MessageList,
	TRANSCRIPT_WINDOW_CHUNK_SIZE,
	buildContentItems,
	createTranscriptContentCache,
	expandedTranscriptWindowSizeForIndex,
	transcriptWindowForItems,
} from "../../../components/MessageList.js"
import { profile } from "../../../profiler.js"

export interface MessagePaneProps {
	messages: UIMessage[]
	toolBlocks: ToolBlock[]
	thinkingVisible: boolean
	diffWrapMode: "word" | "none"
	concealMarkdown: boolean
	isToolExpanded: (id: string) => boolean
	toggleToolExpanded: (id: string) => void
	isThinkingExpanded: (id: string) => boolean
	toggleThinkingExpanded: (id: string) => void
	onEditFile: (filePath: string, line?: number) => void
}

export function MessagePane(props: MessagePaneProps) {
	let scrollbox: ScrollBoxRenderable | undefined
	let activeMarkIndex = -1
	const contentCache = createTranscriptContentCache()
	const [visibleItemCount, setVisibleItemCount] = createSignal(TRANSCRIPT_WINDOW_CHUNK_SIZE)
	const contentItems = createMemo(() =>
		profile("build_content_items", () =>
			buildContentItems(props.messages, props.toolBlocks, props.thinkingVisible, contentCache)
		)
	)
	const markIds = createMemo(() => contentItems().map((item) => item.mark.id))
	const visibleWindow = createMemo(() => transcriptWindowForItems(contentItems(), visibleItemCount()))
	const sessionKey = createMemo(() => {
		const first = props.messages[0]?.id ?? "empty"
		const last = props.messages[props.messages.length - 1]?.id ?? "empty"
		return `${first}:${last}:${props.messages.length}`
	})

	createEffect(() => {
		sessionKey()
		activeMarkIndex = -1
		setVisibleItemCount(TRANSCRIPT_WINDOW_CHUNK_SIZE)
	})

	const expandOlder = () => {
		setVisibleItemCount((count) => Math.min(contentItems().length, count + TRANSCRIPT_WINDOW_CHUNK_SIZE))
	}

	const ensureMarkVisible = (markIndex: number): boolean => {
		const window = visibleWindow()
		if (markIndex >= window.startIndex) return false
		const nextVisibleCount = expandedTranscriptWindowSizeForIndex(contentItems().length, visibleItemCount(), markIndex)
		setVisibleItemCount(nextVisibleCount)
		return true
	}

	const scrollToMark = (direction: "prev" | "next") => {
		const ids = markIds()
		if (!scrollbox || ids.length === 0) return
		if (activeMarkIndex < 0 || activeMarkIndex >= ids.length) {
			activeMarkIndex = direction === "prev" ? ids.length - 1 : 0
		} else {
			activeMarkIndex = direction === "prev"
				? Math.max(0, activeMarkIndex - 1)
				: Math.min(ids.length - 1, activeMarkIndex + 1)
		}
		const markId = ids[activeMarkIndex]
		if (!markId) return
		const expanded = ensureMarkVisible(activeMarkIndex)
		if (expanded) {
			queueMicrotask(() => scrollbox?.scrollChildIntoView(markId))
		} else {
			scrollbox.scrollChildIntoView(markId)
		}
	}

	createEffect(() => {
		const ids = markIds()
		if (activeMarkIndex >= ids.length) activeMarkIndex = ids.length - 1
		setVisibleItemCount((count) => Math.min(Math.max(count, TRANSCRIPT_WINDOW_CHUNK_SIZE), ids.length))
	})

	useKeyboard((e: { name: string; ctrl?: boolean; shift?: boolean; preventDefault?: () => void }) => {
		if (!e.ctrl || !e.shift) return
		if (e.name === "z") {
			scrollToMark("prev")
			e.preventDefault?.()
		} else if (e.name === "x") {
			scrollToMark("next")
			e.preventDefault?.()
		} else if (e.name === "u") {
			expandOlder()
			e.preventDefault?.()
		}
	})

	return (
		<scrollbox
			ref={(ref) => { scrollbox = ref }}
			stickyScroll
			stickyStart="bottom"
			flexGrow={props.messages.length > 0 ? 1 : 0}
			flexShrink={1}
		>
			<MessageList
				contentItems={visibleWindow().items}
				hiddenBefore={visibleWindow().hiddenBefore}
				onExpandOlder={expandOlder}
				sessionKey={sessionKey()}
				diffWrapMode={props.diffWrapMode}
				concealMarkdown={props.concealMarkdown}
				isToolExpanded={props.isToolExpanded}
				toggleToolExpanded={props.toggleToolExpanded}
				isThinkingExpanded={props.isThinkingExpanded}
				toggleThinkingExpanded={props.toggleThinkingExpanded}
				onEditFile={props.onEditFile}
			/>
		</scrollbox>
	)
}

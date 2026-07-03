/**
 * SelectList component - wraps OpenTUI's SelectRenderable
 */

import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { useTheme, type RGBA } from "../context/theme.js"
import { truncateToWidth, visibleWidth } from "../utils/text-width.js"

const TRUNCATION_MARK = "..."

export interface SelectItem {
	value: string
	label: string
	description?: string
}

export interface SelectListTheme {
	selectedBg: RGBA
	selectedFg: RGBA
	text: RGBA
	description: RGBA
	scrollInfo: RGBA
	noMatch: RGBA
}

export interface SelectListProps {
	/** Items to display */
	items: SelectItem[]
	/** Filter string for filtering items */
	filter?: string
	/** Maximum visible items before scrolling */
	maxVisible?: number
	/** Currently selected index (controlled) */
	selectedIndex?: number
	/** Theme overrides */
	theme?: Partial<SelectListTheme>
	/** Called when selection changes */
	onSelectionChange?: (item: SelectItem, index: number) => void
	/** Called when item is selected (Enter pressed) */
	onSelect?: (item: SelectItem) => void
	/** Called when cancelled (Escape pressed) */
	onCancel?: () => void
	/** Available width for rendering */
	width?: number
	/** Ref callback to expose navigation helpers */
	ref?: (ref: SelectListRef) => void
}

export interface SelectListRef {
	moveUp: () => void
	moveDown: () => void
	select: () => void
	cancel: () => void
	getSelectedItem: () => SelectItem | undefined
	getSelectedIndex: () => number
}

export function SelectList(props: SelectListProps) {
	const { theme: globalTheme } = useTheme()

	const [internalIndex, setInternalIndex] = createSignal(0)

	const selectedIndex = () => props.selectedIndex ?? internalIndex()

	const theme = createMemo((): SelectListTheme => ({
		selectedBg: props.theme?.selectedBg ?? globalTheme.selectionBg,
		selectedFg: props.theme?.selectedFg ?? globalTheme.selectionFg,
		text: props.theme?.text ?? globalTheme.text,
		description: props.theme?.description ?? globalTheme.textMuted,
		scrollInfo: props.theme?.scrollInfo ?? globalTheme.textMuted,
		noMatch: props.theme?.noMatch ?? globalTheme.textMuted,
	}))

	const filteredItems = createMemo(() => {
		const filter = props.filter?.toLowerCase() ?? ""
		if (!filter) return props.items
		return props.items.filter((item) => item.value.toLowerCase().includes(filter) || item.label.toLowerCase().includes(filter))
	})

	const clampedIndex = createMemo(() => {
		const items = filteredItems()
		if (items.length === 0) return 0
		return Math.max(0, Math.min(selectedIndex(), items.length - 1))
	})

	createEffect(() => {
		if (props.selectedIndex !== undefined) return
		setInternalIndex(clampedIndex())
	})

	createEffect(() => {
		if (props.selectedIndex !== undefined) return
		const items = filteredItems()
		if (items.length === 0) return
		props.onSelectionChange?.(items[clampedIndex()]!, clampedIndex())
	})

	const setSelection = (nextIndex: number) => {
		const items = filteredItems()
		if (items.length === 0) return
		const next = Math.max(0, Math.min(nextIndex, items.length - 1))
		if (props.selectedIndex === undefined) {
			setInternalIndex(next)
			return
		}
		props.onSelectionChange?.(items[next]!, next)
	}

	const ref: SelectListRef = {
		moveUp: () => setSelection(clampedIndex() - 1),
		moveDown: () => setSelection(clampedIndex() + 1),
		select: () => {
			const item = filteredItems()[clampedIndex()]
			if (item) props.onSelect?.(item)
		},
		cancel: () => props.onCancel?.(),
		getSelectedItem: () => filteredItems()[clampedIndex()],
		getSelectedIndex: () => clampedIndex(),
	}

	createEffect(() => {
		props.ref?.(ref)
	})

	const maxVisible = () => props.maxVisible ?? 5
	const width = () => props.width ?? 80

	const visibleWindow = createMemo(() => {
		const items = filteredItems()
		const max = maxVisible()
		const idx = clampedIndex()

		const startIndex = Math.max(0, Math.min(idx - Math.floor(max / 2), items.length - max))
		const endIndex = Math.min(startIndex + max, items.length)

		return { startIndex, endIndex }
	})

	// Derive reactive values from visibleWindow memo
	const startIndex = () => visibleWindow().startIndex
	const endIndex = () => visibleWindow().endIndex
	const visibleItems = () => filteredItems().slice(startIndex(), endIndex())
	const showScrollInfo = () => startIndex() > 0 || endIndex() < filteredItems().length

	return (
		<Show
			when={filteredItems().length > 0}
			fallback={
				<box>
					<text fg={theme().noMatch}>{"  No matching items"}</text>
				</box>
			}
		>
			<box flexDirection="column">
				<For each={visibleItems()}>
					{(item, localIndex) => {
						const globalIndex = () => startIndex() + localIndex()
						const isSelected = () => globalIndex() === clampedIndex()
						return <SelectListItem item={item} isSelected={isSelected} theme={theme} width={width} />
					}}
				</For>
				<Show when={showScrollInfo()}>
					<text fg={theme().scrollInfo}>
						{"  "}({clampedIndex() + 1}/{filteredItems().length})
					</text>
				</Show>
			</box>
		</Show>
	)
}

function SelectListItem(props: {
	item: SelectItem
	isSelected: () => boolean
	theme: () => SelectListTheme
	width: () => number
}): JSX.Element {
	const prefixWidth = 2
	const row = createMemo(() => {
		const width = props.width()
		const prefix = props.isSelected() ? "> " : "  "
		const value = props.item.label || props.item.value
		const labelWidth = Math.min(32, Math.max(12, width - prefixWidth - 10))
		const label = truncateToWidth(value, labelWidth, TRUNCATION_MARK)
		const labelPad = " ".repeat(Math.max(0, labelWidth - visibleWidth(label)))
		const prefixLabel = prefix + label + labelPad
		const description = props.item.description
		const showDescription = Boolean(description) && width > 50
		const descWidth = showDescription ? Math.max(0, width - prefixWidth - labelWidth - 2) : 0
		const desc = showDescription && description ? truncateToWidth(description, descWidth, TRUNCATION_MARK) : ""
		const line = prefixLabel + (showDescription ? "  " + desc : "")
		const pad = " ".repeat(Math.max(0, width - visibleWidth(line)))
		return { prefixLabel, showDescription, desc, line, paddedLine: line + pad }
	})

	return (
		<Show
			when={props.isSelected()}
			fallback={
				<text>
					<span style={{ fg: props.theme().text }}>{row().prefixLabel}</span>
					<Show when={row().showDescription}>
						<span style={{ fg: props.theme().description }}>{"  " + row().desc}</span>
					</Show>
				</text>
			}
		>
			<text fg={props.theme().selectedFg} bg={props.theme().selectedBg} attributes={TextAttributes.BOLD}>
				{row().paddedLine}
			</text>
		</Show>
	)
}

export const SelectListKeys = {
	isUp: (key: string) => key === "up" || key === "\x1b[A",
	isDown: (key: string) => key === "down" || key === "\x1b[B",
	isEnter: (key: string) => key === "return" || key === "\r",
	isEscape: (key: string) => key === "escape" || key === "\x1b",
}

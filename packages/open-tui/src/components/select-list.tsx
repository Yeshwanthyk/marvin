/**
 * SelectList component - wraps OpenTUI's SelectRenderable
 */

import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { useTheme, type RGBA } from "../context/theme.js"
import { truncateToWidth, visibleWidth } from "../utils/text-width.js"

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

	if (filteredItems().length === 0) {
		return (
			<box>
				<text fg={theme().noMatch}>{"  No matching items"}</text>
			</box>
		)
	}

	const { startIndex, endIndex } = visibleWindow()
	const items = filteredItems()
	const showScrollInfo = startIndex > 0 || endIndex < items.length

	return (
		<box flexDirection="column">
			<For each={items.slice(startIndex, endIndex)}>
				{(item, localIndex) => {
					const globalIndex = () => startIndex + localIndex()
					const isSelected = () => globalIndex() === clampedIndex()
					return <SelectListItem item={item} isSelected={isSelected()} theme={theme()} width={width()} />
				}}
			</For>
			<Show when={showScrollInfo}>
				<text fg={theme().scrollInfo}>
					{"  "}({clampedIndex() + 1}/{items.length})
				</text>
			</Show>
		</box>
	)
}

function SelectListItem(props: { item: SelectItem; isSelected: boolean; theme: SelectListTheme; width: number }): JSX.Element {
	const prefix = props.isSelected ? "→ " : "  "
	const prefixWidth = 2
	const value = props.item.label || props.item.value

	const labelWidth = Math.min(32, Math.max(12, props.width - prefixWidth - 10))
	const label = truncateToWidth(value, labelWidth, "")
	const labelPad = " ".repeat(Math.max(0, labelWidth - visibleWidth(label)))

	const showDescription = Boolean(props.item.description) && props.width > 50
	const descWidth = showDescription ? Math.max(0, props.width - prefixWidth - labelWidth - 2) : 0
	const desc = showDescription ? truncateToWidth(props.item.description!, descWidth, "") : ""

	const line = prefix + label + labelPad + (showDescription ? "  " + desc : "")
	const pad = " ".repeat(Math.max(0, props.width - visibleWidth(line)))

	if (props.isSelected) {
		return (
			<text fg={props.theme.selectedFg} bg={props.theme.selectedBg} attributes={TextAttributes.BOLD}>
				{line + pad}
			</text>
		)
	}

	return (
		<text>
			<span style={{ fg: props.theme.text }}>{prefix + label + labelPad}</span>
			<Show when={showDescription}>
				<span style={{ fg: props.theme.description }}>{"  " + desc}</span>
			</Show>
		</text>
	)
}

export const SelectListKeys = {
	isUp: (key: string) => key === "up" || key === "\x1b[A",
	isDown: (key: string) => key === "down" || key === "\x1b[B",
	isEnter: (key: string) => key === "return" || key === "\r",
	isEscape: (key: string) => key === "escape" || key === "\x1b",
}

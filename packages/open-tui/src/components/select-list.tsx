/**
 * SelectList component - wraps OpenTUI's SelectRenderable
 */

import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { type RGBA, useTheme } from "../context/theme.js"
import { truncateToWidth, visibleWidth } from "../utils/text-width.js"

export interface SelectItem {
	value: string
	label: string
	description?: string
}

export interface SelectListTheme {
	selected: RGBA
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
}

export interface SelectListRef {
	moveUp: () => void
	moveDown: () => void
	select: () => void
	cancel: () => void
	getSelectedItem: () => SelectItem | undefined
	getSelectedIndex: () => number
}

/**
 * SelectList component for displaying a filterable list of options
 *
 * @example
 * ```tsx
 * <SelectList
 *   items={[{ value: 'a', label: 'Option A' }]}
 *   filter={searchText()}
 *   onSelect={(item) => console.log('Selected:', item)}
 * />
 * ```
 */
export function SelectList(props: SelectListProps) {
	const { theme: globalTheme } = useTheme()

	// Internal state for uncontrolled mode
	const [internalIndex] = createSignal(0)

	// Use controlled or uncontrolled index
	// For controlled mode, pass selectedIndex prop
	// For uncontrolled, manage state externally and pass selectedIndex
	const selectedIndex = () => props.selectedIndex ?? internalIndex()

	// Theme with defaults
	const theme = createMemo((): SelectListTheme => ({
		selected: props.theme?.selected ?? globalTheme.primary,
		text: props.theme?.text ?? globalTheme.text,
		description: props.theme?.description ?? globalTheme.textMuted,
		scrollInfo: props.theme?.scrollInfo ?? globalTheme.textMuted,
		noMatch: props.theme?.noMatch ?? globalTheme.textMuted,
	}))

	// Filter items based on filter prop
	const filteredItems = createMemo(() => {
		const filter = props.filter?.toLowerCase() ?? ""
		if (!filter) return props.items
		return props.items.filter((item) =>
			item.value.toLowerCase().includes(filter) ||
			item.label.toLowerCase().includes(filter)
		)
	})

	// Clamp selected index to valid range
	const clampedIndex = createMemo(() => {
		const items = filteredItems()
		if (items.length === 0) return 0
		return Math.max(0, Math.min(selectedIndex(), items.length - 1))
	})

	const maxVisible = () => props.maxVisible ?? 5
	const width = () => props.width ?? 80

	// Calculate visible window
	const visibleWindow = createMemo(() => {
		const items = filteredItems()
		const max = maxVisible()
		const idx = clampedIndex()

		const startIndex = Math.max(0, Math.min(idx - Math.floor(max / 2), items.length - max))
		const endIndex = Math.min(startIndex + max, items.length)

		return { startIndex, endIndex }
	})

	// Navigation functions - exported via SelectListKeys utilities
	// Users can call these by handling keyboard events:
	// if (SelectListKeys.isUp(key)) { /* update selectedIndex */ }

	// No items message
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

					return (
						<SelectListItem
							item={item}
							isSelected={isSelected()}
							theme={theme()}
							width={width()}
						/>
					)
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

function SelectListItem(props: {
	item: SelectItem
	isSelected: boolean
	theme: SelectListTheme
	width: number
}): JSX.Element {
	const { item, isSelected, theme, width } = props
	const prefix = isSelected ? "→ " : "  "
	const prefixWidth = 2
	const displayValue = item.label || item.value

	// Calculate available width for content
	const maxValueWidth = Math.min(30, width - prefixWidth - 4)
	const truncatedValue = truncateToWidth(displayValue, maxValueWidth, "")

	// Calculate description if there's room
	const showDescription = item.description && width > 40
	let descriptionText = ""
	if (showDescription) {
		const spacing = " ".repeat(Math.max(1, 32 - visibleWidth(truncatedValue)))
		const descStart = prefixWidth + visibleWidth(truncatedValue) + spacing.length
		const remainingWidth = width - descStart - 2
		if (remainingWidth > 10) {
			descriptionText = spacing + truncateToWidth(item.description!, remainingWidth, "")
		}
	}

	if (isSelected) {
		return (
			<text fg={theme.selected}>
				{prefix + truncatedValue}
				{descriptionText}
			</text>
		)
	}

	return (
		<text>
			<span style={{ fg: theme.text }}>{prefix + truncatedValue}</span>
			<Show when={descriptionText}>
				<span style={{ fg: theme.description }}>{descriptionText}</span>
			</Show>
		</text>
	)
}

// Export utilities for keyboard handling
export const SelectListKeys = {
	isUp: (key: string) => key === "up" || key === "\x1b[A",
	isDown: (key: string) => key === "down" || key === "\x1b[B",
	isEnter: (key: string) => key === "return" || key === "\r",
	isEscape: (key: string) => key === "escape" || key === "\x1b",
}

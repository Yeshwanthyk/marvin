import type { JSX } from "solid-js"
import { createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Dialog, Input, SelectList, type SelectItem, type SelectListRef } from "@yeshwanthyk/open-tui"

export interface SearchSelectModalProps {
	title: string
	options: string[]
	placeholder?: string
	onSelect: (value: string | undefined) => void
}

const scoreOption = (option: string, query: string): number => {
	const normalized = option.toLowerCase()
	const q = query.toLowerCase().trim()
	if (!q) return 1
	if (normalized.startsWith(q)) return 3
	if (normalized.includes(q)) return 2
	return 0
}

export function SearchSelectModal(props: SearchSelectModalProps): JSX.Element {
	let listRef: SelectListRef | undefined
	const [query, setQuery] = createSignal("")

	const items = createMemo<SelectItem[]>(() =>
		props.options
			.map((option) => ({ option, score: scoreOption(option, query()) }))
			.filter((entry) => entry.score > 0)
			.sort((a, b) => b.score - a.score || a.option.localeCompare(b.option))
			.slice(0, 40)
			.map((entry) => ({ value: entry.option, label: entry.option })),
	)

	useKeyboard((e: { name: string }) => {
		if (e.name === "up") {
			listRef?.moveUp()
		} else if (e.name === "down") {
			listRef?.moveDown()
		} else if (e.name === "return") {
			const item = listRef?.getSelectedItem()
			props.onSelect(item?.value)
		} else if (e.name === "escape") {
			props.onSelect(undefined)
		}
	})

	return (
		<Dialog open={true} title={props.title} closeOnOverlayClick={false}>
			<Input
				value={query()}
				placeholder={props.placeholder}
				focused={true}
				onChange={setQuery}
				onSubmit={() => {
					const item = listRef?.getSelectedItem() ?? items()[0]
					props.onSelect(item?.value)
				}}
				onEscape={() => props.onSelect(undefined)}
			/>
			<box height={1} />
			<SelectList
				items={items()}
				onSelect={(item) => props.onSelect(item.value)}
				onCancel={() => props.onSelect(undefined)}
				maxVisible={10}
				ref={(ref) => { listRef = ref }}
			/>
		</Dialog>
	)
}

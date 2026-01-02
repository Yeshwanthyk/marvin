import { createSignal, type JSX } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Dialog, SelectList, type SelectListRef, type SelectItem } from "@marvin-agents/open-tui"

export interface SelectModalProps {
	title: string
	options: string[]
	onSelect: (value: string | undefined) => void
}

export function SelectModal(props: SelectModalProps): JSX.Element {
	const [selectedIndex, setSelectedIndex] = createSignal(0)
	let listRef: SelectListRef | undefined

	const items: SelectItem[] = props.options.map((opt) => ({
		value: opt,
		label: opt,
	}))

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
			<SelectList
				items={items}
				selectedIndex={selectedIndex()}
				onSelectionChange={(_, index) => setSelectedIndex(index)}
				onSelect={(item) => props.onSelect(item.value)}
				onCancel={() => props.onSelect(undefined)}
				maxVisible={10}
				ref={(ref) => { listRef = ref }}
			/>
			<box height={1} />
			<text>↑/↓ navigate • Enter select • Esc cancel</text>
		</Dialog>
	)
}

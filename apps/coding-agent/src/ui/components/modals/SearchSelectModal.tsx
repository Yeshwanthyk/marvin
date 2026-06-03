import type { JSX } from "solid-js"
import { createMemo, createSignal, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Dialog, Input, SelectList, type SelectItem, type SelectListRef } from "@yeshwanthyk/open-tui"
import { useTheme } from "@yeshwanthyk/open-tui"
import { createSearchSelectItems, type SearchSelectOptionInput } from "./search-select-options.js"

export interface SearchSelectModalProps {
	title: string
	options: SearchSelectOptionInput[]
	placeholder?: string
	onSelect: (value: string | undefined) => void
}

export function SearchSelectModal(props: SearchSelectModalProps): JSX.Element {
	const { theme } = useTheme()
	let listRef: SelectListRef | undefined
	const [query, setQuery] = createSignal("")

	const optionCount = () => props.options.length
	const items = createMemo<SelectItem[]>(() => createSearchSelectItems(props.options, query()))
	const resultText = () => {
		const count = items().length
		const total = optionCount()
		if (query().trim()) return `${count}/${total} matches`
		return `${total} ${total === 1 ? "session" : "sessions"}`
	}

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
		<Dialog open={true} title={props.title} closeOnOverlayClick={false} top="18%" left="18%" width="64%" maxHeight="64%">
			<Input
				value={query()}
				placeholder={props.placeholder}
				focused={true}
				theme={{
					background: theme.backgroundMenu,
					border: theme.borderSubtle,
					borderActive: theme.secondary,
					placeholder: theme.textMuted,
				}}
				onChange={setQuery}
				onSubmit={() => {
					const item = listRef?.getSelectedItem() ?? items()[0]
					props.onSelect(item?.value)
				}}
				onEscape={() => props.onSelect(undefined)}
			/>
			<box height={1} />
			<box flexDirection="row" gap={1}>
				<text fg={theme.secondary}>{resultText()}</text>
				<Show when={query().trim()}>
					<text fg={theme.textMuted}>for "{query().trim()}"</text>
				</Show>
			</box>
			<box height={1} />
			<SelectList
				items={items()}
				onSelect={(item) => props.onSelect(item.value)}
				onCancel={() => props.onSelect(undefined)}
				maxVisible={8}
				width={96}
				theme={{
					selectedBg: theme.backgroundElement,
					selectedFg: theme.text,
					description: theme.textMuted,
					scrollInfo: theme.textMuted,
					noMatch: theme.textMuted,
				}}
				ref={(ref) => { listRef = ref }}
			/>
			<box height={1} />
			<text fg={theme.textMuted}>type to filter | up/down move | enter jump | esc close</text>
		</Dialog>
	)
}

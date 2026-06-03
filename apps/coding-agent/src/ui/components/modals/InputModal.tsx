import { useKeyboard } from "@opentui/solid"
import { Dialog, Input } from "@yeshwanthyk/open-tui"
import { createSignal } from "solid-js"
import type { JSX } from "solid-js"

export interface InputModalProps {
	title: string
	placeholder?: string
	initialValue?: string
	onSubmit: (value: string | undefined) => void
}

export function InputModal(props: InputModalProps): JSX.Element {
	const [value, setValue] = createSignal(props.initialValue ?? "")

	useKeyboard((e: { name: string }) => {
		if (e.name === "escape") {
			props.onSubmit(undefined)
		}
	})

	return (
		<Dialog open={true} title={props.title} closeOnOverlayClick={false}>
			<Input
				value={value()}
				placeholder={props.placeholder}
				focused={true}
				onChange={setValue}
				onSubmit={(value) => props.onSubmit(value || undefined)}
				onEscape={() => props.onSubmit(undefined)}
			/>
			<box height={1} />
			<text>Enter to submit • Esc to cancel</text>
		</Dialog>
	)
}

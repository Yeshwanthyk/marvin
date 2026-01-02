import { useKeyboard } from "@opentui/solid"
import { Dialog, Input } from "@marvin-agents/open-tui"
import type { JSX } from "solid-js"

export interface InputModalProps {
	title: string
	placeholder?: string
	onSubmit: (value: string | undefined) => void
}

export function InputModal(props: InputModalProps): JSX.Element {
	useKeyboard((e: { name: string }) => {
		if (e.name === "escape") {
			props.onSubmit(undefined)
		}
	})

	return (
		<Dialog open={true} title={props.title} closeOnOverlayClick={false}>
			<Input
				placeholder={props.placeholder}
				focused={true}
				onSubmit={(value) => props.onSubmit(value || undefined)}
				onEscape={() => props.onSubmit(undefined)}
			/>
			<box height={1} />
			<text>Enter to submit • Esc to cancel</text>
		</Dialog>
	)
}

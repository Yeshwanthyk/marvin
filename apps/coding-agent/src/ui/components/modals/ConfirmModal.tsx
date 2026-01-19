import { createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Dialog, useTheme } from "@yeshwanthyk/open-tui"
import type { JSX } from "solid-js"

export interface ConfirmModalProps {
	title: string
	message: string
	onConfirm: (confirmed: boolean) => void
}

export function ConfirmModal(props: ConfirmModalProps): JSX.Element {
	const { theme } = useTheme()
	const [selected, setSelected] = createSignal<"yes" | "no">("no")

	useKeyboard((e: { name: string }) => {
		if (e.name === "left" || e.name === "h") {
			setSelected("yes")
		} else if (e.name === "right" || e.name === "l") {
			setSelected("no")
		} else if (e.name === "y") {
			props.onConfirm(true)
		} else if (e.name === "n" || e.name === "escape") {
			props.onConfirm(false)
		} else if (e.name === "return") {
			props.onConfirm(selected() === "yes")
		}
	})

	return (
		<Dialog open={true} title={props.title} closeOnOverlayClick={false}>
			<text fg={theme.text}>{props.message}</text>
			<box height={1} />
			<box flexDirection="row" gap={2}>
				<text
					fg={selected() === "yes" ? theme.selectionFg : theme.text}
					bg={selected() === "yes" ? theme.selectionBg : undefined}
				>
					{" [Y]es "}
				</text>
				<text
					fg={selected() === "no" ? theme.selectionFg : theme.text}
					bg={selected() === "no" ? theme.selectionBg : undefined}
				>
					{" [N]o "}
				</text>
			</box>
			<box height={1} />
			<text fg={theme.textMuted}>←/→ or y/n to select • Enter to confirm • Esc to cancel</text>
		</Dialog>
	)
}

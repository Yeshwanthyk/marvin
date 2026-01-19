import { useKeyboard } from "@opentui/solid"
import { Dialog, Editor, useTheme, type EditorRef } from "@yeshwanthyk/open-tui"
import type { JSX } from "solid-js"

export interface EditorModalProps {
	title: string
	initialText?: string
	onSubmit: (value: string | undefined) => void
}

export function EditorModal(props: EditorModalProps): JSX.Element {
	const { theme } = useTheme()
	let editorRef: EditorRef | undefined

	useKeyboard((e: { name: string; ctrl?: boolean; meta?: boolean }) => {
		if (e.name === "escape") {
			props.onSubmit(undefined)
		} else if (e.name === "s" && (e.ctrl || e.meta)) {
			const text = editorRef?.getText()
			props.onSubmit(text)
		}
	})

	return (
		<Dialog open={true} title={props.title} closeOnOverlayClick={false}>
			<box height="80%" minHeight={10}>
				<Editor
					initialValue={props.initialText}
					focused={true}
					minHeight={10}
					maxHeight={30}
					ref={(ref) => { editorRef = ref }}
				/>
			</box>
			<box height={1} />
			<text fg={theme.textMuted}>Ctrl+S to save • Esc to cancel</text>
		</Dialog>
	)
}

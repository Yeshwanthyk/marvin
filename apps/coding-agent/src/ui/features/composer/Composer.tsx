import { TextareaRenderable, type KeyEvent } from "@opentui/core"
import { Show } from "solid-js"
import { SelectList, type AutocompleteItem, type SelectItem, type Theme } from "@yeshwanthyk/open-tui"

export interface ComposerProps {
	theme: Theme
	isBashMode: () => boolean
	showAutocomplete: () => boolean
	autocompleteItems: () => AutocompleteItem[]
	autocompleteIndex: () => number
	textareaRef: (ref: TextareaRenderable) => void
	onContentChange: () => void
	onSubmit: () => void
	onKeyDown: (event: KeyEvent) => void
	terminalWidth: () => number
}

export function Composer(props: ComposerProps) {
	return (
		<>
			<Show when={props.showAutocomplete() && props.autocompleteItems().length > 0}>
				<box flexDirection="column" borderColor={props.theme.border} maxHeight={15} flexShrink={0}>
					<SelectList
						items={props.autocompleteItems().map((item): SelectItem => ({
							value: item.value,
							label: item.label,
							description: item.description,
						}))}
						selectedIndex={props.autocompleteIndex()}
						maxVisible={12}
						width={Math.max(10, props.terminalWidth() - 2)}
					/>
					<text fg={props.theme.textMuted}>{"   "}↑↓ navigate · Tab select · Esc cancel</text>
				</box>
			</Show>
			<box border={["top"]} borderColor={props.isBashMode() ? props.theme.warning : props.theme.border} paddingTop={1} flexShrink={0}>
				<textarea
					ref={(r: TextareaRenderable) => {
						props.textareaRef(r)
					}}
					placeholder=""
					backgroundColor={props.theme.background}
					focusedBackgroundColor={props.theme.background}
					textColor={props.theme.text}
					focusedTextColor={props.theme.text}
					cursorColor={props.theme.text}
					minHeight={1}
					maxHeight={6}
					keyBindings={[
						{ name: "return", shift: true, action: "newline" as const },
						{ name: "return", ctrl: true, action: "newline" as const },
						{ name: "return", meta: true, action: "newline" as const },
						{ name: "return", action: "submit" as const },
						{ name: "left", action: "move-left" as const },
						{ name: "right", action: "move-right" as const },
						{ name: "backspace", action: "backspace" as const },
						{ name: "delete", action: "delete" as const },
						{ name: "a", ctrl: true, action: "line-home" as const },
						{ name: "e", ctrl: true, action: "line-end" as const },
						{ name: "k", ctrl: true, action: "delete-to-line-end" as const },
						{ name: "u", ctrl: true, action: "delete-to-line-start" as const },
						{ name: "w", ctrl: true, action: "delete-word-backward" as const },
					]}
					onKeyDown={(event) => {
						props.onKeyDown(event)
					}}
					onContentChange={props.onContentChange}
					onSubmit={props.onSubmit}
				/>
			</box>
		</>
	)
}

import { Match, Switch } from "solid-js"
import type { ModalState } from "../../hooks/useModals.js"
import { SelectModal } from "./SelectModal.js"
import { InputModal } from "./InputModal.js"
import { ConfirmModal } from "./ConfirmModal.js"
import { EditorModal } from "./EditorModal.js"
import type { JSX } from "solid-js"

export interface ModalContainerProps {
	modalState: ModalState
	onClose: () => void
}

export function ModalContainer(props: ModalContainerProps): JSX.Element {
	return (
		<Switch>
			<Match when={props.modalState?.type === "select" && props.modalState}>
				{(state) => (
					<SelectModal
						title={state().title}
						options={(state() as { options: string[] }).options}
						onSelect={(value) => {
							(state() as { resolve: (v: string | undefined) => void }).resolve(value)
							props.onClose()
						}}
					/>
				)}
			</Match>
			<Match when={props.modalState?.type === "input" && props.modalState}>
				{(state) => (
					<InputModal
						title={state().title}
						placeholder={(state() as { placeholder?: string }).placeholder}
						onSubmit={(value) => {
							(state() as { resolve: (v: string | undefined) => void }).resolve(value)
							props.onClose()
						}}
					/>
				)}
			</Match>
			<Match when={props.modalState?.type === "confirm" && props.modalState}>
				{(state) => (
					<ConfirmModal
						title={state().title}
						message={(state() as { message: string }).message}
						onConfirm={(confirmed) => {
							(state() as { resolve: (v: boolean) => void }).resolve(confirmed)
							props.onClose()
						}}
					/>
				)}
			</Match>
			<Match when={props.modalState?.type === "editor" && props.modalState}>
				{(state) => (
					<EditorModal
						title={state().title}
						initialText={(state() as { initialText?: string }).initialText}
						onSubmit={(value) => {
							(state() as { resolve: (v: string | undefined) => void }).resolve(value)
							props.onClose()
						}}
					/>
				)}
			</Match>
		</Switch>
	)
}

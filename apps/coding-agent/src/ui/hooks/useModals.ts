import { createSignal } from "solid-js"

export type ModalType = "select" | "input" | "confirm" | "editor" | null

export interface SelectModalState {
	type: "select"
	title: string
	options: string[]
	resolve: (value: string | undefined) => void
}

export interface InputModalState {
	type: "input"
	title: string
	placeholder?: string
	resolve: (value: string | undefined) => void
}

export interface ConfirmModalState {
	type: "confirm"
	title: string
	message: string
	resolve: (confirmed: boolean) => void
}

export interface EditorModalState {
	type: "editor"
	title: string
	initialText?: string
	resolve: (value: string | undefined) => void
}

export type ModalState = SelectModalState | InputModalState | ConfirmModalState | EditorModalState | null

export function useModals() {
	const [modalState, setModalState] = createSignal<ModalState>(null)

	const showSelect = (title: string, options: string[]): Promise<string | undefined> => {
		return new Promise((resolve) => {
			setModalState({ type: "select", title, options, resolve })
		})
	}

	const showInput = (title: string, placeholder?: string): Promise<string | undefined> => {
		return new Promise((resolve) => {
			setModalState({ type: "input", title, placeholder, resolve })
		})
	}

	const showConfirm = (title: string, message: string): Promise<boolean> => {
		return new Promise((resolve) => {
			setModalState({ type: "confirm", title, message, resolve })
		})
	}

	const showEditor = (title: string, initialText?: string): Promise<string | undefined> => {
		return new Promise((resolve) => {
			setModalState({ type: "editor", title, initialText, resolve })
		})
	}

	const closeModal = () => {
		setModalState(null)
	}

	return {
		modalState,
		showSelect,
		showInput,
		showConfirm,
		showEditor,
		closeModal,
	}
}

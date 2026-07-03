import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import type { ScratchpadItem } from "@yeshwanthyk/runtime-effect/scratchpads.js"
import type { createScratchpadStore } from "@yeshwanthyk/runtime-effect/scratchpads.js"
import type { useRuntime } from "../../runtime/context.js"
import type { useWorkspaceSwitch } from "../../runtime/workspace-switch.js"
import type { useModals } from "../hooks/useModals.js"
import type { SearchSelectOption } from "../components/modals/search-select-options.js"

type RuntimeContext = ReturnType<typeof useRuntime>
type ScratchpadStore = ReturnType<typeof createScratchpadStore>
type WorkspaceSwitch = ReturnType<typeof useWorkspaceSwitch>
type Modals = ReturnType<typeof useModals>
type ToastVariant = "info" | "warning" | "success" | "error"

export interface UseScratchpadActionsDeps {
	scratchpadStore: ScratchpadStore
	sessionManager: RuntimeContext["sessionManager"]
	workspaceSwitch: WorkspaceSwitch
	modals: Modals
	getEditorText: () => string
	setEditorText: (text: string) => void
	showToast: (title: string, message: string, variant?: ToastVariant) => void
	startFreshSession: (title?: string) => void
	submitPrompt: (text: string, mode?: PromptDeliveryMode) => Promise<void>
	markScratchpadTriggered: (id: string | undefined) => void
	preserveStickyLaneMode: () => boolean
}

export interface ScratchpadActions {
	scratchpads: () => ScratchpadItem[]
	pickScratchpad: (title: string) => Promise<ScratchpadItem | null>
	saveScratchpadBody: (body: string, options?: { title?: string }) => ScratchpadItem | null
	captureScratchpad: () => void
	saveCurrentScratchpad: () => void
	openScratchpad: (id: string) => void
	openScratchpadPicker: () => void
	startScratchpad: (id: string) => Promise<void>
	startScratchpadPicker: () => void
}

const scratchpadSearchOption = (item: ScratchpadItem): SearchSelectOption => ({
	value: item.id,
	label: item.title,
	description: item.bodyPreview || item.cwd,
	keywords: `${item.title} ${item.cwd} ${item.bodyPreview} ${item.tags.join(" ")} scratch scratchpad note`,
})

const titleFromScratchpadBody = (body: string): string => {
	const words = body.replace(/^#+\s*/g, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, 4)
	return words.join(" ").slice(0, 80) || "scratchpad note"
}

export const useScratchpadActions = ({
	scratchpadStore,
	sessionManager,
	workspaceSwitch,
	modals,
	getEditorText,
	setEditorText,
	showToast,
	startFreshSession,
	submitPrompt,
	markScratchpadTriggered,
	preserveStickyLaneMode,
}: UseScratchpadActionsDeps): ScratchpadActions => {
	const scratchpads = (): ScratchpadItem[] => scratchpadStore.list()

	const pickScratchpad = async (title: string): Promise<ScratchpadItem | null> => {
		const items = scratchpads()
		if (items.length === 0) {
			showToast("No scratchpads", "Create one with Open scratchpad first", "warning")
			return null
		}
		const selected = await modals.showSearchSelect(title, items.map(scratchpadSearchOption), "scratchpad or note")
		return selected ? items.find((item) => item.id === selected) ?? null : null
	}

	const saveScratchpadBody = (body: string, options?: { title?: string }) => {
		const trimmed = body.trim()
		if (!trimmed) {
			showToast("Nothing to save", "Scratchpad is empty", "warning")
			return null
		}
		const item = scratchpadStore.add({
			cwd: sessionManager.projectCwd,
			title: options?.title ?? titleFromScratchpadBody(trimmed),
			body: trimmed,
			source: { kind: "tui", ...(sessionManager.sessionId ? { sessionId: sessionManager.sessionId } : {}) },
		})
		showToast("Scratchpad saved", item.bodyPath, "success")
		return item
	}

	const captureScratchpad = () => {
		void (async () => {
			const initialText = getEditorText()
			const body = await modals.showEditor("Scratchpad", initialText)
			if (body === undefined) return
			try {
				saveScratchpadBody(body)
			} catch (error) {
				showToast("Scratchpad failed", error instanceof Error ? error.message : String(error), "error")
			}
		})()
	}

	const saveCurrentScratchpad = () => {
		void (async () => {
			const body = getEditorText().trim()
			try {
				saveScratchpadBody(body)
			} catch (error) {
				showToast("Scratchpad failed", error instanceof Error ? error.message : String(error), "error")
			}
		})()
	}

	const openScratchpad = (id: string) => {
		try {
			const { item, body } = scratchpadStore.read(id)
			setEditorText(body)
			showToast("Scratchpad loaded", item.title, "success")
		} catch (error) {
			showToast("Scratchpad failed", error instanceof Error ? error.message : String(error), "error")
		}
	}

	const openScratchpadPicker = () => {
		captureScratchpad()
	}

	const startScratchpad = async (id: string): Promise<void> => {
		let entry: { item: ScratchpadItem; body: string }
		try {
			entry = scratchpadStore.read(id)
		} catch (error) {
			showToast("Scratchpad failed", error instanceof Error ? error.message : String(error), "error")
			return
		}

		if (entry.item.cwd === sessionManager.projectCwd) {
			startFreshSession(entry.item.title)
			await submitPrompt(entry.body, "followUp")
			setTimeout(() => markScratchpadTriggered(entry.item.id), 250)
			return
		}

		const result = await workspaceSwitch.switchTo({
			cwd: entry.item.cwd,
			fresh: true,
			initialSessionTitle: entry.item.title,
			initialPrompt: entry.body,
			initialScratchpadId: entry.item.id,
			preserveLaneMode: preserveStickyLaneMode(),
		})
		if (!result.switched) {
			showToast("Scratchpad failed", `Could not switch to ${entry.item.cwd}`, "error")
		}
	}

	const startScratchpadPicker = () => {
		void (async () => {
			const item = await pickScratchpad("Start scratchpad")
			if (!item) return
			await startScratchpad(item.id)
		})()
	}

	return {
		scratchpads,
		pickScratchpad,
		saveScratchpadBody,
		captureScratchpad,
		saveCurrentScratchpad,
		openScratchpad,
		openScratchpadPicker,
		startScratchpad,
		startScratchpadPicker,
	}
}

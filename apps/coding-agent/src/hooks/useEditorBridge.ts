import { createPatch } from "diff"
import type { CliRenderer } from "@marvin-agents/open-tui"
import { openExternalEditor, openFileInEditor } from "../editor.js"
import type { EditorConfig } from "../config.js"

interface ToastOptions {
	title: string
	message?: string
	variant?: "success" | "warning" | "error" | "info"
}

interface EditorBridgeOptions {
	editor?: EditorConfig
	renderer: CliRenderer
	pushToast: (toast: ToastOptions, ttlMs?: number) => void
	isResponding: () => boolean
	onSubmit: (text: string) => void
}

const DEFAULT_EDITOR: EditorConfig = { command: "nvim", args: [] }

export function useEditorBridge(options: EditorBridgeOptions) {
	const getEditor = (): EditorConfig => options.editor ?? DEFAULT_EDITOR

	const openBuffer = async (initialValue = "") => {
		try {
			return await openExternalEditor({
				editor: getEditor(),
				cwd: process.cwd(),
				renderer: options.renderer,
				initialValue,
			})
		} catch (err) {
			options.pushToast({
				title: "Editor failed",
				message: err instanceof Error ? err.message : String(err),
				variant: "error",
			}, 4000)
			return undefined
		}
	}

	const editFile = async (filePath: string, line?: number) => {
		if (options.isResponding()) return

		let beforeContent: string
		try {
			beforeContent = await Bun.file(filePath).text()
		} catch (err) {
			options.pushToast({
				title: `Cannot read file: ${filePath}`,
				message: err instanceof Error ? err.message : String(err),
				variant: "error",
			}, 3000)
			return
		}

		try {
			await openFileInEditor({
				editor: getEditor(),
				filePath,
				line,
				cwd: process.cwd(),
				renderer: options.renderer,
			})
		} catch (err) {
			options.pushToast({
				title: err instanceof Error ? err.message : String(err),
				variant: "error",
			}, 3000)
			return
		}

		let afterContent: string
		try {
			afterContent = await Bun.file(filePath).text()
		} catch (err) {
			options.pushToast({
				title: `Cannot read file after edit: ${filePath}`,
				message: err instanceof Error ? err.message : String(err),
				variant: "error",
			}, 3000)
			return
		}

		if (beforeContent === afterContent) {
			return
		}

		const diff = createPatch(filePath, beforeContent, afterContent)
		const lines = diff.split("\n")
		const hunkStart = lines.findIndex((line) => line.startsWith("@@"))
		const diffBody = hunkStart >= 0 ? lines.slice(hunkStart).join("\n") : diff

		const message = `Modified ${filePath}:\n${diffBody}`
		options.onSubmit(message)
		options.pushToast({ title: "Edit recorded", variant: "success" }, 1500)
	}

	return { openBuffer, editFile }
}

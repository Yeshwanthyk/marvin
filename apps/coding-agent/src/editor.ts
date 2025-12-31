import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { spawn } from "node:child_process"
import type { CliRenderer } from "@marvin-agents/open-tui"
import type { EditorConfig } from "./config.js"

const CWD_PLACEHOLDER = "{cwd}"

export const buildEditorInvocation = (
	editor: EditorConfig,
	cwd: string,
	options?: { appendCwd?: boolean },
): { command: string; args: string[] } => {
	const usesCwd = editor.command.includes(CWD_PLACEHOLDER) || editor.args.some((arg) => arg.includes(CWD_PLACEHOLDER))
	const command = editor.command.replaceAll(CWD_PLACEHOLDER, cwd)
	const args = editor.args.map((arg) => arg.replaceAll(CWD_PLACEHOLDER, cwd))
	if (options?.appendCwd !== false && !usesCwd) args.push(cwd)
	return { command, args }
}

const runEditor = async (command: string, args: string[], cwd: string): Promise<void> => {
	await new Promise<void>((resolve, reject) => {
		const proc = spawn(command, args, { cwd, stdio: "inherit" })
		proc.once("error", (err) => reject(err))
		proc.once("exit", () => resolve())
	})
}

export const openExternalEditor = async (opts: {
	editor: EditorConfig
	cwd: string
	renderer: CliRenderer
	initialValue: string
}): Promise<string | undefined> => {
	const { command, args } = buildEditorInvocation(opts.editor, opts.cwd, { appendCwd: false })
	const dir = await mkdtemp(path.join(tmpdir(), "marvin-editor-"))
	const filePath = path.join(dir, "prompt.md")
	let suspended = false

	try {
		await writeFile(filePath, opts.initialValue, "utf8")
		opts.renderer.suspend()
		suspended = true
		opts.renderer.currentRenderBuffer.clear()
		await runEditor(command, [...args, filePath], opts.cwd)
		const content = await readFile(filePath, "utf8")
		return content.length > 0 ? content : undefined
	} finally {
		if (suspended) {
			opts.renderer.currentRenderBuffer.clear()
			opts.renderer.resume()
			opts.renderer.requestRender()
		}
		await rm(dir, { recursive: true, force: true })
	}
}

/**
 * Open an existing file in the user's editor.
 * Unlike openExternalEditor, this opens the file directly without creating a temp copy.
 */
export const openFileInEditor = async (opts: {
	editor: EditorConfig
	filePath: string
	cwd: string
	renderer: CliRenderer
}): Promise<void> => {
	const { command, args } = buildEditorInvocation(opts.editor, opts.cwd, { appendCwd: false })

	opts.renderer.suspend()
	opts.renderer.currentRenderBuffer.clear()

	try {
		await runEditor(command, [...args, opts.filePath], opts.cwd)
	} finally {
		opts.renderer.currentRenderBuffer.clear()
		opts.renderer.resume()
		opts.renderer.requestRender()
	}
}

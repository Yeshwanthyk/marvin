import { buildEditorInvocation } from "../../../editor.js"
import { defaultLaunchEditor } from "../helpers.js"
import type { CommandDefinition } from "../types.js"

export const editorCommand: CommandDefinition = {
	name: "editor",
	execute: async (_args, ctx) => {
		if (ctx.openEditor) {
			await ctx.openEditor()
			return true
		}

		const editor = ctx.editor ?? { command: "nvim", args: [] }
		const { command, args } = buildEditorInvocation(editor, ctx.cwd, { appendCwd: true })
		const launch = ctx.launchEditor ?? defaultLaunchEditor
		launch(command, args, ctx.cwd, (error) => {
			ctx.setMessages((prev) => [
				...prev,
				{ id: crypto.randomUUID(), role: "assistant" as const, content: `Failed to launch editor: ${error.message}` },
			])
		})
		return true
	},
}

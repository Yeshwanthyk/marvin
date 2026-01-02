import { THEME_NAMES } from "../../../theme-names.js"
import { addSystemMessage } from "../helpers.js"
import type { CommandDefinition } from "../types.js"

export const themeCommand: CommandDefinition = {
	name: "theme",
	execute: (args, ctx) => {
		const themeName = args.trim()

		if (!themeName) {
			addSystemMessage(ctx, `Available themes: ${THEME_NAMES.join(", ")}`)
			return true
		}

		if (!THEME_NAMES.includes(themeName)) {
			addSystemMessage(ctx, `Unknown theme "${themeName}". Available: ${THEME_NAMES.join(", ")}`)
			return true
		}

		ctx.setTheme?.(themeName)
		return true
	},
}

import type { CommandContext } from "../../../commands.js"
import { handleSlashCommand } from "../../../commands.js"
import { tryExpandCustomCommand, type CustomCommand } from "../../../custom-commands.js"

export interface SlashCommandBridge {
	commandContext: CommandContext
	customCommands: Map<string, CustomCommand>
	builtInCommandNames: Set<string>
	onExpand: (expanded: string) => void | Promise<void>
}

/**
 * Handles slash command processing, returning true when the command is consumed.
 * Custom commands can expand into new prompts via the provided callback.
 */
export const handleSlashInput = async (input: string, bridge: SlashCommandBridge): Promise<boolean> => {
	const trimmed = input.trim()

	const handled = handleSlashCommand(trimmed, bridge.commandContext)
	if (handled instanceof Promise ? await handled : handled) {
		return true
	}

	const expanded = tryExpandCustomCommand(trimmed, bridge.builtInCommandNames, bridge.customCommands)
	if (expanded !== null) {
		await bridge.onExpand(expanded)
		return true
	}

	return false
}

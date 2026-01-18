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
 * Checks hook commands first, then built-in commands, then custom commands.
 */
export const handleSlashInput = async (input: string, bridge: SlashCommandBridge): Promise<boolean> => {
	const trimmed = input.trim()

	// Parse command name and args
	const match = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
	if (!match) return false

	const cmdName = match[1]!
	const cmdArgs = match[2] ?? ""

	// Check hook-registered commands first
	const { hookRunner } = bridge.commandContext
	if (hookRunner) {
		const hookCmd = hookRunner.getCommand(cmdName)
		if (hookCmd) {
			try {
				await hookCmd.handler(cmdArgs, hookRunner.getContext())
			} catch (err) {
				// Hook command errors are logged but don't crash
				console.error(`Hook command error [${cmdName}]:`, err)
			}
			return true
		}
	}

	// Then check built-in commands
	const handled = handleSlashCommand(trimmed, bridge.commandContext)
	if (handled instanceof Promise ? await handled : handled) {
		return true
	}

	// Finally check custom commands
	const expanded = tryExpandCustomCommand(trimmed, bridge.builtInCommandNames, bridge.customCommands)
	if (expanded !== null) {
		await bridge.onExpand(expanded)
		return true
	}

	return false
}

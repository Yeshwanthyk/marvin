/**
 * Custom slash command loader
 *
 * Loads markdown templates from ~/.config/marvin/commands/*.md
 * Commands are expanded with $ARGUMENTS placeholder or appended args.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface CustomCommand {
	name: string
	description: string
	template: string
}

/** Valid command name: alphanumeric, starting with letter/digit, allowing _ and - */
const VALID_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/**
 * Load custom commands from a config directory.
 * @param configDir - Base config directory (e.g., ~/.config/marvin)
 * @returns Map of command name -> CustomCommand
 */
export function loadCustomCommands(configDir: string): Map<string, CustomCommand> {
	const commands = new Map<string, CustomCommand>()
	const commandsDir = join(configDir, "commands")

	if (!existsSync(commandsDir)) {
		return commands
	}

	let entries: string[]
	try {
		entries = readdirSync(commandsDir)
	} catch {
		return commands
	}

	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue

		const name = entry.slice(0, -3) // Remove .md extension
		if (!VALID_NAME_PATTERN.test(name)) continue

		const filePath = join(commandsDir, entry)
		let content: string
		try {
			content = readFileSync(filePath, "utf-8")
		} catch {
			continue
		}

		// Extract description from first non-empty line, truncated to 60 chars
		const lines = content.split("\n")
		let description = ""
		for (const line of lines) {
			const trimmed = line.trim()
			if (trimmed) {
				description = trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed
				break
			}
		}

		commands.set(name, {
			name,
			description,
			template: content,
		})
	}

	return commands
}

/**
 * Expand a custom command template with arguments.
 *
 * - Replaces $ARGUMENTS with the raw args string
 * - If no $ARGUMENTS placeholder and args exist, appends args after two newlines
 *
 * @param template - The command template
 * @param args - Raw argument string (everything after the command name)
 * @returns Expanded prompt text
 */
export function expandCommand(template: string, args: string): string {
	const trimmedArgs = args.trim()

	if (template.includes("$ARGUMENTS")) {
		return template.replace(/\$ARGUMENTS/g, trimmedArgs)
	}

	if (trimmedArgs) {
		return `${template}\n\n${trimmedArgs}`
	}

	return template
}

/**
 * Try to expand a slash command input.
 *
 * @param input - Raw input starting with /
 * @param builtInNames - Set of built-in command names (to avoid shadowing)
 * @param customCommands - Map of custom commands
 * @returns Expanded text if matched, or null if not a custom command
 */
export function tryExpandCustomCommand(
	input: string,
	builtInNames: Set<string>,
	customCommands: Map<string, CustomCommand>
): string | null {
	const trimmed = input.trim()
	if (!trimmed.startsWith("/")) return null

	// Parse command name and args
	const withoutSlash = trimmed.slice(1)
	const spaceIdx = withoutSlash.indexOf(" ")
	const commandName = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)
	const args = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1)

	// Built-ins take precedence (no override in v1)
	if (builtInNames.has(commandName)) return null

	const cmd = customCommands.get(commandName)
	if (!cmd) return null

	return expandCommand(cmd.template, args)
}

/**
 * Custom slash command loader
 *
 * Loads markdown templates from ~/.config/marvin/commands/*.md
 * Commands are expanded with $ARGUMENTS placeholder or appended args.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import type { ValidationIssue } from "./schema.js"
import { validateCustomCommand, issueFromError } from "./validation.js"
import { ConfigTag } from "../config.js"

export interface CustomCommand {
	name: string
	description: string
	template: string
}

/** Valid command name: alphanumeric, starting with letter/digit, allowing _ and - */
const VALID_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

const createInvalidNameIssue = (path: string, message: string): ValidationIssue => ({
	kind: "command",
	severity: "error",
	path,
	message,
})

export interface CustomCommandLoadResult {
	commands: Map<string, CustomCommand>
	issues: ValidationIssue[]
}

/**
 * Load custom commands from a config directory.
 * @param configDir - Base config directory (e.g., ~/.config/marvin)
 */
export function loadCustomCommands(configDir: string): CustomCommandLoadResult {
	const commands = new Map<string, CustomCommand>()
	const issues: ValidationIssue[] = []
	const commandsDir = join(configDir, "commands")

	if (!existsSync(commandsDir)) {
		return { commands, issues }
	}

	let entries: string[]
	try {
		entries = readdirSync(commandsDir)
	} catch (error) {
		issues.push(issueFromError("command", commandsDir, error))
		return { commands, issues }
	}

	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue

		const name = entry.slice(0, -3) // Remove .md extension
		const filePath = join(commandsDir, entry)
		if (!VALID_NAME_PATTERN.test(name)) {
			issues.push(
				createInvalidNameIssue(filePath, `Invalid command name "${name}". Use letters, numbers, _ or -.`),
			)
			continue
		}

		let content: string
		try {
			content = readFileSync(filePath, "utf-8")
		} catch (error) {
			issues.push(issueFromError("command", filePath, error))
			continue
		}

		// Extract description from first non-empty line, truncated to 60 chars
		const lines = content.split("\n")
		let description = `/${name}`
		for (const line of lines) {
			const trimmed = line.trim()
			if (trimmed) {
				description = trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed
				break
			}
		}

		const manifest = {
			name,
			description,
			template: content,
		}

		issues.push(...validateCustomCommand(manifest, filePath))

		commands.set(name, manifest)
	}

	return { commands, issues }
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

export interface CustomCommandService extends CustomCommandLoadResult {}

export const CustomCommandTag = Context.GenericTag<CustomCommandService>("runtime-effect/CustomCommandService")

export interface CustomCommandLayerOptions {
	configDir?: string
}

export const CustomCommandLayer = (options?: CustomCommandLayerOptions) =>
	Layer.effect(
		CustomCommandTag,
		Effect.gen(function* () {
			const configDir =
				options?.configDir ??
				(yield* ConfigTag).config.configDir

			return yield* Effect.sync(() => loadCustomCommands(configDir))
		}),
	)

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

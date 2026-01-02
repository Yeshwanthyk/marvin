import { builtinCommands } from "@domain/commands/builtin/index.js"
import { CommandRegistry } from "@domain/commands/registry.js"
import { resolveModel, resolveProvider } from "@domain/commands/helpers.js"
import { THINKING_LEVELS, type CommandContext } from "@domain/commands/types.js"
import type { CommandDefinition } from "@domain/commands/types.js"

const registry = new CommandRegistry()
for (const command of builtinCommands) {
	registry.register(command)
}

export const commandRegistry = registry

export const registerCommand = (definition: CommandDefinition): void => {
	registry.register(definition)
}

export const handleSlashCommand = (line: string, ctx: CommandContext) => {
	return registry.execute(line, ctx)
}

export { THINKING_LEVELS, resolveProvider, resolveModel, CommandRegistry }
export type { CommandContext, CommandDefinition }

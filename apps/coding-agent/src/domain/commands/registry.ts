import type { CommandContext, CommandDefinition } from "./types.js"

const normalizeName = (value: string): string => value.trim().toLowerCase()

export class CommandRegistry {
	private readonly definitions = new Map<string, CommandDefinition>()
	private readonly lookup = new Map<string, CommandDefinition>()

	register(definition: CommandDefinition): void {
		const canonical = normalizeName(definition.name)
		this.definitions.set(canonical, definition)
		this.lookup.set(canonical, definition)
		for (const alias of definition.aliases ?? []) {
			const aliasKey = normalizeName(alias)
			this.lookup.set(aliasKey, definition)
		}
	}

	get(name: string): CommandDefinition | undefined {
		return this.lookup.get(normalizeName(name))
	}

	list(): CommandDefinition[] {
		return Array.from(this.definitions.values())
	}

	async execute(input: string, ctx: CommandContext): Promise<boolean> {
		const trimmed = input.trim()
		if (!trimmed.startsWith("/")) return false

		const withoutSlash = trimmed.slice(1)
		const whitespaceMatch = withoutSlash.match(/\s/)
		const spaceIdx = whitespaceMatch?.index ?? -1
		const commandName = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)
		const args = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1)
		const command = this.get(commandName)
		if (!command) return false

		const handled = command.execute(args, ctx)
		return handled instanceof Promise ? await handled : handled
	}
}

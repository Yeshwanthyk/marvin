import { spawn } from "node:child_process"
import type { Api, Model, KnownProvider } from "@yeshwanthyk/ai"
import { getModels, getProviders, resolveProviderAlias } from "@yeshwanthyk/ai"
import type { CommandContext } from "./types.js"

export const resolveProvider = (raw: string): KnownProvider | undefined => {
	const trimmed = raw.trim()
	if (!trimmed) return undefined
	const resolved = resolveProviderAlias(trimmed)
	const providers = getProviders()
	return providers.includes(resolved as KnownProvider) ? (resolved as KnownProvider) : undefined
}

export const resolveModel = (provider: KnownProvider, raw: string): Model<Api> | undefined => {
	const modelId = raw.trim()
	if (!modelId) return undefined
	return getModels(provider).find((m) => m.id === modelId) as Model<Api> | undefined
}

export const addSystemMessage = (ctx: CommandContext, content: string): void => {
	ctx.setMessages((prev) => [
		...prev,
		{ id: crypto.randomUUID(), role: "assistant" as const, content },
	])
}

export const defaultLaunchEditor = (
	command: string,
	args: string[],
	cwd: string,
	onError: (error: Error) => void,
): void => {
	try {
		const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" })
		child.once("error", (err) => {
			onError(err instanceof Error ? err : new Error(String(err)))
		})
		child.unref()
	} catch (err) {
		onError(err instanceof Error ? err : new Error(String(err)))
	}
}

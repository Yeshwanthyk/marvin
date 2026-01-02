/**
 * Hook loader - discovers and loads TypeScript hook modules.
 *
 * Hooks are loaded from ~/.config/marvin/hooks/*.ts (non-recursive).
 * Uses Bun's native import() which handles TypeScript directly.
 */

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { HookAPI, HookEvent, HookEventType, HookFactory, HookHandler, HookMessage, HookMessageRenderer, RegisteredCommand, RegisteredTool } from "./types.js"
import type { ValidationIssue } from "@ext/schema.js"
import { validateHookDescriptor, issueFromError } from "@ext/validation.js"

/** Generic handler function type for internal storage */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerFn = (event: any, ctx: any) => Promise<unknown> | unknown

/** Send handler type for marvin.send() */
export type SendHandler = (text: string) => void

/** Send message handler type for marvin.sendMessage() */
export type SendMessageHandler = <T = unknown>(
	message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
	triggerTurn?: boolean,
) => void

/** Append entry handler type for marvin.appendEntry() */
export type AppendEntryHandler = <T = unknown>(customType: string, data?: T) => void

/** Registered handlers for a loaded hook */
export interface LoadedHook {
	/** Original file path */
	path: string
	/** Map of event type to handler functions */
	handlers: Map<HookEventType, HandlerFn[]>
	/** Map of custom type to message renderer */
	messageRenderers: Map<string, HookMessageRenderer>
	/** Map of command name to registered command */
	commands: Map<string, RegisteredCommand>
	/** Map of tool name to registered tool */
	tools: Map<string, RegisteredTool>
	/** Set the send handler for this hook's marvin.send() */
	setSendHandler: (handler: SendHandler) => void
	/** Set the sendMessage handler for this hook's marvin.sendMessage() */
	setSendMessageHandler: (handler: SendMessageHandler) => void
	/** Set the appendEntry handler for this hook's marvin.appendEntry() */
	setAppendEntryHandler: (handler: AppendEntryHandler) => void
}

/** Result of loading hooks */
export interface LoadHooksResult {
	hooks: LoadedHook[]
	issues: ValidationIssue[]
}

/**
 * Create a HookAPI instance that collects handlers.
 * Returns the API and functions to set handlers later.
 */
function createHookAPI(handlers: Map<HookEventType, HandlerFn[]>): {
	api: HookAPI
	messageRenderers: Map<string, HookMessageRenderer>
	commands: Map<string, RegisteredCommand>
	tools: Map<string, RegisteredTool>
	setSendHandler: (handler: SendHandler) => void
	setSendMessageHandler: (handler: SendMessageHandler) => void
	setAppendEntryHandler: (handler: AppendEntryHandler) => void
} {
	let sendHandler: SendHandler = () => {}
	let sendMessageHandler: SendMessageHandler = () => {}
	let appendEntryHandler: AppendEntryHandler = () => {}
	const messageRenderers = new Map<string, HookMessageRenderer>()
	const commands = new Map<string, RegisteredCommand>()
	const tools = new Map<string, RegisteredTool>()

	const api: HookAPI = {
		on(event, handler): void {
			const list = handlers.get(event) ?? []
			list.push(handler)
			handlers.set(event, list)
		},
		send(text: string): void {
			sendHandler(text)
		},
		sendMessage(message, triggerTurn): void {
			sendMessageHandler(message, triggerTurn)
		},
		appendEntry(customType, data): void {
			appendEntryHandler(customType, data)
		},
		registerMessageRenderer(customType, renderer): void {
			messageRenderers.set(customType, renderer as HookMessageRenderer)
		},
		registerCommand(name, options): void {
			commands.set(name, { name, ...options })
		},
		registerTool(tool): void {
			tools.set(tool.name, tool)
		},
	}

	return {
		api,
		messageRenderers,
		commands,
		tools,
		setSendHandler: (handler) => { sendHandler = handler },
		setSendMessageHandler: (handler) => { sendMessageHandler = handler },
		setAppendEntryHandler: (handler) => { appendEntryHandler = handler },
	}
}

/**
 * Load a single hook module.
 */
async function loadHook(hookPath: string): Promise<{ hook: LoadedHook | null; error: string | null }> {
	try {
		// Use file URL for import - Bun handles TS natively
		const fileUrl = pathToFileURL(hookPath).href
		const module = await import(fileUrl)
		const factory = module.default as HookFactory

		if (typeof factory !== "function") {
			return { hook: null, error: "Hook must export a default function" }
		}

		// Create handlers map and API
		const handlers = new Map<HookEventType, HandlerFn[]>()
		const {
			api,
			messageRenderers,
			commands,
			tools,
			setSendHandler,
			setSendMessageHandler,
			setAppendEntryHandler,
		} = createHookAPI(handlers)

		// Call factory to register handlers
		await factory(api)

		return {
			hook: {
				path: hookPath,
				handlers,
				messageRenderers,
				commands,
				tools,
				setSendHandler,
				setSendMessageHandler,
				setAppendEntryHandler,
			},
			error: null,
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return { hook: null, error: `Failed to load hook: ${message}` }
	}
}

/**
 * Discover hook files from a directory.
 * Returns all .ts files in the directory (non-recursive).
 */
function discoverHooksInDir(dir: string): string[] {
	if (!existsSync(dir)) {
		return []
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true })
		return entries
			.filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith(".ts"))
			.map((e) => join(dir, e.name))
	} catch {
		return []
	}
}

/**
 * Discover and load hooks from the config directory.
 * Loads from ~/.config/marvin/hooks/*.ts
 *
 * @param configDir - Base config directory (e.g., ~/.config/marvin)
 */
export async function loadHooks(configDir: string): Promise<LoadHooksResult> {
	const hooks: LoadedHook[] = []
	const issues: ValidationIssue[] = []

	const hooksDir = join(configDir, "hooks")
	const paths = discoverHooksInDir(hooksDir)

	for (const hookPath of paths) {
		const { hook, error } = await loadHook(hookPath)

		if (error) {
			issues.push(issueFromError("hook", hookPath, error))
			continue
		}

		if (hook) {
			hooks.push(hook)
			issues.push(
				...validateHookDescriptor({
					path: hook.path,
					events: Array.from(hook.handlers.keys()),
				}),
			)
		}
	}

	return { hooks, issues }
}

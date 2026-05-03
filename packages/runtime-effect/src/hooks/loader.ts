/**
 * Hook loader - discovers and loads TypeScript hook modules.
 *
 * Hooks are loaded from ~/.config/marvin/hooks/*.ts (non-recursive).
 * Uses Bun's native import() which handles TypeScript directly.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type {
	HookAPI,
	HookEventType,
	HookFactory,
	HookMessage,
	HookMessageRenderer,
	RegisteredCommand,
	RegisteredTool,
} from "./types.js"
import type { ValidationIssue } from "../extensibility/schema.js"
import { validateHookDescriptor, issueFromError } from "../extensibility/validation.js"
import type { PromptDeliveryMode } from "../session/prompt-queue.js"

/** Generic handler function type for internal storage */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerFn = (event: any, ctx: any) => Promise<unknown> | unknown

/** Send handler type for marvin.send() */
export type SendHandler = (text: string) => void

/** Send message handler type for marvin.sendMessage() */
export type SendMessageHandler = <T = unknown>(
	message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
	triggerTurn?: boolean | { triggerTurn?: boolean; deliverAs?: PromptDeliveryMode },
) => void

export type SendUserMessageHandler = (text: string, options?: { deliverAs?: PromptDeliveryMode }) => Promise<void> | void
export type DeliveryHandler = (text: string) => Promise<void> | void
export type IsIdleHandler = () => boolean

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
	setSendUserMessageHandler: (handler: SendUserMessageHandler) => void
	setSteerHandler: (handler: DeliveryHandler) => void
	setFollowUpHandler: (handler: DeliveryHandler) => void
	setIsIdleHandler: (handler: IsIdleHandler) => void
	/** Set the appendEntry handler for this hook's marvin.appendEntry() */
	setAppendEntryHandler: (handler: AppendEntryHandler) => void
}

/** Result of loading hooks */
export interface LoadHooksResult {
	hooks: LoadedHook[]
	issues: ValidationIssue[]
}

export interface LoadHooksOptions {
	cwd?: string
	extensionPaths?: string[]
	extensionsEnabled?: boolean
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
	setSendUserMessageHandler: (handler: SendUserMessageHandler) => void
	setSteerHandler: (handler: DeliveryHandler) => void
	setFollowUpHandler: (handler: DeliveryHandler) => void
	setIsIdleHandler: (handler: IsIdleHandler) => void
	setAppendEntryHandler: (handler: AppendEntryHandler) => void
} {
	let sendHandler: SendHandler = () => {}
	let sendMessageHandler: SendMessageHandler = () => {}
	let sendUserMessageHandler: SendUserMessageHandler = () => {}
	let steerHandler: DeliveryHandler = () => {}
	let followUpHandler: DeliveryHandler = () => {}
	let isIdleHandler: IsIdleHandler = () => true
	let appendEntryHandler: AppendEntryHandler = () => {}
	const messageRenderers = new Map<string, HookMessageRenderer>()
	const commands = new Map<string, RegisteredCommand>()
	const tools = new Map<string, RegisteredTool>()
	const shortcuts = new Map<string, { description?: string; handler: HandlerFn }>()

	const eventAliases: Record<string, HookEventType> = {
		session_start: "session.start",
		session_resume: "session.resume",
		session_tree: "session.resume",
		session_clear: "session.clear",
		session_shutdown: "session.shutdown",
	}

	const api: HookAPI = {
		on(event: HookEventType | string, handler: HandlerFn): void {
			const mappedEvent = (eventAliases[event] ?? event) as HookEventType
			const list = handlers.get(mappedEvent) ?? []
			list.push(handler)
			handlers.set(mappedEvent, list)
		},
		send(text: string): void {
			sendHandler(text)
		},
		sendUserMessage(text: string, options): Promise<void> {
			return Promise.resolve(sendUserMessageHandler(text, options))
		},
		steer(text: string): Promise<void> {
			return Promise.resolve(steerHandler(text))
		},
		followUp(text: string): Promise<void> {
			return Promise.resolve(followUpHandler(text))
		},
		isIdle(): boolean {
			return isIdleHandler()
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
			const schema = tool.schema ?? tool.parameters
			tools.set(tool.name, schema === undefined ? tool : { ...tool, schema })
		},
		registerShortcut(key, options): void {
			shortcuts.set(key, options)
		},
	}

	return {
		api,
		messageRenderers,
		commands,
		tools,
		setSendHandler: (handler) => { sendHandler = handler },
		setSendMessageHandler: (handler) => { sendMessageHandler = handler },
		setSendUserMessageHandler: (handler) => { sendUserMessageHandler = handler },
		setSteerHandler: (handler) => { steerHandler = handler },
		setFollowUpHandler: (handler) => { followUpHandler = handler },
		setIsIdleHandler: (handler) => { isIdleHandler = handler },
		setAppendEntryHandler: (handler) => { appendEntryHandler = handler },
	}
}

const findPackageRoot = (filePath: string): string => {
	let current = dirname(filePath)
	for (;;) {
		if (existsSync(join(current, "package.json"))) return current
		const parent = dirname(current)
		if (parent === current) return dirname(filePath)
		current = parent
	}
}

const writeCompatPackage = (packageRoot: string, packageName: string, source: string): void => {
	const packageDir = join(packageRoot, "node_modules", ...packageName.split("/"))
	const packageJson = join(packageDir, "package.json")
	const indexFile = join(packageDir, "index.js")
	if (existsSync(packageJson) || existsSync(indexFile)) {
		try {
			const pkg = JSON.parse(readFileSync(packageJson, "utf8")) as { version?: unknown }
			if (pkg.version !== "0.0.0-marvin-compat") return
		} catch {
			return
		}
	}

	mkdirSync(packageDir, { recursive: true })
	writeFileSync(packageJson, JSON.stringify({ name: packageName, version: "0.0.0-marvin-compat", type: "module", main: "./index.js" }, null, 2) + "\n")
	writeFileSync(indexFile, source)
}

const importAllFrom = (specifier: string): string => `export * from ${JSON.stringify(specifier)};\n`

const resolveBundledModule = (packageName: string, devRelativePath: string): string => {
	const require = createRequire(import.meta.url)
	try {
		return require.resolve(packageName)
	} catch {
		const devPath = fileURLToPath(new URL(devRelativePath, import.meta.url))
		return existsSync(devPath) ? pathToFileURL(devPath).href : packageName
	}
}

const ensurePiCompatibilityModules = (hookPath: string): void => {
	const packageRoot = findPackageRoot(hookPath)
	writeCompatPackage(packageRoot, "@mariozechner/pi-coding-agent", "export {};\n")
	writeCompatPackage(packageRoot, "@mariozechner/pi-ai", importAllFrom(resolveBundledModule("@yeshwanthyk/ai", "../../../ai/src/index.ts")))
	writeCompatPackage(packageRoot, "typebox", importAllFrom(resolveBundledModule("@sinclair/typebox", "../../../../node_modules/@sinclair/typebox/build/esm/index.mjs")))
	writeCompatPackage(packageRoot, "@mariozechner/pi-tui", `
export class Text {
	constructor(text = "", x = 0, y = 0) {
		this.text = String(text);
		this.x = x;
		this.y = y;
	}
	toString() {
		return this.text;
	}
}

export class Box {
	constructor(children = [], x = 0, y = 0) {
		this.children = Array.isArray(children) ? children : [children];
		this.x = x;
		this.y = y;
	}
	toString() {
		return this.children.map((child) => String(child)).join("\\n");
	}
}

export function truncateToWidth(text, width) {
	const value = String(text ?? "");
	if (!Number.isFinite(width) || width <= 0) return "";
	return value.length > width ? value.slice(0, Math.max(0, width - 1)) + "…" : value;
}
`)
}

/**
 * Load a single hook module.
 */
async function loadHook(hookPath: string): Promise<{ hook: LoadedHook | null; error: string | null }> {
	try {
		ensurePiCompatibilityModules(hookPath)
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
			setSendUserMessageHandler,
			setSteerHandler,
			setFollowUpHandler,
			setIsIdleHandler,
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
				setSendUserMessageHandler,
				setSteerHandler,
				setFollowUpHandler,
				setIsIdleHandler,
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
function discoverModulesInDir(dir: string, options: { skipManagedExtensionRoots?: boolean } = {}): string[] {
	if (!existsSync(dir)) {
		return []
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true })
		const paths: string[] = []
		for (const entry of entries) {
			if ((entry.isFile() || entry.isSymbolicLink()) && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
				paths.push(join(dir, entry.name))
			} else if (entry.isDirectory()) {
				if (
					entry.name === "node_modules" ||
					(options.skipManagedExtensionRoots && (entry.name === "npm" || entry.name === "git"))
				) {
					continue
				}
				paths.push(...discoverConfiguredExtension(join(dir, entry.name), dir))
			}
		}
		return paths
	} catch {
		return []
	}
}

const expandHome = (value: string): string =>
	value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value

const resolveConfiguredPath = (value: string, cwd: string): string => {
	const expanded = expandHome(value)
	return resolve(cwd, expanded)
}

const discoverConfiguredExtension = (value: string, cwd: string): string[] => {
	const fullPath = resolveConfiguredPath(value, cwd)
	if (!existsSync(fullPath)) return []
	try {
		const stats = statSync(fullPath)
		if (stats.isDirectory()) {
			const packageJsonPath = join(fullPath, "package.json")
			if (existsSync(packageJsonPath)) {
				try {
					const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
						marvin?: { extensions?: unknown }
						pi?: { extensions?: unknown }
					}
					const manifestExtensions = Array.isArray(pkg.marvin?.extensions)
						? pkg.marvin.extensions
						: Array.isArray(pkg.pi?.extensions)
							? pkg.pi.extensions
							: undefined
					if (manifestExtensions) {
						return manifestExtensions
							.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
							.flatMap((entry) => discoverConfiguredExtension(entry, fullPath))
					}
				} catch {
					// Fall back to conventional directory discovery.
				}
			}

			const directIndexTs = join(fullPath, "index.ts")
			const directIndexJs = join(fullPath, "index.js")
			if (existsSync(directIndexTs)) return [directIndexTs]
			if (existsSync(directIndexJs)) return [directIndexJs]
			return discoverModulesInDir(fullPath)
		}

		if (stats.isFile() || stats.isSymbolicLink()) return [fullPath]
	} catch {
		return []
	}
	return []
}

/**
 * Discover and load hooks from the config directory.
 * Loads from ~/.config/marvin/hooks/*.ts
 *
 * @param configDir - Base config directory (e.g., ~/.config/marvin)
 */
export async function loadHooks(configDir: string, options: LoadHooksOptions = {}): Promise<LoadHooksResult> {
	const hooks: LoadedHook[] = []
	const issues: ValidationIssue[] = []

	const hooksDir = join(configDir, "hooks")
	const cwd = options.cwd ?? process.cwd()
	const configured = options.extensionPaths ?? []
	const paths = [
		...discoverModulesInDir(hooksDir),
		...(options.extensionsEnabled === false
			? []
			: [
				...discoverModulesInDir(join(configDir, "extensions"), { skipManagedExtensionRoots: true }),
				...discoverModulesInDir(resolve(cwd, ".marvin", "extensions"), { skipManagedExtensionRoots: true }),
				...discoverModulesInDir(resolve(cwd, ".pi", "extensions"), { skipManagedExtensionRoots: true }),
				...configured.flatMap((entry) => discoverConfiguredExtension(entry, cwd)),
			]),
	]
	const uniquePaths = Array.from(new Set(paths))

	for (const hookPath of uniquePaths) {
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

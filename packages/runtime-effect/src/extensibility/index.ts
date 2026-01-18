import { Context, Effect, Layer } from "effect"
import { loadHooks, HookRunner, type HookError } from "../hooks/index.js"
import {
	loadCustomTools,
	type LoadedCustomTool,
	type SendRef,
} from "./custom-tools/index.js"
import type { ValidationIssue } from "./schema.js"
import type { ReadonlySessionManager } from "../session-manager.js"
import { ConfigTag } from "../config.js"
import { SessionManagerTag } from "../session-manager.js"
import { InstrumentationTag } from "../instrumentation.js"
import { CustomCommandTag, type CustomCommandService } from "./custom-commands.js"

export interface ExtensibilityLoadOptions {
	configDir: string
	cwd: string
	sendRef: SendRef
	builtinToolNames: string[]
	/** Whether running in interactive mode (TUI) */
	hasUI: boolean
	/** Session manager for hook context */
	sessionManager: ReadonlySessionManager
}

export interface ExtensibilityLoadResult {
	hookRunner: HookRunner
	customTools: LoadedCustomTool[]
	validationIssues: ValidationIssue[]
	hookCount: number
}

export const loadExtensibility = async (
	options: ExtensibilityLoadOptions,
): Promise<ExtensibilityLoadResult> => {
	const { hooks, issues: hookIssues } = await loadHooks(options.configDir)
	const hookRunner = new HookRunner(hooks, options.cwd, options.configDir, options.sessionManager)

	const { tools: customTools, issues: toolIssues } = await loadCustomTools(
		options.configDir,
		options.cwd,
		options.builtinToolNames,
		options.sendRef,
		options.hasUI,
	)

	return {
		hookRunner,
		customTools,
		validationIssues: [...hookIssues, ...toolIssues],
		hookCount: hooks.length,
	}
}

export const attachHookErrorLogging = (hookRunner: HookRunner, log: (message: string) => void) => {
	hookRunner.onError((err: HookError) => {
		log(`Hook error [${err.event}] ${err.hookPath}: ${err.error}`)
	})
}

export interface ExtensibilityService extends ExtensibilityLoadResult {}

export const ExtensibilityTag = Context.GenericTag<ExtensibilityService>("runtime-effect/ExtensibilityService")

export interface ExtensibilityLayerOptions {
	sendRef: SendRef
	builtinToolNames: string[]
	hasUI: boolean
	cwd?: string
	loader?: typeof loadExtensibility
}

export const ExtensibilityLayer = (options: ExtensibilityLayerOptions) =>
	Layer.effect(
		ExtensibilityTag,
		Effect.gen(function* () {
			const { config } = yield* ConfigTag
			const { sessionManager } = yield* SessionManagerTag
			const instrumentation = yield* InstrumentationTag
			const customCommands = yield* Effect.catchAll(
				CustomCommandTag,
				() => Effect.succeed<CustomCommandService | null>(null),
			)
			const loader = options.loader ?? loadExtensibility

			const result = yield* Effect.tryPromise(() =>
				loader({
					configDir: config.configDir,
					cwd: options.cwd ?? process.cwd(),
					sendRef: options.sendRef,
					builtinToolNames: options.builtinToolNames,
					hasUI: options.hasUI,
					sessionManager,
				}),
			)

			result.hookRunner.onError((err) => {
				const errorValue = err.error
				let errorMessage: string
				if (typeof errorValue === "object" && errorValue !== null && "message" in errorValue) {
					const maybeMessage = (errorValue as { message?: unknown }).message
					errorMessage = maybeMessage !== undefined ? String(maybeMessage) : String(errorValue)
				} else {
					errorMessage = String(errorValue)
				}

				instrumentation.record({
					type: "hook:error",
					hookPath: err.hookPath,
					event: err.event,
					error: errorMessage,
				})
			})

			for (const issue of result.validationIssues) {
				instrumentation.record({
					type: "extensibility:validation-issue",
					issue,
				})
			}

			const commandCount = customCommands?.commands.size
			instrumentation.record({
				type: "extensibility:loaded",
				hooks: result.hookCount,
				customTools: result.customTools.length,
				...(commandCount !== undefined ? { customCommands: commandCount } : {}),
			})

			instrumentation.record({
				type: "extensibility:custom-tools-loaded",
				count: result.customTools.length,
				entries: result.customTools.map((tool) => ({
					name: tool.tool.name,
					path: tool.resolvedPath,
				})),
			})

			return result
		}),
	)

/**
 * Hook runner - executes hooks and manages event emission.
 */

import { spawn } from "node:child_process"
import type { LoadedHook, SendHandler } from "./loader.js"
import type {
	ExecOptions,
	ExecResult,
	HookError,
	HookEvent,
	HookEventContext,
	HookEventType,
	ToolExecuteBeforeEvent,
	ToolExecuteBeforeResult,
	ToolExecuteAfterEvent,
	ToolExecuteAfterResult,
} from "./types.js"

/** Default timeout for hook execution (5 seconds) */
const DEFAULT_TIMEOUT = 5000

/** Listener for hook errors */
export type HookErrorListener = (error: HookError) => void

/**
 * Execute a command and return stdout/stderr/code.
 */
async function exec(command: string, args: string[], cwd: string, options?: ExecOptions): Promise<ExecResult> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, { cwd, shell: false })

		let stdout = ""
		let stderr = ""
		let killed = false
		let timeoutId: ReturnType<typeof setTimeout> | undefined

		const killProcess = () => {
			if (!killed) {
				killed = true
				proc.kill("SIGTERM")
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL")
				}, 5000)
			}
		}

		if (options?.signal) {
			if (options.signal.aborted) killProcess()
			else options.signal.addEventListener("abort", killProcess, { once: true })
		}

		if (options?.timeout && options.timeout > 0) {
			timeoutId = setTimeout(killProcess, options.timeout)
		}

		proc.stdout?.on("data", (data) => { stdout += data.toString() })
		proc.stderr?.on("data", (data) => { stderr += data.toString() })

		proc.on("close", (code) => {
			if (timeoutId) clearTimeout(timeoutId)
			if (options?.signal) options.signal.removeEventListener("abort", killProcess)
			resolve({ stdout, stderr, code: code ?? 0, killed })
		})

		proc.on("error", () => {
			if (timeoutId) clearTimeout(timeoutId)
			if (options?.signal) options.signal.removeEventListener("abort", killProcess)
			resolve({ stdout, stderr, code: 1, killed })
		})
	})
}

/** Create a timeout promise */
function createTimeout(ms: number): { promise: Promise<never>; clear: () => void } {
	let timeoutId: ReturnType<typeof setTimeout>
	const promise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error(`Hook timed out after ${ms}ms`)), ms)
	})
	return { promise, clear: () => clearTimeout(timeoutId) }
}

/**
 * HookRunner executes hooks and manages event emission.
 */
export class HookRunner {
	private hooks: LoadedHook[]
	private cwd: string
	private configDir: string
	private timeout: number
	private errorListeners = new Set<HookErrorListener>()

	constructor(hooks: LoadedHook[], cwd: string, configDir: string, timeout = DEFAULT_TIMEOUT) {
		this.hooks = hooks
		this.cwd = cwd
		this.configDir = configDir
		this.timeout = timeout
	}

	/** Get the paths of all loaded hooks */
	getHookPaths(): string[] {
		return this.hooks.map((h) => h.path)
	}

	/**
	 * Set the send handler for all hooks' marvin.send().
	 * Call this when the app initializes.
	 */
	setSendHandler(handler: SendHandler): void {
		for (const hook of this.hooks) {
			hook.setSendHandler(handler)
		}
	}

	/** Subscribe to hook errors */
	onError(listener: HookErrorListener): () => void {
		this.errorListeners.add(listener)
		return () => this.errorListeners.delete(listener)
	}

	private emitError(error: HookError): void {
		for (const listener of this.errorListeners) {
			listener(error)
		}
	}

	/** Check if any hooks have handlers for the given event type */
	hasHandlers(eventType: HookEventType): boolean {
		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(eventType)
			if (handlers && handlers.length > 0) return true
		}
		return false
	}

	private createContext(): HookEventContext {
		return {
			exec: (command: string, args: string[], options?: ExecOptions) => exec(command, args, this.cwd, options),
			cwd: this.cwd,
			configDir: this.configDir,
		}
	}

	/**
	 * Emit a general event to all hooks.
	 * Errors are caught and reported, not propagated.
	 */
	async emit(event: HookEvent): Promise<void> {
		const ctx = this.createContext()

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(event.type as HookEventType)
			if (!handlers || handlers.length === 0) continue

			for (const handler of handlers) {
				try {
					const timeout = createTimeout(this.timeout)
					await Promise.race([handler(event, ctx), timeout.promise])
					timeout.clear()
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err)
					this.emitError({ hookPath: hook.path, event: event.type, error: message })
				}
			}
		}
	}

	/**
	 * Emit tool.execute.before event.
	 * If any hook blocks, returns the block result.
	 * If any hook errors, throws (fail-safe: block on error).
	 */
	async emitToolExecuteBefore(event: ToolExecuteBeforeEvent): Promise<ToolExecuteBeforeResult | undefined> {
		const ctx = this.createContext()

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get("tool.execute.before")
			if (!handlers || handlers.length === 0) continue

			for (const handler of handlers) {
				// No timeout for tool.execute.before - user prompts can take time
				const result = await handler(event, ctx) as ToolExecuteBeforeResult | undefined

				if (result?.block) {
					return result
				}
			}
		}

		return undefined
	}

	/**
	 * Emit tool.execute.after event.
	 * Returns the last non-undefined result (for chaining modifications).
	 */
	async emitToolExecuteAfter(event: ToolExecuteAfterEvent): Promise<ToolExecuteAfterResult | undefined> {
		const ctx = this.createContext()
		let result: ToolExecuteAfterResult | undefined

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get("tool.execute.after")
			if (!handlers || handlers.length === 0) continue

			for (const handler of handlers) {
				try {
					const timeout = createTimeout(this.timeout)
					const handlerResult = await Promise.race([handler(event, ctx), timeout.promise]) as ToolExecuteAfterResult | undefined
					timeout.clear()

					if (handlerResult) {
						result = handlerResult
						// Update event with modifications for chaining
						if (handlerResult.content) event.content = handlerResult.content
						if (handlerResult.details !== undefined) event.details = handlerResult.details
						if (handlerResult.isError !== undefined) event.isError = handlerResult.isError
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err)
					this.emitError({ hookPath: hook.path, event: event.type, error: message })
				}
			}
		}

		return result
	}
}

/**
 * Create an empty hook runner (when no hooks are loaded).
 */
export function createEmptyRunner(cwd: string, configDir: string): HookRunner {
	return new HookRunner([], cwd, configDir)
}

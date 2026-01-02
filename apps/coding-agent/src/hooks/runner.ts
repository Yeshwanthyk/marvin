/**
 * Hook runner - executes hooks and manages event emission.
 */

import { spawn } from "node:child_process"
import type { AppendEntryHandler, LoadedHook, SendHandler, SendMessageHandler } from "./loader.js"
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartResult,
	ChatMessageEvent,
	ChatMessagesTransformEvent,
	ChatParamsEvent,
	ChatSystemTransformEvent,
	AuthGetEvent,
	ExecOptions,
	ExecResult,
	HookError,
	HookEvent,
	HookEventContext,
	HookEventType,
	HookMessageRenderer,
	HookSessionContext,
	HookUIContext,
	ModelResolveEvent,
	RegisteredCommand,
	RegisteredTool,
	TokenUsage,
	ToolExecuteBeforeEvent,
	ToolExecuteBeforeResult,
	ToolExecuteAfterEvent,
	ToolExecuteAfterResult,
} from "./types.js"
import type { AgentRunConfig } from "@marvin-agents/agent-core"
import type { Api, ImageContent, Message, Model } from "@marvin-agents/ai"
import type { ReadonlySessionManager } from "../session-manager.js"

/** Listener for hook errors */
export type HookErrorListener = (error: HookError) => void

/** No-op UI context for headless/ACP modes */
const noOpUIContext: HookUIContext = {
	select: async () => undefined,
	confirm: async () => false,
	input: async () => undefined,
	editor: async () => undefined,
	notify: () => {},
	custom: async () => undefined,
	setEditorText: () => {},
	getEditorText: () => "",
}

/** No-op session context for headless/ACP modes */
const noOpSessionContext: HookSessionContext = {
	summarize: async () => {},
	toast: () => {},
	getTokenUsage: () => undefined,
	getContextLimit: () => undefined,
	newSession: async () => ({ cancelled: true }),
	getApiKey: async () => undefined,
	complete: async () => ({ text: "", stopReason: "error" }),
}

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

/**
 * HookRunner executes hooks and manages event emission.
 */
export class HookRunner {
	private hooks: LoadedHook[]
	private cwd: string
	private configDir: string
	private sessionManager: ReadonlySessionManager
	private uiContext: HookUIContext
	private sessionContext: HookSessionContext
	private hasUI: boolean
	private errorListeners = new Set<HookErrorListener>()
	private sessionIdProvider: () => string | null
	private modelProvider: () => Model<Api> | null
	private tokenUsage: TokenUsage | undefined
	private contextLimit: number | undefined

	constructor(hooks: LoadedHook[], cwd: string, configDir: string, sessionManager: ReadonlySessionManager) {
		this.hooks = hooks
		this.cwd = cwd
		this.configDir = configDir
		this.sessionManager = sessionManager
		this.uiContext = noOpUIContext
		this.sessionContext = noOpSessionContext
		this.hasUI = false
		this.sessionIdProvider = () => null
		this.modelProvider = () => null
	}

	/**
	 * Initialize the runner with handlers and context providers.
	 * Must be called before emitting events.
	 */
	initialize(options: {
		sendHandler: SendHandler
		sendMessageHandler: SendMessageHandler
		appendEntryHandler: AppendEntryHandler
		getSessionId: () => string | null
		getModel: () => Model<Api> | null
		uiContext?: HookUIContext
		sessionContext?: HookSessionContext
		hasUI?: boolean
	}): void {
		this.sessionIdProvider = options.getSessionId
		this.modelProvider = options.getModel
		this.uiContext = options.uiContext ?? noOpUIContext
		this.sessionContext = options.sessionContext ?? noOpSessionContext
		this.hasUI = options.hasUI ?? false
		for (const hook of this.hooks) {
			hook.setSendHandler(options.sendHandler)
			hook.setSendMessageHandler(options.sendMessageHandler)
			hook.setAppendEntryHandler(options.appendEntryHandler)
		}
	}

	/** Update token usage for context tracking */
	updateTokenUsage(tokens: TokenUsage, contextLimit: number): void {
		this.tokenUsage = tokens
		this.contextLimit = contextLimit
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
			sessionId: this.sessionIdProvider(),
			sessionManager: this.sessionManager,
			model: this.modelProvider(),
			ui: this.uiContext,
			hasUI: this.hasUI,
			session: {
				...this.sessionContext,
				getTokenUsage: () => this.tokenUsage,
				getContextLimit: () => this.contextLimit,
			},
		}
	}

	/**
	 * Emit a general event to all hooks.
	 * Errors are caught and reported, not propagated.
	 */
	async emit(event: HookEvent): Promise<void> {
		const ctx = this.createContext()

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(event.type)
			if (!handlers || handlers.length === 0) continue

			for (const handler of handlers) {
				try {
					await handler(event, ctx)
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
					const handlerResult = await handler(event, ctx) as ToolExecuteAfterResult | undefined

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

	/** Get current session ID */
	getSessionId(): string | null {
		return this.sessionIdProvider()
	}

	/** Get current hook context */
	getContext(): HookEventContext {
		return this.createContext()
	}

	/** Get message renderer for a custom type */
	getMessageRenderer(customType: string): HookMessageRenderer | undefined {
		for (const hook of this.hooks) {
			const renderer = hook.messageRenderers.get(customType)
			if (renderer) return renderer
		}
		return undefined
	}

	/** Get all registered commands */
	getRegisteredCommands(): RegisteredCommand[] {
		const commands: RegisteredCommand[] = []
		for (const hook of this.hooks) {
			for (const cmd of hook.commands.values()) commands.push(cmd)
		}
		return commands
	}

	/** Get a registered command by name */
	getCommand(name: string): RegisteredCommand | undefined {
		for (const hook of this.hooks) {
			const cmd = hook.commands.get(name)
			if (cmd) return cmd
		}
		return undefined
	}

	/** Get all registered tools */
	getRegisteredTools(): RegisteredTool[] {
		const tools: RegisteredTool[] = []
		for (const hook of this.hooks) {
			for (const tool of hook.tools.values()) tools.push(tool)
		}
		return tools
	}

	/** Get a registered tool by name */
	getTool(name: string): RegisteredTool | undefined {
		for (const hook of this.hooks) {
			const tool = hook.tools.get(name)
			if (tool) return tool
		}
		return undefined
	}

	/** Transform messages through chat.messages.transform hooks */
	async emitContext(messages: Message[]): Promise<Message[]> {
		let current = messages.map((msg) => structuredClone(msg))
		for (const hook of this.hooks) {
			const handlers = hook.handlers.get("chat.messages.transform")
			if (!handlers || handlers.length === 0) continue
			for (const handler of handlers) {
				const event: ChatMessagesTransformEvent = { type: "chat.messages.transform", messages: current }
				try {
					await handler(event, this.createContext())
					current = event.messages
				} catch (err) {
					this.emitError({ hookPath: hook.path, event: "chat.messages.transform", error: String(err) })
				}
			}
		}
		return current
	}

	/** Emit chat.message event */
	async emitChatMessage(input: ChatMessageEvent["input"], output: ChatMessageEvent["output"]): Promise<void> {
		await this.emit({ type: "chat.message", input, output })
	}

	/** Emit agent.before_start event and return first message result */
	async emitBeforeAgentStart(prompt: string, images?: ImageContent[]): Promise<BeforeAgentStartResult | undefined> {
		let result: BeforeAgentStartResult | undefined
		for (const hook of this.hooks) {
			const handlers = hook.handlers.get("agent.before_start")
			if (!handlers || handlers.length === 0) continue
			for (const handler of handlers) {
				const event: BeforeAgentStartEvent = { type: "agent.before_start", prompt, images }
				try {
					const handlerResult = await handler(event, this.createContext()) as BeforeAgentStartResult | undefined
					if (handlerResult?.message && !result) result = handlerResult
				} catch (err) {
					this.emitError({ hookPath: hook.path, event: "agent.before_start", error: String(err) })
				}
			}
		}
		return result
	}

	/** Apply run config through chat/auth/model hooks */
	async applyRunConfig(cfg: AgentRunConfig, sessionId: string | null): Promise<AgentRunConfig> {
		const system: ChatSystemTransformEvent["output"] = { systemPrompt: cfg.systemPrompt }
		await this.emit({ type: "chat.system.transform", input: { sessionId, systemPrompt: cfg.systemPrompt }, output: system })

		const params: ChatParamsEvent["output"] = { streamOptions: cfg.streamOptions ?? {} }
		await this.emit({ type: "chat.params", input: { sessionId }, output: params })

		const modelOutput: ModelResolveEvent["output"] = { model: cfg.model }
		await this.emit({ type: "model.resolve", input: { sessionId, model: cfg.model }, output: modelOutput })

		const auth: AuthGetEvent["output"] = {}
		await this.emit({ type: "auth.get", input: { sessionId, provider: modelOutput.model.provider, modelId: modelOutput.model.id }, output: auth })

		return {
			...cfg,
			systemPrompt: system.systemPrompt,
			streamOptions: params.streamOptions,
			model: modelOutput.model,
			apiKey: auth.apiKey ?? cfg.apiKey,
			headers: auth.headers ?? cfg.headers,
			baseUrl: auth.baseUrl ?? cfg.baseUrl,
		}
	}
}

/**
 * Create an empty hook runner (when no hooks are loaded).
 */
export function createEmptyRunner(cwd: string, configDir: string, sessionManager: ReadonlySessionManager): HookRunner {
	return new HookRunner([], cwd, configDir, sessionManager)
}

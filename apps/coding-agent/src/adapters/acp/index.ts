/**
 * ACP (Agent Client Protocol) server mode for Zed integration
 * JSON-RPC 2.0 over stdio
 */

import type { Agent } from "@yeshwanthyk/agent-core"
import { getModels, type KnownProvider, type Model, type Api } from "@yeshwanthyk/ai"
import { createRuntime } from "@runtime/factory.js"
import { Effect } from "effect"
import {
	type JsonRpcRequest,
	type JsonRpcNotification,
	type InitializeParams,
	type InitializeResult,
	type NewSessionParams,
	type NewSessionResult,
	type PromptParams,
	type PromptResult,
	type CancelParams,
	type SetModelParams,
	type SetModelResult,
	type ModelOption,
	makeResponse,
	makeError,
	ErrorCodes,
} from "./protocol.js"
import { createUpdateEmitter } from "./updates.js"
import { createAcpSession, type AcpSession } from "./session.js"
import pkg from "../../../package.json"

// Type guards and validation functions
function isKnownProvider(value: string): value is KnownProvider {
	const knownProviders: KnownProvider[] = [
		"anthropic", "google", "openai", "codex", "github-copilot", 
		"xai", "groq", "cerebras", "openrouter", "zai", "mistral", "opencode"
	]
	return knownProviders.includes(value as KnownProvider)
}

function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
	return typeof msg === "object" && 
		msg !== null &&
		"jsonrpc" in msg && 
		typeof (msg as Record<string, unknown>).jsonrpc === "string" && 
		(msg as Record<string, unknown>).jsonrpc === "2.0" &&
		"id" in msg &&
		(msg as Record<string, unknown>).id !== undefined &&
		"method" in msg &&
		typeof (msg as Record<string, unknown>).method === "string"
}

function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
	return typeof msg === "object" && 
		msg !== null &&
		"jsonrpc" in msg && 
		typeof (msg as Record<string, unknown>).jsonrpc === "string" && 
		(msg as Record<string, unknown>).jsonrpc === "2.0" &&
		(!("id" in msg) || (msg as Record<string, unknown>).id === undefined) &&
		"method" in msg &&
		typeof (msg as Record<string, unknown>).method === "string"
}

function validateInitializeParams(params: unknown): InitializeParams | null {
	if (!params || typeof params !== "object") return null
	const p = params as Record<string, unknown>
	if (typeof p.protocolVersion !== "number") return null
	
	// Safe construction instead of casting
	return {
		protocolVersion: p.protocolVersion,
		...Object.fromEntries(
			Object.entries(p).filter(([key]) => key !== 'protocolVersion')
		)
	} as InitializeParams
}

function validateNewSessionParams(params: unknown): NewSessionParams | null {
	if (!params || typeof params !== "object") return null
	const p = params as Record<string, unknown>
	if (typeof p.cwd !== "string") return null
	
	// Safe construction instead of casting
	return {
		cwd: p.cwd,
		...Object.fromEntries(
			Object.entries(p).filter(([key]) => key !== 'cwd')
		)
	} as NewSessionParams
}

function validatePromptParams(params: unknown): PromptParams | null {
	if (!params || typeof params !== "object") return null
	const p = params as Record<string, unknown>
	if (typeof p.sessionId !== "string" || !Array.isArray(p.prompt)) return null
	
	// Safe construction instead of casting
	return {
		sessionId: p.sessionId,
		prompt: p.prompt,
		...Object.fromEntries(
			Object.entries(p).filter(([key]) => !['sessionId', 'prompt'].includes(key))
		)
	} as PromptParams
}

function validateSetModelParams(params: unknown): SetModelParams | null {
	if (!params || typeof params !== "object") return null
	const p = params as Record<string, unknown>
	if (typeof p.sessionId !== "string" || typeof p.modelId !== "string") return null
	
	// Safe construction instead of casting
	return {
		sessionId: p.sessionId,
		modelId: p.modelId,
		...Object.fromEntries(
			Object.entries(p).filter(([key]) => !['sessionId', 'modelId'].includes(key))
		)
	} as SetModelParams
}

function validateCancelParams(params: unknown): CancelParams | null {
	if (!params || typeof params !== "object") return null
	const p = params as Record<string, unknown>
	if (typeof p.sessionId !== "string") return null
	
	// Safe construction instead of casting
	return {
		sessionId: p.sessionId,
		...Object.fromEntries(
			Object.entries(p).filter(([key]) => key !== 'sessionId')
		)
	} as CancelParams
}

// Fixed model list for Zed picker
const MODEL_OPTIONS: ModelOption[] = [
	{ modelId: "claude-opus-4-5", name: "Claude Opus 4.5" },
	{ modelId: "codex/gpt-5.2-codex", name: "GPT 5.2 Codex" },
	{ modelId: "opencode/glm-4.7-free", name: "GLM 4.7 Free" },
]

interface AcpServerState {
	initialized: boolean
	session: AcpSession | null
	agent: Agent | null
	currentModelId: string
}

function parseModelSpec(spec: string): { provider: KnownProvider; modelId: string } {
	if (spec.includes("/")) {
		const [provider, ...rest] = spec.split("/")
		if (isKnownProvider(provider)) {
			return { provider, modelId: rest.join("/") }
		}
		// If provider is unknown, default to anthropic
		return { provider: "anthropic", modelId: spec }
	}
	// Default to anthropic for models without provider prefix
	return { provider: "anthropic", modelId: spec }
}

function findModel(provider: KnownProvider, modelId: string): Model<Api> | undefined {
	const models = getModels(provider)
	return models.find((m) => m.id === modelId)
}

export async function runAcp(args: { configDir?: string; configPath?: string; model?: string }) {
	const runtime = await createRuntime(
		{
			configDir: args.configDir,
			configPath: args.configPath,
			model: args.model,
		},
		"acp",
	)

	// Initialize hooks with no-op handlers for ACP mode (no interactive UI)
	runtime.hookRunner.initialize({
		sendHandler: () => {},
		sendMessageHandler: () => {},
		sendUserMessageHandler: async () => {},
		steerHandler: async () => {},
		followUpHandler: async () => {},
		isIdleHandler: () => true,
		appendEntryHandler: (customType, data) => runtime.sessionManager.appendEntry(customType, data),
		getSessionId: () => runtime.sessionManager.sessionId,
		getModel: () => runtime.agent.state.model,
		hasUI: false,
	})

	// Determine initial model from args or first in MODEL_OPTIONS
	const initialModelId = args.model?.split(",")[0] ?? MODEL_OPTIONS[0]?.modelId ?? "claude-opus-4-5"

	const state: AcpServerState = {
		initialized: false,
		session: null,
		agent: null,
		currentModelId: initialModelId,
	}

	// Write JSON-RPC message to stdout
	const writeMessage = (msg: object) => {
		const json = JSON.stringify(msg)
		process.stdout.write(json + "\n")
	}

	// Handle initialize request
	const handleInitialize = (params: unknown): InitializeResult => {
		const validParams = validateInitializeParams(params)
		if (!validParams) {
			throw new Error("Invalid initialize parameters")
		}
		state.initialized = true
		return {
			protocolVersion: 1,
			agentInfo: {
				name: "Marvin",
				version: pkg.version,
			},
			agentCapabilities: {
				promptCapabilities: {
					image: true,
					embeddedContext: false,
				},
			},
			authMethods: [],
		}
	}

	// Handle session/new request
	const handleNewSession = async (params: unknown): Promise<NewSessionResult> => {
		const validParams = validateNewSessionParams(params)
		if (!validParams) {
			throw new Error("Invalid new session parameters")
		}
		const sessionId = crypto.randomUUID()
		const cwd = validParams.cwd || process.cwd()

		// Parse current model
		const { provider, modelId } = parseModelSpec(state.currentModelId)
		const model = findModel(provider, modelId)
		if (!model) {
			throw new Error(`Model not found: ${state.currentModelId}`)
		}

		// Prepare runtime agent
		const agent = runtime.agent
		agent.abort()
		agent.reset()
		agent.setModel(model)
		agent.setThinkingLevel(runtime.config.thinking)
		state.agent = agent
		runtime.config.provider = provider
		runtime.config.modelId = model.id
		runtime.config.model = model

		await Effect.runPromise(runtime.sessionOrchestrator.queue.clear)

		// Create update emitter
		const emitter = createUpdateEmitter(sessionId, writeMessage)

		// Model setter
		const setModelFn = (newModelId: string): boolean => {
			const option = MODEL_OPTIONS.find((m) => m.modelId === newModelId)
			if (!option) return false

			const { provider: p, modelId: m } = parseModelSpec(newModelId)
			const newModel = findModel(p, m)
			if (!newModel) return false
			const activeAgent = state.agent ?? runtime.agent
			activeAgent.setModel(newModel)
			state.currentModelId = newModelId
			runtime.config.provider = p
			runtime.config.modelId = newModel.id
			runtime.config.model = newModel
			return true
		}

		// Create session
		state.session = createAcpSession({
			sessionId,
			cwd,
			agent,
			sessionOrchestrator: runtime.sessionOrchestrator,
			emitter,
			models: MODEL_OPTIONS,
			currentModelId: state.currentModelId,
			contextWindow: model.contextWindow,
			thinkingLevel: runtime.config.thinking,
			setModel: setModelFn,
		})

		return {
			sessionId,
			models: {
				availableModels: MODEL_OPTIONS,
				currentModelId: state.currentModelId,
			},
		}
	}

	// Emit post-session notifications (called after response is sent)
	const emitSessionNotifications = () => {
		if (!state.session) return
		const emitter = createUpdateEmitter(state.session.id, writeMessage)
		emitter.emitCommands(state.session.getAvailableCommands())
		emitter.emitModels(MODEL_OPTIONS, state.currentModelId)
	}

	// Handle session/prompt request
	const handlePrompt = async (params: unknown): Promise<PromptResult> => {
		const validParams = validatePromptParams(params)
		if (!validParams) {
			throw new Error("Invalid prompt parameters")
		}
		
		if (!state.session) {
			throw new Error("No active session")
		}
		if (validParams.sessionId !== state.session.id) {
			throw new Error("Invalid session ID")
		}

		const stopReason = await state.session.prompt(validParams.prompt)
		return { stopReason }
	}

	// Handle session/cancel notification
	const handleCancel = (params: unknown): void => {
		const validParams = validateCancelParams(params)
		if (!validParams) return // Ignore invalid cancel notifications
		
		if (state.session && validParams.sessionId === state.session.id) {
			state.session.cancel()
		}
	}

	// Handle session/set_model request
	const handleSetModel = (params: unknown): SetModelResult => {
		const validParams = validateSetModelParams(params)
		if (!validParams) {
			throw new Error("Invalid set model parameters")
		}
		
		if (!state.session) {
			throw new Error("No active session")
		}
		if (validParams.sessionId !== state.session.id) {
			throw new Error("Invalid session ID")
		}

		const success = state.session.setModel(validParams.modelId)
		if (!success) {
			throw new Error(`Unknown model: ${validParams.modelId}`)
		}

		return { modelId: validParams.modelId }
	}

	// Process a JSON-RPC request
	const processRequest = async (req: JsonRpcRequest): Promise<void> => {
		try {
			let result: unknown

			switch (req.method) {
				case "initialize":
					result = handleInitialize(req.params)
					break
				case "session/new":
					result = await handleNewSession(req.params)
					break
				case "session/prompt":
					result = await handlePrompt(req.params)
					break
				case "session/set_model":
					result = handleSetModel(req.params)
					break
				default:
					writeMessage(makeError(req.id, ErrorCodes.MethodNotFound, `Unknown method: ${req.method}`))
					return
			}

			writeMessage(makeResponse(req.id, result))

			// Emit notifications after session/new response
			if (req.method === "session/new") {
				emitSessionNotifications()
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			writeMessage(makeError(req.id, ErrorCodes.InternalError, message))
		}
	}

	// Process a JSON-RPC notification
	const processNotification = (notif: JsonRpcNotification): void => {
		switch (notif.method) {
			case "session/cancel":
				handleCancel(notif.params)
				break
			// Ignore unknown notifications
		}
	}

	// Read and process stdin line by line
	const readline = await import("node:readline")
	const rl = readline.createInterface({
		input: process.stdin,
		terminal: false,
	})

	for await (const line of rl) {
		if (!line.trim()) continue

		try {
			const msg = JSON.parse(line)

			if (msg.jsonrpc !== "2.0") {
				writeMessage(makeError(msg.id ?? null, ErrorCodes.InvalidRequest, "Invalid JSON-RPC version"))
				continue
			}

			if (isJsonRpcRequest(msg)) {
				// Request
				await processRequest(msg)
			} else if (isJsonRpcNotification(msg)) {
				// Notification
				processNotification(msg)
			} else {
				writeMessage(makeError(msg.id ?? null, ErrorCodes.InvalidRequest, "Invalid JSON-RPC message structure"))
			}
		} catch {
			writeMessage(makeError(0, ErrorCodes.ParseError, "Parse error"))
		}
	}
}

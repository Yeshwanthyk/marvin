/**
 * ACP (Agent Client Protocol) server mode for Zed integration
 * JSON-RPC 2.0 over stdio
 */

import type { Agent } from "@marvin-agents/agent-core"
import { getModels, type KnownProvider, type Model, type Api } from "@marvin-agents/ai"
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
		return { provider: provider as KnownProvider, modelId: rest.join("/") }
	}
	// Default to anthropic for models without provider prefix
	return { provider: "anthropic", modelId: spec }
}

function findModel(provider: KnownProvider, modelId: string): Model<Api> | undefined {
	const models = getModels(provider)
	return models.find((m) => m.id === modelId) as Model<Api> | undefined
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
	const handleInitialize = (_params: InitializeParams): InitializeResult => {
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
	const handleNewSession = async (params: NewSessionParams): Promise<NewSessionResult> => {
		const sessionId = crypto.randomUUID()
		const cwd = params.cwd || process.cwd()

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
	const handlePrompt = async (params: PromptParams): Promise<PromptResult> => {
		if (!state.session) {
			throw new Error("No active session")
		}
		if (params.sessionId !== state.session.id) {
			throw new Error("Invalid session ID")
		}

		const stopReason = await state.session.prompt(params.prompt)
		return { stopReason }
	}

	// Handle session/cancel notification
	const handleCancel = (params: CancelParams): void => {
		if (state.session && params.sessionId === state.session.id) {
			state.session.cancel()
		}
	}

	// Handle session/set_model request
	const handleSetModel = (params: SetModelParams): SetModelResult => {
		if (!state.session) {
			throw new Error("No active session")
		}
		if (params.sessionId !== state.session.id) {
			throw new Error("Invalid session ID")
		}

		const success = state.session.setModel(params.modelId)
		if (!success) {
			throw new Error(`Unknown model: ${params.modelId}`)
		}

		return { modelId: params.modelId }
	}

	// Process a JSON-RPC request
	const processRequest = async (req: JsonRpcRequest): Promise<void> => {
		try {
			let result: unknown

			switch (req.method) {
				case "initialize":
					result = handleInitialize(req.params as InitializeParams)
					break
				case "session/new":
					result = await handleNewSession(req.params as NewSessionParams)
					break
				case "session/prompt":
					result = await handlePrompt(req.params as PromptParams)
					break
				case "session/set_model":
					result = handleSetModel(req.params as SetModelParams)
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
				handleCancel(notif.params as CancelParams)
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

			if (msg.id !== undefined) {
				// Request
				await processRequest(msg as JsonRpcRequest)
			} else {
				// Notification
				processNotification(msg as JsonRpcNotification)
			}
		} catch {
			writeMessage(makeError(0, ErrorCodes.ParseError, "Parse error"))
		}
	}
}

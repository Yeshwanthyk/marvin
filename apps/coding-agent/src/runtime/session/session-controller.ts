import type { Agent, ThinkingLevel, AppMessage } from "@marvin-agents/agent-core"
import type { Api, Model, KnownProvider } from "@marvin-agents/ai"
import type { HookRunner } from "../../hooks/index.js"
import type { SessionManager, LoadedSession } from "../../session-manager.js"
import type { UIMessage, ToolBlock, UIContentBlock, UIShellMessage } from "../../types.js"
import {
	extractOrderedBlocks,
	extractThinking,
	extractToolCalls,
	extractText,
	getEditDiffText,
	getToolText,
} from "@domain/messaging/content.js"
import { resolveProvider, resolveModel } from "@domain/commands/helpers.js"
import type { PromptDeliveryMode, PromptQueue } from "./prompt-queue.js"

export interface SessionControllerOptions {
	initialProvider: KnownProvider
	initialModel: Model<Api>
	initialModelId: string
	initialThinking: ThinkingLevel
	agent: Agent
	sessionManager: SessionManager
	hookRunner: HookRunner
	toolByName: Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: any; renderResult?: any }>
	setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void
	setContextTokens: (v: number) => void
	setDisplayProvider: (provider: KnownProvider) => void
	setDisplayModelId: (id: string) => void
	setDisplayThinking: (v: ThinkingLevel) => void
	setDisplayContextWindow: (v: number) => void
	shellInjectionPrefix: string
	promptQueue?: PromptQueue
}

export interface SessionControllerState {
	ensureSession: () => void
	restoreSession: (session: LoadedSession) => void
	currentProvider: () => KnownProvider
	setCurrentProvider: (p: KnownProvider) => void
	currentModelId: () => string
	setCurrentModelId: (id: string) => void
	currentThinking: () => ThinkingLevel
	setCurrentThinking: (t: ThinkingLevel) => void
	isSessionStarted: () => boolean
	followUp: (text: string) => Promise<void>
	steer: (text: string) => Promise<void>
	sendUserMessage: (text: string, options?: { deliverAs?: PromptDeliveryMode }) => Promise<void>
}

export function createSessionController(options: SessionControllerOptions): SessionControllerState {
	let sessionStarted = false
	let currentProvider = options.initialProvider
	let currentModelId = options.initialModelId
	let currentThinking = options.initialThinking

	options.setDisplayProvider(currentProvider)

	const ensureSession = () => {
		if (!sessionStarted) {
			options.sessionManager.startSession(currentProvider, currentModelId, currentThinking)
			sessionStarted = true
			void options.hookRunner.emit({ type: "session.start", sessionId: options.sessionManager.sessionId })
		}
	}

	const restoreSession = (session: LoadedSession) => {
		const { metadata } = session
		const sessionMessages = session.messages as AppMessage[]
		const resolvedProvider = resolveProvider(metadata.provider)
		if (resolvedProvider) {
			const resolvedModel = resolveModel(resolvedProvider, metadata.modelId)
			if (resolvedModel) {
				currentProvider = resolvedProvider
				currentModelId = resolvedModel.id
				currentThinking = metadata.thinkingLevel
				options.setDisplayProvider(resolvedProvider)
				options.agent.setModel(resolvedModel)
				options.agent.setThinkingLevel(metadata.thinkingLevel)
				options.setDisplayModelId(resolvedModel.id)
				options.setDisplayThinking(metadata.thinkingLevel)
				options.setDisplayContextWindow(resolvedModel.contextWindow)
			}
		}
		options.agent.replaceMessages(sessionMessages)

		for (let i = sessionMessages.length - 1; i >= 0; i--) {
			const msg = sessionMessages[i] as { role: string; usage?: { totalTokens?: number } }
			if (msg.role === "assistant" && msg.usage?.totalTokens) {
				options.setContextTokens(msg.usage.totalTokens)
				break
			}
		}

		const toolResultMap = new Map<string, { output: string; editDiff: string | null; isError: boolean }>()
		for (const msg of sessionMessages) {
			if (msg.role === "toolResult") {
				toolResultMap.set(msg.toolCallId, {
					output: getToolText(msg),
					editDiff: getEditDiffText(msg),
					isError: msg.isError ?? false,
				})
			}
		}

		const uiMessages: UIMessage[] = []
		for (const msg of sessionMessages) {
			if (msg.role === "user") {
				const contentText = typeof msg.content === "string" ? msg.content : extractText(msg.content as unknown[])
				if (contentText.startsWith(options.shellInjectionPrefix)) continue
				uiMessages.push({ id: crypto.randomUUID(), role: "user", content: contentText })
			} else if (msg.role === "assistant") {
				const text = extractText(msg.content as unknown[])
				const thinking = extractThinking(msg.content as unknown[])
				const toolCalls = extractToolCalls(msg.content as unknown[])
				const tools: ToolBlock[] = toolCalls.map((tc) => {
					const result = toolResultMap.get(tc.id)
					const meta = options.toolByName.get(tc.name)
					return {
						id: tc.id,
						name: tc.name,
						args: tc.args,
						output: result?.output,
						editDiff: result?.editDiff || undefined,
						isError: result?.isError ?? false,
						isComplete: true,
						label: meta?.label,
						source: meta?.source,
						sourcePath: meta?.sourcePath,
						renderCall: meta?.renderCall,
						renderResult: meta?.renderResult,
					}
				})
				const orderedBlocks = extractOrderedBlocks(msg.content as unknown[])
				const contentBlocks: UIContentBlock[] = orderedBlocks.map((block) => {
					if (block.type === "thinking") {
						return { type: "thinking", id: block.id, summary: block.summary, preview: block.preview, full: block.full }
					} else if (block.type === "text") {
						return { type: "text", text: block.text }
					} else {
						const tool = tools.find((t) => t.id === block.id)
						return {
							type: "tool",
							tool: tool || { id: block.id, name: block.name, args: block.args, isError: false, isComplete: false },
						}
					}
				})
				uiMessages.push({ id: crypto.randomUUID(), role: "assistant", content: text, thinking: thinking || undefined, isStreaming: false, tools, contentBlocks })
			} else if ((msg as { role: string }).role === "shell") {
				const shellMsg = msg as unknown as UIShellMessage
				uiMessages.push({
					id: crypto.randomUUID(),
					role: "shell",
					command: shellMsg.command,
					output: shellMsg.output,
					exitCode: shellMsg.exitCode,
					truncated: shellMsg.truncated,
					tempFilePath: shellMsg.tempFilePath,
					timestamp: shellMsg.timestamp,
				})
			}
		}

		options.setMessages(() => uiMessages)
		const sessionPath = options.sessionManager.listSessions().find((s) => s.id === metadata.id)?.path || ""
		options.sessionManager.continueSession(sessionPath, metadata.id)
		sessionStarted = true
		void options.hookRunner.emit({ type: "session.resume", sessionId: metadata.id })
	}

	const queueUserMessage = async (text: string, mode: PromptDeliveryMode) => {
		const trimmed = text
		if (!trimmed) return
		const message: AppMessage = {
			role: "user",
			content: [{ type: "text", text: trimmed }],
			timestamp: Date.now(),
		}
		options.promptQueue?.push({ text: trimmed, mode })
		if (mode === "steer") {
			await options.agent.steer(message)
		} else {
			await options.agent.followUp(message)
		}
	}

	return {
		ensureSession,
		restoreSession,
		currentProvider: () => currentProvider,
		setCurrentProvider: (p) => {
			currentProvider = p
			options.setDisplayProvider(p)
		},
		currentModelId: () => currentModelId,
		setCurrentModelId: (id) => {
			currentModelId = id
		},
		currentThinking: () => currentThinking,
		setCurrentThinking: (t) => {
			currentThinking = t
		},
		isSessionStarted: () => sessionStarted,
		followUp: (text) => queueUserMessage(text, "followUp"),
		steer: (text) => queueUserMessage(text, "steer"),
		sendUserMessage: (text, options) => queueUserMessage(text, options?.deliverAs ?? "followUp"),
	}
}

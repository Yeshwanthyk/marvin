import type { Agent, ThinkingLevel, AppMessage } from "@yeshwanthyk/agent-core"
import type { Api, Model, KnownProvider, AgentToolResult } from "@yeshwanthyk/ai"
import type { Theme } from "@yeshwanthyk/open-tui"
import type { JSX } from "solid-js"
import type { HookRunner } from "../../hooks/index.js"
import type { SessionManager, LoadedSession, SessionNodeEntry } from "../../session-manager.js"
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
import type { PromptDeliveryMode, PromptQueue } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import type { RenderResultOptions } from "@yeshwanthyk/runtime-effect/extensibility/custom-tools/types.js"

export interface SessionControllerOptions {
	initialProvider: KnownProvider
	initialModel: Model<Api>
	initialModelId: string
	initialThinking: ThinkingLevel
	agent: Agent
	sessionManager: SessionManager
	hookRunner: HookRunner
	toolByName: Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: (args: unknown, theme: Theme) => JSX.Element; renderResult?: (result: AgentToolResult<unknown>, opts: RenderResultOptions, theme: Theme) => JSX.Element }>
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
	startSession: () => void
	clearSession: () => void
	restoreSession: (session: LoadedSession, path?: string) => void
	switchSession: (path: string) => boolean
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
	navigateTree: (entryId: string, options?: { summaryMessage?: AppMessage }) => Promise<{ editorText?: string } | undefined>
}

interface SessionRenderOptions {
	toolByName: Map<string, { label: string; source: "builtin" | "custom"; sourcePath?: string; renderCall?: (args: unknown, theme: Theme) => JSX.Element; renderResult?: (result: AgentToolResult<unknown>, opts: RenderResultOptions, theme: Theme) => JSX.Element }>
	shellInjectionPrefix: string
}

export interface RenderedSessionView {
	messages: UIMessage[]
	contextTokens: number
}

const textFromMessage = (message: AppMessage): string => {
	const content = (message as { content?: unknown }).content
	return typeof content === "string" ? content : Array.isArray(content) ? extractText(content) : ""
}

export const renderLoadedSessionView = (
	sessionMessages: AppMessage[],
	options: SessionRenderOptions,
): RenderedSessionView => {
	let contextTokens = 0
	for (let i = sessionMessages.length - 1; i >= 0; i--) {
		const msg = sessionMessages[i] as { role: string; usage?: { totalTokens?: number } }
		if (msg.role === "assistant" && msg.usage?.totalTokens) {
			contextTokens = msg.usage.totalTokens
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
			const contentText = textFromMessage(msg)
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

	return { messages: uiMessages, contextTokens }
}

export function createSessionController(options: SessionControllerOptions): SessionControllerState {
	let sessionStarted = false
	let currentProvider = options.initialProvider
	let currentModelId = options.initialModelId
	let currentThinking = options.initialThinking

	options.setDisplayProvider(currentProvider)

	const startSession = () => {
		options.sessionManager.startSession(currentProvider, currentModelId, currentThinking)
		sessionStarted = true
		void options.hookRunner.emit({ type: "session.start", sessionId: options.sessionManager.sessionId })
	}

	const clearSession = () => {
		sessionStarted = false
		options.sessionManager.clearCurrentSession()
	}

	const ensureSession = () => {
		if (!sessionStarted) startSession()
	}

	const renderMessages = (sessionMessages: AppMessage[]) => {
		options.agent.replaceMessages(sessionMessages)
		const view = renderLoadedSessionView(sessionMessages, options)
		options.setContextTokens(view.contextTokens)
		options.setMessages(() => view.messages)
	}

	const restoreSession = (session: LoadedSession, path?: string) => {
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
		renderMessages(sessionMessages)
		const sessionPath = path ?? options.sessionManager.listSessions().find((s) => s.id === metadata.id)?.path ?? ""
		options.sessionManager.continueSession(sessionPath, metadata.id)
		if (session.leafId) {
			options.sessionManager.branch(session.leafId)
		}
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

	const switchSession = (path: string): boolean => {
		try {
			const loaded = options.sessionManager.loadSession(path)
			if (!loaded) {
				return false
			}

			restoreSession(loaded, path)
			return true
		} catch {
			return false
		}
	}

	const messagesFromBranch = (branch: SessionNodeEntry[]): AppMessage[] =>
		branch
			.filter((entry): entry is Extract<SessionNodeEntry, { type: "message" }> => entry.type === "message")
			.map((entry) => entry.message as AppMessage)

	const navigateTree = async (entryId: string, navigateOptions: { summaryMessage?: AppMessage } = {}): Promise<{ editorText?: string } | undefined> => {
		const target = options.sessionManager.getEntry(entryId)
		if (!target) return undefined

		let leafId: string | null = target.id
		let editorText: string | undefined
		if (target.type === "message" && target.message.role === "user") {
			editorText = textFromMessage(target.message as AppMessage)
			leafId = target.parentId
		}

		if (leafId === null) {
			options.sessionManager.resetLeaf()
		} else {
			options.sessionManager.branch(leafId)
		}
		if (navigateOptions.summaryMessage) {
			options.sessionManager.appendMessage(navigateOptions.summaryMessage)
		}

		renderMessages(messagesFromBranch(options.sessionManager.getBranch()))
		void options.hookRunner.emit({ type: "session.resume", sessionId: options.sessionManager.sessionId })
		return editorText !== undefined ? { editorText } : {}
	}

	return {
		ensureSession,
		startSession,
		clearSession,
		restoreSession,
		switchSession,
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
		navigateTree,
	}
}

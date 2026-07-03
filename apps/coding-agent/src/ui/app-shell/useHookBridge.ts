import { createHookMessage, createHookUIContext, type CompletionResult, type HookMessage, type HookSessionContext } from "@yeshwanthyk/runtime-effect/hooks/index.js"
import { completeSimple, type Message } from "@yeshwanthyk/ai"
import { appendWithCap } from "@domain/messaging/content.js"
import type { useRuntime } from "../../runtime/context.js"
import type { createSessionController } from "@runtime/session/session-controller.js"
import type { CommandContext } from "../../commands.js"
import type { UIMessage } from "../../types.js"
import { handleSlashInput } from "../features/composer/SlashCommandHandler.js"
import { hookMessageToUiMessage } from "./hook-message-projection.js"

type RuntimeContext = ReturnType<typeof useRuntime>
type SessionController = ReturnType<typeof createSessionController>
type ToastVariant = "info" | "warning" | "success" | "error"

export interface UseHookBridgeDeps {
	agent: RuntimeContext["agent"]
	sessionManager: RuntimeContext["sessionManager"]
	hookRunner: RuntimeContext["hookRunner"]
	getApiKey: RuntimeContext["getApiKey"]
	customCommands: RuntimeContext["customCommands"]
	builtInCommandNames: Set<string>
	cmdCtx: CommandContext
	sessionController: SessionController
	setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void
	setEditorText: (text: string) => void
	getEditorText: () => string
	showSelect: (title: string, options: string[]) => Promise<string | undefined>
	showInput: (title: string, placeholder?: string, initialValue?: string) => Promise<string | undefined>
	showConfirm: (title: string, message: string) => Promise<boolean>
	showEditor: (title: string, initialText?: string) => Promise<string | undefined>
	showToast: (title: string, message: string, variant?: ToastVariant) => void
	startFreshSession: () => void
	handleSubmit: (text: string, editorClearFn?: () => void) => Promise<void>
	sendUserMessage: (text: string, options?: { deliverAs?: "steer" | "followUp" }) => Promise<void>
	steer: (text: string) => Promise<void>
	followUp: (text: string) => Promise<void>
	isResponding: () => boolean
}

export const useHookBridge = ({
	agent,
	sessionManager,
	hookRunner,
	getApiKey,
	customCommands,
	builtInCommandNames,
	cmdCtx,
	setMessages,
	setEditorText,
	getEditorText,
	showSelect,
	showInput,
	showConfirm,
	showEditor,
	showToast,
	startFreshSession,
	handleSubmit,
	sendUserMessage,
	steer,
	followUp,
	isResponding,
}: UseHookBridgeDeps) => {
	const hookUIContext = createHookUIContext({
		setEditorText,
		getEditorText,
		showSelect,
		showInput,
		showConfirm,
		showEditor,
		showNotify: (message, type = "info") => showToast(type, message, type),
	})

	const hookSessionContext: HookSessionContext = {
		summarize: async () => {
			await handleSlashInput("/compact", {
				commandContext: cmdCtx,
				customCommands,
				builtInCommandNames,
				onExpand: async (expanded) => handleSubmit(expanded),
			})
		},
		toast: (title, message, variant = "info") => showToast(title, message, variant),
		getTokenUsage: () => hookRunner["tokenUsage"],
		getContextLimit: () => hookRunner["contextLimit"],
		newSession: async (_opts) => {
			startFreshSession()
			return { cancelled: false, sessionId: sessionManager.sessionId ?? undefined }
		},
		getApiKey: async (model) => getApiKey(model.provider),
		complete: async (systemPrompt, userText) => {
			const model = agent.state.model
			const apiKey = getApiKey(model.provider)
			if (!apiKey) {
				return { text: "", stopReason: "error" as const }
			}
			try {
				const userMessage: Message = {
					role: "user",
					content: [{ type: "text", text: userText }],
					timestamp: Date.now(),
				}
				const result = await completeSimple(model, { systemPrompt, messages: [userMessage] }, { apiKey })
				const text = result.content
					.filter((content): content is { type: "text"; text: string } => content.type === "text")
					.map((content) => content.text)
					.join("\n")
				const stopMap: Record<string, CompletionResult["stopReason"]> = {
					stop: "end",
					length: "max_tokens",
					toolUse: "tool_use",
					error: "error",
					aborted: "aborted",
				}
				return { text, stopReason: stopMap[result.stopReason] ?? "end" }
			} catch (err) {
				return { text: err instanceof Error ? err.message : String(err), stopReason: "error" as const }
			}
		},
	}

	const sendMessageHandler = <T = unknown>(
		message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
		triggerTurn?: boolean | { triggerTurn?: boolean },
	) => {
		const shouldTriggerTurn = typeof triggerTurn === "object" ? triggerTurn.triggerTurn === true : triggerTurn === true
		const hookMessage = createHookMessage(message)
		if (hookMessage.display) {
			setMessages((prev) => appendWithCap(prev, hookMessageToUiMessage(hookMessage)))
		}
		sessionManager.appendMessage(hookMessage)
		if (shouldTriggerTurn) {
			void handleSubmit(typeof hookMessage.content === "string" ? hookMessage.content : "")
		}
	}

	hookRunner.initialize({
		sendHandler: (text) => void handleSubmit(text),
		sendMessageHandler,
		sendUserMessageHandler: (text, options) => sendUserMessage(text, options),
		steerHandler: (text) => steer(text),
		followUpHandler: (text) => followUp(text),
		isIdleHandler: () => !isResponding(),
		appendEntryHandler: (customType, data) => sessionManager.appendEntry(customType, data),
		getSessionId: () => sessionManager.sessionId,
		getModel: () => agent.state.model,
		uiContext: hookUIContext,
		sessionContext: hookSessionContext,
		hasUI: true,
	})
}

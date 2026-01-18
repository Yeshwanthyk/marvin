import { ThemeProvider, type ThemeMode } from "@marvin-agents/open-tui"
import { batch, onMount } from "solid-js"

/** Detect system dark/light mode (macOS only, defaults to dark) */
function detectThemeMode(): ThemeMode {
	try {
		const result = Bun.spawnSync(["defaults", "read", "-g", "AppleInterfaceStyle"])
		return result.stdout.toString().trim().toLowerCase() === "dark" ? "dark" : "light"
	} catch {
		return "dark"
	}
}
import { useRuntime } from "../../runtime/context.js"
import type { LoadedSession } from "../../session-manager.js"
import { createSessionController } from "@runtime/session/session-controller.js"
import { createPromptQueue, type PromptDeliveryMode } from "@runtime/session/prompt-queue.js"
import { appendWithCap } from "@domain/messaging/content.js"
import type { UIShellMessage, UIMessage } from "../../types.js"
import type { AppMessage } from "@marvin-agents/agent-core"
import { runShellCommand } from "../../shell-runner.js"
import { MainView } from "../features/main-view/MainView.js"
import { createAppStore } from "../state/app-store.js"
import { useAgentEvents } from "../../hooks/useAgentEvents.js"
import type { EventHandlerContext, ToolMeta } from "../../agent-events.js"
import { THINKING_LEVELS, type CommandContext } from "../../commands.js"
import { slashCommands } from "../../autocomplete-commands.js"
import { updateAppConfig } from "../../config.js"
import { handleSlashInput } from "../features/composer/SlashCommandHandler.js"
import { createHookMessage, createHookUIContext, type HookMessage, type HookSessionContext, type CompletionResult } from "../../hooks/index.js"
import { completeSimple, type Message } from "@marvin-agents/ai"
import { useModals } from "../hooks/useModals.js"
import { ModalContainer } from "../components/modals/ModalContainer.js"

const SHELL_INJECTION_PREFIX = "[Shell output]" as const

export interface TuiAppProps {
	initialSession: LoadedSession | null
}

export const TuiApp = ({ initialSession }: TuiAppProps) => {
	const runtime = useRuntime()
	const {
		agent,
		sessionManager,
		hookRunner,
		toolByName,
		customCommands,
		lsp,
		config,
		codexTransport,
		getApiKey,
		sendRef,
		lspActiveRef,
		cycleModels,
		validationIssues,
	} = runtime

	const toolMetaByName = new Map<string, ToolMeta>()
	for (const [name, entry] of toolByName.entries()) {
		toolMetaByName.set(name, {
			label: entry.label,
			source: entry.source,
			sourcePath: entry.sourcePath,
			renderCall: entry.renderCall as ToolMeta["renderCall"],
			renderResult: entry.renderResult as ToolMeta["renderResult"],
		})
	}

	const store = createAppStore({
		initialTheme: config.theme,
		initialModelId: config.modelId,
		initialThinking: config.thinking,
		initialContextWindow: config.model.contextWindow,
		initialProvider: config.provider,
	})

	const promptQueue = createPromptQueue((counts) => store.queueCounts.set(counts))
	const modals = useModals()

	const sessionController = createSessionController({
		initialProvider: config.provider,
		initialModel: config.model,
		initialModelId: config.modelId,
		initialThinking: config.thinking,
		agent,
		sessionManager,
		hookRunner,
		toolByName: toolMetaByName,
		setMessages: store.messages.set,
		setContextTokens: store.contextTokens.set,
		setDisplayProvider: store.currentProvider.set,
		setDisplayModelId: store.displayModelId.set,
		setDisplayThinking: store.displayThinking.set,
		setDisplayContextWindow: store.displayContextWindow.set,
		shellInjectionPrefix: SHELL_INJECTION_PREFIX,
		promptQueue,
	})

	onMount(() => {
		if (initialSession) {
			sessionController.restoreSession(initialSession)
		}
	})

	const ensureSession = () => sessionController.ensureSession()

	let cycleIndex = cycleModels.findIndex(
		(entry) => entry.model.id === config.modelId && entry.provider === config.provider,
	)
	if (cycleIndex < 0) cycleIndex = 0

	const streamingMessageIdRef = { current: null as string | null }
	const retryConfig = { enabled: true, maxRetries: 3, baseDelayMs: 2000 }
	const retryablePattern =
		/overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error/i
	const retryState = { attempt: 0, abortController: null as AbortController | null }

	lspActiveRef.setActive = store.lspActive.set

	const eventCtx: EventHandlerContext = {
		setMessages: store.messages.set,
		setToolBlocks: store.toolBlocks.set,
		setActivityState: store.activityState.set,
		setIsResponding: store.isResponding.set,
		setContextTokens: store.contextTokens.set,
		setCacheStats: store.cacheStats.set,
		setRetryStatus: store.retryStatus.set,
		setTurnCount: store.turnCount.set,
		promptQueue,
		sessionManager,
		streamingMessageId: streamingMessageIdRef,
		retryConfig,
		retryablePattern,
		retryState,
		agent: agent as EventHandlerContext["agent"],
		hookRunner,
		toolByName: toolMetaByName,
		getContextWindow: () => store.displayContextWindow.value(),
	}

	useAgentEvents({ agent, context: eventCtx })

	const handleThemeChange = (name: string) => {
		store.theme.set(name)
		void updateAppConfig({ configDir: config.configDir, configPath: config.configPath }, { theme: name })
	}

	const exitHandlerRef = { current: () => process.exit(0) }
	const editorOpenRef = { current: async () => {} }
	const setEditorTextRef = { current: (_text: string) => {} }
	const getEditorTextRef = { current: () => "" }
	const showToastRef = { current: (_title: string, _message: string, _variant?: "info" | "warning" | "success" | "error") => {} }
	// Flag to skip editor clear when hooks populate the editor via setEditorText
	const skipNextEditorClearRef = { current: false }

	const handleBeforeExit = async () => {
		// Emit shutdown hook before exiting
		await hookRunner.emit({ type: "session.shutdown", sessionId: sessionManager.sessionId })
	}

	const runImmediatePrompt = async (text: string) => {
		const trimmed = text.trim()
		if (!trimmed) return

		ensureSession()

		const beforeStartResult = await hookRunner.emitBeforeAgentStart(text)
		if (beforeStartResult?.message) {
			const hookMsg = createHookMessage(beforeStartResult.message)
			if (hookMsg.display) {
				const uiMsg: UIMessage = {
					id: crypto.randomUUID(),
					role: "assistant",
					content:
						typeof hookMsg.content === "string"
							? hookMsg.content
							: hookMsg.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(""),
					timestamp: hookMsg.timestamp,
				}
				store.messages.set((prev) => appendWithCap(prev, uiMsg))
			}
			sessionManager.appendMessage(hookMsg as unknown as AppMessage)
		}

		const chatMessageOutput: {
			parts: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>
		} = {
			parts: [{ type: "text", text }],
		}
		await hookRunner.emitChatMessage(
			{ sessionId: sessionManager.sessionId, text },
			chatMessageOutput,
		)

		sessionManager.appendMessage({ role: "user", content: chatMessageOutput.parts, timestamp: Date.now() })
		batch(() => {
			store.messages.set((prev) =>
				appendWithCap(prev, { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() }),
			)
			store.toolBlocks.set([])
			store.isResponding.set(true)
			store.activityState.set("thinking")
		})
		try {
			await agent.prompt(text)
		} catch (err) {
			batch(() => {
				store.messages.set((prev) =>
					appendWithCap(prev, {
						id: crypto.randomUUID(),
						role: "assistant",
						content: `Error: ${err instanceof Error ? err.message : String(err)}`,
					}),
				)
				store.isResponding.set(false)
				store.activityState.set("idle")
			})
		}
	}

	const steerHelper = async (text: string) => {
		const trimmed = text.trim()
		if (!trimmed) return
		if (store.isResponding.value()) {
			await sessionController.steer(trimmed)
			return
		}
		await runImmediatePrompt(trimmed)
	}

	const followUpHelper = async (text: string) => {
		const trimmed = text.trim()
		if (!trimmed) return
		if (store.isResponding.value()) {
			await sessionController.followUp(trimmed)
			return
		}
		await runImmediatePrompt(trimmed)
	}

	const sendUserMessageHelper = async (text: string, options?: { deliverAs?: PromptDeliveryMode }) => {
		const mode: PromptDeliveryMode = options?.deliverAs ?? "followUp"
		if (mode === "steer") {
			await steerHelper(text)
			return
		}
		await followUpHelper(text)
	}

	const cmdCtx: CommandContext = {
		agent,
		sessionManager,
		configDir: config.configDir,
		configPath: config.configPath,
		cwd: process.cwd(),
		editor: config.editor,
		codexTransport,
		getApiKey,
		get currentProvider() {
			return sessionController.currentProvider()
		},
		get currentModelId() {
			return sessionController.currentModelId()
		},
		get currentThinking() {
			return sessionController.currentThinking()
		},
		setCurrentProvider: (p) => sessionController.setCurrentProvider(p),
		setCurrentModelId: (id) => sessionController.setCurrentModelId(id),
		setCurrentThinking: (t) => sessionController.setCurrentThinking(t),
		isResponding: store.isResponding.value,
		setIsResponding: store.isResponding.set,
		setActivityState: store.activityState.set,
		setMessages: store.messages.set,
		setToolBlocks: store.toolBlocks.set,
		setContextTokens: store.contextTokens.set,
		setCacheStats: store.cacheStats.set,
		setDisplayModelId: store.displayModelId.set,
		setDisplayThinking: store.displayThinking.set,
		setDisplayContextWindow: store.displayContextWindow.set,
			setDiffWrapMode: store.diffWrapMode.set,
			setConcealMarkdown: store.concealMarkdown.set,
			setTheme: handleThemeChange,
			openEditor: () => editorOpenRef.current(),
			onExit: () => exitHandlerRef.current(),
			hookRunner,
			runImmediatePrompt,
			steer: (text) => steerHelper(text),
			followUp: (text) => followUpHelper(text),
			sendUserMessage: (text, options) => sendUserMessageHelper(text, options),
		}

	const builtInCommandNames = new Set(slashCommands.map((c) => c.name))

	const enqueueWhileResponding = (text: string, mode: PromptDeliveryMode) => {
		const trimmed = text.trim()
		if (!trimmed) return
		if (mode === "steer") {
			void sessionController.steer(trimmed)
			return
		}
		void sessionController.followUp(trimmed)
	}

	const handleSubmit = async (text: string, editorClearFn?: () => void) => {
		if (!text.trim()) return

		if (text.startsWith("!")) {
			const shouldInject = text.startsWith("!!")
			const command = text.slice(shouldInject ? 2 : 1).trim()
			if (!command) return
			editorClearFn?.()
			ensureSession()

			const shellMsgId = crypto.randomUUID()
			const pendingMsg: UIShellMessage = {
				id: shellMsgId,
				role: "shell",
				command,
				output: "",
				exitCode: null,
				truncated: false,
				timestamp: Date.now(),
			}
			store.messages.set((prev) => appendWithCap(prev, pendingMsg))

			const result = await runShellCommand(command, { timeout: 30000 })
			const finalMsg: UIShellMessage = {
				id: shellMsgId,
				role: "shell",
				command,
				output: result.output,
				exitCode: result.exitCode,
				truncated: result.truncated,
				tempFilePath: result.tempFilePath,
				timestamp: Date.now(),
			}
			store.messages.set((prev) => prev.map((m) => (m.id === shellMsgId ? finalMsg : m)))

			sessionManager.appendMessage({
				role: "shell",
				command,
				output: result.output,
				exitCode: result.exitCode,
				truncated: result.truncated,
				tempFilePath: result.tempFilePath,
				timestamp: Date.now(),
			} as unknown as AppMessage)

			if (shouldInject) {
				const injectionLines = [`${SHELL_INJECTION_PREFIX}`, `$ ${command}`, result.output]
				if (result.exitCode !== null && result.exitCode !== 0) injectionLines.push(`[exit ${result.exitCode}]`)
				if (result.truncated && result.tempFilePath) injectionLines.push(`[truncated, full output: ${result.tempFilePath}]`)
				const injectedText = injectionLines.filter((line) => line.length > 0).join("\n")
				const injectionMessage: AppMessage = {
					role: "user",
					content: [{ type: "text", text: injectedText }],
					timestamp: Date.now(),
				}
				agent.appendMessage(injectionMessage)
				sessionManager.appendMessage(injectionMessage)
			}
			return
		}

		if (text.startsWith("/")) {
			const trimmed = text.trim()
			const handled = await handleSlashInput(trimmed, {
				commandContext: cmdCtx,
				customCommands,
				builtInCommandNames,
				onExpand: async (expanded) => handleSubmit(expanded),
			})
			if (handled) {
				// Skip clear if hook populated editor via setEditorText
				if (!skipNextEditorClearRef.current) {
					editorClearFn?.()
				}
				skipNextEditorClearRef.current = false
				return
			}
		}

		if (store.isResponding.value()) {
			enqueueWhileResponding(text, "followUp")
			editorClearFn?.()
			return
		}

		editorClearFn?.()
		ensureSession()

		// Emit agent.before_start hook - allows hooks to inject a message before prompting
		await runImmediatePrompt(text)
	}

	// Initialize hook runner with full context
	const hookUIContext = createHookUIContext({
		setEditorText: (text) => {
			skipNextEditorClearRef.current = true
			setEditorTextRef.current(text)
		},
		getEditorText: () => getEditorTextRef.current(),
		showSelect: modals.showSelect,
		showInput: modals.showInput,
		showConfirm: modals.showConfirm,
		showEditor: modals.showEditor,
		showNotify: (message, type = "info") => showToastRef.current(type, message, type)
	})

	const hookSessionContext: HookSessionContext = {
		summarize: async () => {
			// Trigger compaction through the /compact command flow
			await handleSlashInput("/compact", {
				commandContext: cmdCtx,
				customCommands,
				builtInCommandNames,
				onExpand: async (expanded) => handleSubmit(expanded),
			})
		},
		toast: (title, message, variant = "info") => showToastRef.current(title, message, variant),
		getTokenUsage: () => hookRunner["tokenUsage"],
		getContextLimit: () => hookRunner["contextLimit"],
		newSession: async (_opts) => {
			// Clear current session and start fresh
			store.messages.set([])
			store.toolBlocks.set([])
			store.contextTokens.set(0)
			agent.reset()
			void hookRunner.emit({ type: "session.clear", sessionId: null })
			// Start a new session
			sessionManager.startSession(
				sessionController.currentProvider(),
				sessionController.currentModelId(),
				sessionController.currentThinking(),
			)
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
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n")
				// Map stopReason: stop -> end, length -> max_tokens, toolUse -> tool_use
				const stopMap: Record<string, CompletionResult["stopReason"]> = {
					stop: "end", length: "max_tokens", toolUse: "tool_use", error: "error", aborted: "aborted"
				}
				return { text, stopReason: stopMap[result.stopReason] ?? "end" }
			} catch (err) {
				return { text: err instanceof Error ? err.message : String(err), stopReason: "error" as const }
			}
		},
	}

	const sendMessageHandler = <T = unknown>(
		message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
		triggerTurn?: boolean,
	) => {
		const hookMessage = createHookMessage(message)
		// Add to UI messages if display is true
		if (hookMessage.display) {
			const uiMsg: UIMessage = {
				id: crypto.randomUUID(),
				role: "assistant", // Render hook messages as assistant for now
				content: typeof hookMessage.content === "string"
					? hookMessage.content
					: hookMessage.content.map(p => p.type === "text" ? p.text : "[image]").join(""),
				timestamp: hookMessage.timestamp,
			}
			store.messages.set((prev) => appendWithCap(prev, uiMsg))
		}
		// Persist hook message to session
		sessionManager.appendMessage(hookMessage as unknown as AppMessage)
		// Optionally trigger a new turn
		if (triggerTurn) {
			void handleSubmit(typeof hookMessage.content === "string" ? hookMessage.content : "")
		}
	}

	hookRunner.initialize({
		sendHandler: (text) => void handleSubmit(text),
		sendMessageHandler,
		sendUserMessageHandler: (text, options) => sendUserMessageHelper(text, options),
		steerHandler: (text) => steerHelper(text),
		followUpHandler: (text) => followUpHelper(text),
		isIdleHandler: () => !store.isResponding.value(),
		appendEntryHandler: (customType, data) => sessionManager.appendEntry(customType, data),
		getSessionId: () => sessionManager.sessionId,
		getModel: () => agent.state.model,
		uiContext: hookUIContext,
		sessionContext: hookSessionContext,
		hasUI: true,
	})

	sendRef.current = (text) => void handleSubmit(text)

	const handleAbort = (): string | null => {
		if (retryState.abortController) {
			retryState.abortController.abort()
			retryState.abortController = null
			retryState.attempt = 0
			store.retryStatus.set(null)
		}
		agent.abort()
		agent.clearMessageQueue()
		const restore = promptQueue.drainToScript()
		batch(() => {
			store.isResponding.set(false)
			store.activityState.set("idle")
		})
		return restore
	}

	const cycleModel = () => {
		if (cycleModels.length <= 1) return
		if (store.isResponding.value()) return
		cycleIndex = (cycleIndex + 1) % cycleModels.length
		const entry = cycleModels[cycleIndex]!
		sessionController.setCurrentProvider(entry.provider)
		sessionController.setCurrentModelId(entry.model.id)
		agent.setModel(entry.model)
		store.displayModelId.set(entry.model.id)
		store.displayContextWindow.set(entry.model.contextWindow)
	}

	const cycleThinking = () => {
		const current = sessionController.currentThinking()
		const next = THINKING_LEVELS[(THINKING_LEVELS.indexOf(current) + 1) % THINKING_LEVELS.length]!
		sessionController.setCurrentThinking(next)
		agent.setThinkingLevel(next)
		store.displayThinking.set(next)
	}

	const themeMode = detectThemeMode()

	return (
		<ThemeProvider mode={themeMode} themeName={store.theme.value()} onThemeChange={handleThemeChange}>
			<MainView
				validationIssues={validationIssues}
				messages={store.messages.value()}
				toolBlocks={store.toolBlocks.value()}
				isResponding={store.isResponding.value()}
				activityState={store.activityState.value()}
				thinkingVisible={store.thinkingVisible.value()}
				modelId={store.displayModelId.value()}
				thinking={store.displayThinking.value()}
				provider={store.currentProvider.value()}
				contextTokens={store.contextTokens.value()}
				contextWindow={store.displayContextWindow.value()}
				queueCounts={store.queueCounts.value()}
				retryStatus={store.retryStatus.value()}
				turnCount={store.turnCount.value()}
				lspActive={store.lspActive.value()}
				diffWrapMode={store.diffWrapMode.value()}
				concealMarkdown={store.concealMarkdown.value()}
				customCommands={customCommands}
				onSubmit={handleSubmit}
				onAbort={handleAbort}
				onToggleThinking={() => store.thinkingVisible.set((v) => !v)}
				onCycleModel={cycleModel}
				onCycleThinking={cycleThinking}
				exitHandlerRef={exitHandlerRef}
				editorOpenRef={editorOpenRef}
				setEditorTextRef={setEditorTextRef}
				getEditorTextRef={getEditorTextRef}
				showToastRef={showToastRef}
				onBeforeExit={handleBeforeExit}
				editor={config.editor}
				lsp={lsp}
			/>
			<ModalContainer modalState={modals.modalState()} onClose={modals.closeModal} />
		</ThemeProvider>
	)
}

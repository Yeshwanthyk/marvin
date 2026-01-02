import { ThemeProvider } from "@marvin-agents/open-tui"
import { batch, onMount } from "solid-js"
import { useRuntime } from "../../runtime/context.js"
import type { LoadedSession } from "../../session-manager.js"
import { createSessionController } from "@runtime/session/session-controller.js"
import { createPromptQueue } from "@runtime/session/prompt-queue.js"
import { appendWithCap } from "@domain/messaging/content.js"
import type { UIShellMessage } from "../../types.js"
import type { AppMessage } from "@marvin-agents/agent-core"
import { runShellCommand } from "../../shell-runner.js"
import { MainView } from "../features/main-view/MainView.js"
import { createAppStore } from "../state/app-store.js"
import { useAgentEvents } from "../../hooks/useAgentEvents.js"
import type { EventHandlerContext } from "../../agent-events.js"
import { THINKING_LEVELS, type CommandContext } from "../../commands.js"
import { slashCommands } from "../../autocomplete-commands.js"
import { updateAppConfig } from "../../config.js"
import { handleSlashInput } from "../features/composer/SlashCommandHandler.js"

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

	const store = createAppStore({
		initialTheme: config.theme,
		initialModelId: config.modelId,
		initialThinking: config.thinking,
		initialContextWindow: config.model.contextWindow,
		initialProvider: config.provider,
	})

	const promptQueue = createPromptQueue((size) => store.queueCount.set(size))

	const sessionController = createSessionController({
		initialProvider: config.provider,
		initialModel: config.model,
		initialModelId: config.modelId,
		initialThinking: config.thinking,
		agent,
		sessionManager,
		hookRunner,
		toolByName,
		setMessages: store.messages.set,
		setContextTokens: store.contextTokens.set,
		setDisplayProvider: store.currentProvider.set,
		setDisplayModelId: store.displayModelId.set,
		setDisplayThinking: store.displayThinking.set,
		setDisplayContextWindow: store.displayContextWindow.set,
		shellInjectionPrefix: SHELL_INJECTION_PREFIX,
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
		toolByName,
		getContextWindow: () => store.displayContextWindow.value(),
	}

	useAgentEvents({ agent, context: eventCtx })

	const handleThemeChange = (name: string) => {
		store.theme.set(name)
		void updateAppConfig({ configDir: config.configDir, configPath: config.configPath }, { theme: name })
	}

	const exitHandlerRef = { current: () => process.exit(0) }
	const editorOpenRef = { current: async () => {} }

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
	}

	const builtInCommandNames = new Set(slashCommands.map((c) => c.name))

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
				editorClearFn?.()
				return
			}
		}

		if (store.isResponding.value()) {
			promptQueue.push(text)
			void agent.queueMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
			editorClearFn?.()
			return
		}

		editorClearFn?.()
		ensureSession()
		sessionManager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() })
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

	hookRunner.setSendHandler((text) => void handleSubmit(text))
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
		const restore = promptQueue.drainToText()
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

	return (
		<ThemeProvider mode="dark" themeName={store.theme.value()} onThemeChange={handleThemeChange}>
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
				queueCount={store.queueCount.value()}
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
				editor={config.editor}
				lsp={lsp}
			/>
		</ThemeProvider>
	)
}

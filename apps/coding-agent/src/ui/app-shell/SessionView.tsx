import { batch, Show, type Accessor, type Setter } from "solid-js"
import type { AppMessage } from "@yeshwanthyk/agent-core"
import type { ValidationIssue } from "@yeshwanthyk/runtime-effect/extensibility/schema.js"
import type { CustomCommand } from "@yeshwanthyk/runtime-effect/extensibility/custom-commands.js"
import type { PromptQueue } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import type { RuntimeContext } from "../../runtime/factory.js"
import type { SessionControllerState } from "../../runtime/session/session-controller.js"
import type { EventHandlerContext, ToolMeta } from "../../agent-events.js"
import type { HostNotification } from "./activity-index.js"
import type { LaneHeaderState } from "./lane-header-state.js"
import type { AppStore } from "../state/app-store.js"
import { THINKING_LEVELS } from "../../commands.js"
import { useAgentEvents } from "../../hooks/useAgentEvents.js"
import { MainView } from "../features/main-view/MainView.js"

export interface SessionViewProps {
	// Phase 5c seam — these accessors will be rebound to a SessionActor projection (apps/coding-agent/src/runtime/actor-projection.ts).
	store: AppStore
	agent: RuntimeContext["agent"]
	sessionManager: RuntimeContext["sessionManager"]
	hookRunner: RuntimeContext["hookRunner"]
	customCommands: Map<string, CustomCommand>
	config: RuntimeContext["config"]
	cycleModels: RuntimeContext["cycleModels"]
	validationIssues: ValidationIssue[]
	toolMetaByName: Map<string, ToolMeta>
	sessionController: SessionControllerState
	setActiveMessages: EventHandlerContext["setMessages"]
	setActiveToolBlocks: EventHandlerContext["setToolBlocks"]
	setActiveContextTokens: EventHandlerContext["setContextTokens"]
	activeDisplayContextWindow: Accessor<number>
	promptQueue: PromptQueue
	setLastError: Setter<string | null>
	laneHeaderState: Accessor<LaneHeaderState>
	visibleCwd: Accessor<string>
	active: Accessor<boolean>
	onSubmit: (text: string, editorClearFn?: () => void) => Promise<void>
	hostNotifications?: Accessor<readonly HostNotification[]>
	acknowledgeHostNotification?: (id: string) => void
	exitHandlerRef: { current: () => void }
	editorOpenRef: { current: () => Promise<void> | void }
	editFileRef: { current: (filePath: string, line?: number) => Promise<void> | void }
	setEditorTextRef: { current: (text: string) => void }
	getEditorTextRef: { current: () => string }
	showToastRef: { current: (title: string, message: string, variant?: "info" | "warning" | "success" | "error") => void }
	clearEditorRef: { current: () => void }
	onComposerChange: (text: string) => void
	onBeforeExit: () => Promise<void>
}

export function SessionView(props: SessionViewProps) {
	let cycleIndex = props.cycleModels.findIndex(
		(entry) => entry.model.id === props.config.modelId && entry.provider === props.config.provider,
	)
	if (cycleIndex < 0) cycleIndex = 0

	const streamingMessageIdRef: EventHandlerContext["streamingMessageId"] = { current: null }
	const retryConfig = { enabled: true, maxRetries: 3, baseDelayMs: 2000 }
	const retryablePattern =
		/overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error/i
	const retryState: { attempt: number; abortController: AbortController | null } = {
		attempt: 0,
		abortController: null,
	}

	const eventCtx: EventHandlerContext = {
		setMessages: props.setActiveMessages,
		setToolBlocks: props.setActiveToolBlocks,
		setActivityState: props.store.activityState.set,
		setIsResponding: props.store.isResponding.set,
		setContextTokens: props.setActiveContextTokens,
		setCacheStats: props.store.cacheStats.set,
		setRetryStatus: props.store.retryStatus.set,
		setTurnCount: props.store.turnCount.set,
		setLastError: props.setLastError,
		promptQueue: props.promptQueue,
		sessionManager: props.sessionManager,
		streamingMessageId: streamingMessageIdRef,
		retryConfig,
		retryablePattern,
		retryState,
		agent: {
			getMessages: () => props.agent.state.messages,
			replaceMessages: (messages: AppMessage[]) => props.agent.replaceMessages(messages),
			continue: props.agent.continue.bind(props.agent),
		},
		hookRunner: props.hookRunner,
		toolByName: props.toolMetaByName,
		getContextWindow: () => props.activeDisplayContextWindow(),
	}

	useAgentEvents({ agent: props.agent, context: eventCtx })

	const handleAbort = (): string | null => {
		if (retryState.abortController) {
			retryState.abortController.abort()
			retryState.abortController = null
			retryState.attempt = 0
			props.store.retryStatus.set(null)
		}
		props.agent.abort()
		props.agent.clearMessageQueue()
		const restore = props.promptQueue.drainToScript()
		batch(() => {
			props.store.isResponding.set(false)
			props.store.activityState.set("idle")
		})
		return restore
	}

	const cycleModel = () => {
		if (props.cycleModels.length <= 1) return
		if (props.store.isResponding.value()) return
		cycleIndex = (cycleIndex + 1) % props.cycleModels.length
		const entry = props.cycleModels[cycleIndex]
		if (!entry) return
		props.sessionController.setCurrentProvider(entry.provider)
		props.sessionController.setCurrentModelId(entry.model.id)
		props.agent.setModel(entry.model)
		props.store.displayModelId.set(entry.model.id)
		props.store.displayContextWindow.set(entry.model.contextWindow)
		if (entry.thinking !== undefined) {
			props.sessionController.setCurrentThinking(entry.thinking)
			props.agent.setThinkingLevel(entry.thinking)
			props.store.displayThinking.set(entry.thinking)
		}
	}

	const cycleThinking = () => {
		const current = props.sessionController.currentThinking()
		const next = THINKING_LEVELS[(THINKING_LEVELS.indexOf(current) + 1) % THINKING_LEVELS.length]
		if (!next) return
		props.sessionController.setCurrentThinking(next)
		props.agent.setThinkingLevel(next)
		props.store.displayThinking.set(next)
	}

	return (
		<Show when={props.active()}>
		<MainView
			validationIssues={props.validationIssues}
			messages={props.store.messages.value()}
			toolBlocks={props.store.toolBlocks.value()}
			isResponding={props.store.isResponding.value()}
			activityState={props.store.activityState.value()}
			thinkingVisible={props.store.thinkingVisible.value()}
			modelId={props.store.displayModelId.value()}
			thinking={props.store.displayThinking.value()}
			provider={props.store.currentProvider.value()}
			contextTokens={props.store.contextTokens.value()}
			contextWindow={props.store.displayContextWindow.value()}
			queueCounts={props.store.queueCounts.value()}
			retryStatus={props.store.retryStatus.value()}
			turnCount={props.store.turnCount.value()}
			lane={props.laneHeaderState()}
			hostNotifications={props.hostNotifications?.() ?? []}
			onAcknowledgeHostNotification={props.acknowledgeHostNotification}
			diffWrapMode={props.store.diffWrapMode.value()}
			concealMarkdown={props.store.concealMarkdown.value()}
			customCommands={props.customCommands}
			cwd={props.visibleCwd()}
			onSubmit={props.onSubmit}
			onAbort={handleAbort}
			onToggleThinking={() => props.store.thinkingVisible.set((v) => !v)}
			onCycleModel={cycleModel}
			onCycleThinking={cycleThinking}
			exitHandlerRef={props.exitHandlerRef}
			editorOpenRef={props.editorOpenRef}
			editFileRef={props.editFileRef}
			setEditorTextRef={props.setEditorTextRef}
			getEditorTextRef={props.getEditorTextRef}
			showToastRef={props.showToastRef}
			clearEditorRef={props.clearEditorRef}
			onComposerChange={props.onComposerChange}
			onBeforeExit={props.onBeforeExit}
			editor={props.config.editor}
		/>
		</Show>
	)
}

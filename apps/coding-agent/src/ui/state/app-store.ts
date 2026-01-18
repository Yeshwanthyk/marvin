import { createSignal, type Accessor, type Setter } from "solid-js"
import type { ThinkingLevel } from "@marvin-agents/agent-core"
import type { KnownProvider } from "@marvin-agents/ai"
import type { ActivityState, ToolBlock, UIMessage } from "../../types.js"
import type { QueueCounts } from "../../runtime/session/prompt-queue.js"

interface SignalRef<T> {
	value: Accessor<T>
	set: Setter<T>
}

const createSignalRef = <T,>(initial: T): SignalRef<T> => {
	const [value, set] = createSignal(initial)
	return { value, set }
}

export interface AppStore {
	theme: SignalRef<string>
	messages: SignalRef<UIMessage[]>
	toolBlocks: SignalRef<ToolBlock[]>
	isResponding: SignalRef<boolean>
	activityState: SignalRef<ActivityState>
	thinkingVisible: SignalRef<boolean>
	diffWrapMode: SignalRef<"word" | "none">
	concealMarkdown: SignalRef<boolean>
	displayModelId: SignalRef<string>
	displayThinking: SignalRef<ThinkingLevel>
	displayContextWindow: SignalRef<number>
	contextTokens: SignalRef<number>
	cacheStats: SignalRef<{ cacheRead: number; input: number } | null>
	retryStatus: SignalRef<string | null>
	turnCount: SignalRef<number>
	lspActive: SignalRef<boolean>
	queueCounts: SignalRef<QueueCounts>
	currentProvider: SignalRef<KnownProvider>
}

export interface AppStoreConfig {
	initialTheme: string
	initialModelId: string
	initialThinking: ThinkingLevel
	initialContextWindow: number
	initialProvider: KnownProvider
}

export const createAppStore = (config: AppStoreConfig): AppStore => {
	return {
		theme: createSignalRef(config.initialTheme),
		messages: createSignalRef<UIMessage[]>([]),
		toolBlocks: createSignalRef<ToolBlock[]>([]),
		isResponding: createSignalRef(false),
		activityState: createSignalRef<ActivityState>("idle"),
		thinkingVisible: createSignalRef(true),
		diffWrapMode: createSignalRef<"word" | "none">("word"),
		concealMarkdown: createSignalRef(true),
		displayModelId: createSignalRef(config.initialModelId),
		displayThinking: createSignalRef<ThinkingLevel>(config.initialThinking),
		displayContextWindow: createSignalRef(config.initialContextWindow),
		contextTokens: createSignalRef(0),
		cacheStats: createSignalRef<{ cacheRead: number; input: number } | null>(null),
		retryStatus: createSignalRef<string | null>(null),
		turnCount: createSignalRef(0),
		lspActive: createSignalRef(false),
		queueCounts: createSignalRef<QueueCounts>({ steer: 0, followUp: 0 }),
		currentProvider: createSignalRef(config.initialProvider),
	}
}

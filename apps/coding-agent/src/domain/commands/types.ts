import type { Agent, ThinkingLevel } from "@yeshwanthyk/agent-core"
import type { CodexTransport } from "@yeshwanthyk/agent-core"
import type { Api, Model, KnownProvider } from "@yeshwanthyk/ai"
import type { SessionManager } from "../../session-manager.js"
import type { ActivityState, ToolBlock, UIMessage } from "../../types.js"
import type { EditorConfig } from "../../config.js"
import type { HookRunner } from "../../hooks/index.js"
import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import type { PromptSubmitOptions } from "@yeshwanthyk/runtime-effect/session/orchestrator.js"

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"]

export interface CommandContext {
	agent: Agent
	sessionManager: SessionManager
	configDir: string
	configPath: string
	cwd: string
	editor?: EditorConfig
	codexTransport: CodexTransport
	getApiKey: (provider: string) => string | undefined

	currentProvider: KnownProvider
	currentModelId: string
	currentThinking: ThinkingLevel

	setCurrentProvider: (provider: KnownProvider) => void
	setCurrentModelId: (modelId: string) => void
	setCurrentThinking: (thinking: ThinkingLevel) => void

	isResponding: () => boolean
	setIsResponding: (value: boolean) => void
	setActivityState: (state: ActivityState) => void
	setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void
	setToolBlocks: (updater: (prev: ToolBlock[]) => ToolBlock[]) => void
	setContextTokens: (value: number) => void
	setCacheStats: (value: { cacheRead: number; input: number } | null) => void

	setDisplayModelId: (modelId: string) => void
	setDisplayThinking: (thinking: ThinkingLevel) => void
	setDisplayContextWindow: (tokens: number) => void

	setTheme?: (name: string) => void
	launchEditor?: (command: string, args: string[], cwd: string, onError: (error: Error) => void) => void
	openEditor?: () => Promise<void> | void
	clearEditor?: () => void
	switchSession?: (sessionPath: string) => Promise<boolean>
	showSelect?: (title: string, options: string[]) => Promise<string | undefined>

	onExit?: () => void
	hookRunner?: HookRunner
	submitPrompt: (text: string, options?: PromptSubmitOptions) => Promise<void>
	steer: (text: string) => Promise<void>
	followUp: (text: string) => Promise<void>
	sendUserMessage: (text: string, options?: { deliverAs?: PromptDeliveryMode }) => Promise<void>
}

export type CommandHandlerResult = boolean | Promise<boolean>

export interface CommandDefinition {
	name: string
	aliases?: string[]
	description?: string
	execute: (args: string, ctx: CommandContext) => CommandHandlerResult
}

export type CommandHandler = CommandDefinition["execute"]

export type ModelResolver = (provider: KnownProvider, modelId: string) => Model<Api> | undefined

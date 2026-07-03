/**
 * ACP Session - wraps Agent and emits ACP updates
 */

import type { Agent, AgentEvent, Attachment } from "@yeshwanthyk/agent-core"
import type { UpdateEmitter } from "./updates.js"
import type { ContentBlock, SlashCommand, ModelOption, StopReason } from "./protocol.js"
import { textChunk, thoughtChunk, toolCall, toolCallUpdate, toolNameToKind } from "./updates.js"
import type { SessionOrchestratorService } from "@yeshwanthyk/runtime-effect/session/orchestrator.js"
import { Effect } from "effect"
import { extractStreamingSnapshot } from "@domain/messaging/content.js"

export interface AcpSessionConfig {
	sessionId: string
	cwd: string
	agent: Agent
	sessionOrchestrator: SessionOrchestratorService
	emitter: UpdateEmitter
	models: ModelOption[]
	currentModelId: string
	contextWindow: number
	thinkingLevel: string
	setModel: (modelId: string) => boolean
}

export interface AcpSession {
	id: string
	cwd: string
	prompt(content: ContentBlock[]): Promise<StopReason>
	cancel(): void
	getAvailableCommands(): SlashCommand[]
	getModels(): { options: ModelOption[]; currentModelId: string }
	setModel(modelId: string): boolean
}

// Slash commands exposed to Zed
const AVAILABLE_COMMANDS: SlashCommand[] = [
	{ name: "model", description: "Switch model: /model <modelId>" },
	{ name: "thinking", description: "Set thinking: /thinking off|minimal|low|medium|high|xhigh" },
	{ name: "status", description: "Show session status" },
	{ name: "compact", description: "Compact conversation context" },
	{ name: "clear", description: "Clear conversation" },
]

interface AcpStreamingState {
	textLength: number
	thinkingLength: number
}

interface AcpStreamingDelta {
	text: string
	thinking: string
	next: AcpStreamingState
}

const ACP_FULL_TEXT_TAIL_CHARS = Number.MAX_SAFE_INTEGER

const emptyAcpStreamingState = (): AcpStreamingState => ({
	textLength: 0,
	thinkingLength: 0,
})

export function projectAcpStreamingDelta(content: unknown[], previous: AcpStreamingState): AcpStreamingDelta {
	const snapshot = extractStreamingSnapshot(content, ACP_FULL_TEXT_TAIL_CHARS)
	const fullText = snapshot.textTail
	const fullThinking = snapshot.thinking?.full ?? ""
	const next: AcpStreamingState = { ...previous }
	const text = snapshot.textLength > previous.textLength ? fullText.slice(previous.textLength) : ""
	const thinking = fullThinking.length > previous.thinkingLength ? fullThinking.slice(previous.thinkingLength) : ""

	if (text) next.textLength = snapshot.textLength
	if (thinking) next.thinkingLength = fullThinking.length

	return { text, thinking, next }
}

export function createAcpSession(config: AcpSessionConfig): AcpSession {
	const { sessionId, cwd, agent, emitter, models, contextWindow, sessionOrchestrator } = config
	let currentModelId = config.currentModelId
	let thinkingLevel = config.thinkingLevel
	let cancelled = false
	let unsubscribe: (() => void) | null = null

	// Track session stats
	let turnCount = 0
	let lastUsage: { totalTokens: number; cacheRead?: number; cacheWrite?: number } | null = null

	// Track emitted content to avoid duplicate chunks
	let streamingState = emptyAcpStreamingState()

	// Subscribe to agent events and emit ACP updates
	function subscribeToEvents(): () => void {
		streamingState = emptyAcpStreamingState()

		return agent.subscribe((event: AgentEvent) => {
			if (cancelled) return

			switch (event.type) {
				case "message_update":
					if (event.message.role === "assistant") {
						const content = Array.isArray(event.message.content) ? event.message.content : []
						const delta = projectAcpStreamingDelta(content, streamingState)
						streamingState = delta.next
						if (delta.text) emitter.emit(textChunk(delta.text))
						if (delta.thinking) emitter.emit(thoughtChunk(delta.thinking))
					}
					break

				case "tool_execution_start":
					emitter.emit(
						toolCall(
							event.toolCallId,
							event.toolName,
							toolNameToKind(event.toolName),
							event.args
						)
					)
					break

				case "tool_execution_update":
					emitter.emit(
						toolCallUpdate(
							event.toolCallId,
							"in_progress",
							event.partialResult ? JSON.stringify(event.partialResult) : undefined
						)
					)
					break

				case "tool_execution_end":
					emitter.emit(
						toolCallUpdate(
							event.toolCallId,
							event.isError ? "failed" : "completed",
							event.result ? JSON.stringify(event.result) : undefined
						)
					)
					break

				case "message_end":
					// Capture usage from assistant messages
					if (event.message.role === "assistant") {
						const msg = event.message as { usage?: { totalTokens?: number; cacheRead?: number; cacheWrite?: number } }
						if (msg.usage?.totalTokens) {
							lastUsage = {
								totalTokens: msg.usage.totalTokens,
								cacheRead: msg.usage.cacheRead,
								cacheWrite: msg.usage.cacheWrite,
							}
						}
					}
					break
			}
		})
	}

	async function prompt(content: ContentBlock[]): Promise<StopReason> {
		cancelled = false
		turnCount++
		unsubscribe = subscribeToEvents()

		try {
			// Check for slash command
			const firstText = content.find((b) => b.type === "text")?.text?.trim()
			if (firstText?.startsWith("/")) {
				return handleSlashCommand(firstText)
			}

			// Extract text and images
			let textContent = ""
			const images: Array<{ data: string; mimeType: string }> = []

			for (const block of content) {
				if (block.type === "text" && block.text) {
					textContent += block.text
				} else if (block.type === "image" && block.data && block.mimeType) {
					images.push({ data: block.data, mimeType: block.mimeType })
				}
			}

			if (!textContent && images.length === 0) {
				return "end_turn"
			}

			// Convert images to attachment format
			const attachments: Attachment[] = images.map((img, idx) => ({
				id: `acp-img-${idx}`,
				type: "image",
				content: img.data,
				mimeType: img.mimeType,
				fileName: `image-${idx}`,
				size: Math.ceil(img.data.length * 0.75),
			}))

			await Effect.runPromise(
				sessionOrchestrator.submitPromptAndWait(textContent, {
					mode: "followUp",
					attachments: attachments.length > 0 ? attachments : undefined,
				}),
			)

			return cancelled ? "cancelled" : "end_turn"
		} finally {
			unsubscribe?.()
			unsubscribe = null
		}
	}

	function handleSlashCommand(line: string): StopReason {
		const parts = line.slice(1).split(/\s+/)
		const cmd = parts[0]?.toLowerCase()
		const args = parts.slice(1).join(" ")

		switch (cmd) {
			case "model":
				if (args && setModel(args)) {
					emitter.emit(textChunk(`Model switched to ${args}`))
				} else if (args) {
					emitter.emit(textChunk(`Unknown model: ${args}. Available: ${models.map((m) => m.modelId).join(", ")}`))
				} else {
					emitter.emit(textChunk(`Current model: ${currentModelId}\nAvailable: ${models.map((m) => m.modelId).join(", ")}`))
				}
				break

			case "thinking": {
				const levels = ["off", "minimal", "low", "medium", "high", "xhigh"]
				if (levels.includes(args)) {
					agent.setThinkingLevel(args as "off" | "minimal" | "low" | "medium" | "high" | "xhigh")
					thinkingLevel = args
					emitter.emit(textChunk(`Thinking level set to ${args}`))
				} else {
					emitter.emit(textChunk(`Invalid thinking level. Use: ${levels.join(", ")}`))
				}
				break
			}

			case "status": {
				const provider = currentModelId.includes("/") ? currentModelId.split("/")[0] : "anthropic"
				const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
				let ctx = `0/${fmt(contextWindow)}`
				let cache = ""
				if (lastUsage && contextWindow > 0) {
					const pct = ((lastUsage.totalTokens / contextWindow) * 100).toFixed(1)
					ctx = `${fmt(lastUsage.totalTokens)}/${fmt(contextWindow)} (${pct}%)`
					if (lastUsage.cacheRead) cache = ` | cache: ${fmt(lastUsage.cacheRead)} read`
				}
				const status = `${currentModelId} (${provider}) | ${thinkingLevel} | ${ctx}${cache} | turns: ${turnCount}`
				emitter.emit(textChunk(status))
				break
			}

			case "clear":
				agent.reset()
				emitter.emit(textChunk("Conversation cleared"))
				break

			case "compact":
				emitter.emit(textChunk("Compact not yet implemented in ACP mode"))
				break

			default:
				emitter.emit(textChunk(`Unknown command: /${cmd}`))
		}

		return "end_turn"
	}

	function cancel(): void {
		cancelled = true
		agent.abort()
	}

	function getAvailableCommands(): SlashCommand[] {
		return AVAILABLE_COMMANDS
	}

	function getModels(): { options: ModelOption[]; currentModelId: string } {
		return { options: models, currentModelId }
	}

	function setModel(modelId: string): boolean {
		const success = config.setModel(modelId)
		if (success) {
			currentModelId = modelId
			emitter.emitModels(models, currentModelId)
		}
		return success
	}

	return {
		id: sessionId,
		cwd,
		prompt,
		cancel,
		getAvailableCommands,
		getModels,
		setModel,
	}
}

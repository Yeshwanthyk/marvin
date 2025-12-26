/**
 * ACP Session - wraps Agent and emits ACP updates
 */

import type { Agent, AgentEvent } from "@marvin-agents/agent-core"
import type { UpdateEmitter } from "./updates.js"
import type { ContentBlock, SlashCommand, ModelOption, StopReason } from "./protocol.js"
import { textChunk, thoughtChunk, toolCall, toolCallUpdate, toolNameToKind } from "./updates.js"

export interface AcpSessionConfig {
	sessionId: string
	cwd: string
	agent: Agent
	emitter: UpdateEmitter
	models: ModelOption[]
	currentModelId: string
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
	{ name: "compact", description: "Compact conversation context" },
	{ name: "clear", description: "Clear conversation" },
]

export function createAcpSession(config: AcpSessionConfig): AcpSession {
	const { sessionId, cwd, agent, emitter, models } = config
	let currentModelId = config.currentModelId
	let cancelled = false
	let unsubscribe: (() => void) | null = null

	// Track emitted content to avoid duplicate chunks
	let lastEmittedTextLen = 0
	let lastEmittedThinkingLen = 0

	// Subscribe to agent events and emit ACP updates
	function subscribeToEvents(): () => void {
		lastEmittedTextLen = 0
		lastEmittedThinkingLen = 0

		return agent.subscribe((event: AgentEvent) => {
			if (cancelled) return

			switch (event.type) {
				case "message_update":
					if (event.message.role === "assistant") {
						// Extract text and thinking from content
						const content = event.message.content as unknown[]
						let totalText = ""
						let totalThinking = ""

						for (const block of content) {
							if (typeof block !== "object" || block === null) continue
							const b = block as Record<string, unknown>
							if (b.type === "text" && typeof b.text === "string") {
								totalText += b.text
							} else if (b.type === "thinking" && typeof b.thinking === "string") {
								totalThinking += b.thinking
							}
						}

						// Emit only new content (delta)
						if (totalText.length > lastEmittedTextLen) {
							const delta = totalText.slice(lastEmittedTextLen)
							lastEmittedTextLen = totalText.length
							emitter.emit(textChunk(delta))
						}
						if (totalThinking.length > lastEmittedThinkingLen) {
							const delta = totalThinking.slice(lastEmittedThinkingLen)
							lastEmittedThinkingLen = totalThinking.length
							emitter.emit(thoughtChunk(delta))
						}
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
			}
		})
	}

	async function prompt(content: ContentBlock[]): Promise<StopReason> {
		cancelled = false
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

			// Convert images to attachments format
			const attachments = images.map((img, idx) => ({
				id: `acp-img-${idx}`,
				type: "image" as const,
				content: img.data,
				mimeType: img.mimeType,
				fileName: `image-${idx}`,
				size: Math.ceil(img.data.length * 0.75), // Approximate decoded size
			}))

			// Send to agent
			await agent.prompt(textContent, attachments.length > 0 ? attachments : undefined)

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
					emitter.emit(textChunk(`Thinking level set to ${args}`))
				} else {
					emitter.emit(textChunk(`Invalid thinking level. Use: ${levels.join(", ")}`))
				}
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

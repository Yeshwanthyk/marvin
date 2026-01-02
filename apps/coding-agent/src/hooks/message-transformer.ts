import type { UserMessageWithAttachments } from "@marvin-agents/agent-core"
import type { Message, TextContent, ImageContent } from "@marvin-agents/ai"
import type { HookRunner } from "./runner.js"
import type { MessagePart } from "./types.js"

interface HookMessageLike {
	role: "hookMessage"
	content: string | MessagePart[]
	timestamp: number
}

interface MessageLike {
	role: string
	content?: unknown
	timestamp?: number
}

/**
 * Transform app messages to LLM-compatible messages.
 * - Converts hook messages to user messages
 * - Handles attachments (images, documents)
 * - Applies chat.messages.transform hook
 */
export async function transformMessages(
	hookRunner: HookRunner,
	messages: MessageLike[]
): Promise<Message[]> {
	const llmMessages: Message[] = []

	for (const message of messages) {
		if (message.role === "hookMessage") {
			const hookMsg = message as HookMessageLike
			const content = typeof hookMsg.content === "string"
				? [{ type: "text" as const, text: hookMsg.content }]
				: hookMsg.content
			llmMessages.push({ role: "user", content, timestamp: hookMsg.timestamp })
			continue
		}

		if (message.role === "user") {
			const userMessage = message as UserMessageWithAttachments
			const { attachments, ...rest } = userMessage
			if (!attachments || attachments.length === 0) {
				llmMessages.push(rest as Message)
				continue
			}

			const content: (TextContent | ImageContent)[] = Array.isArray(rest.content)
				? [...rest.content]
				: [{ type: "text", text: rest.content as string }]

			for (const attachment of attachments) {
				if (attachment.type === "image") {
					content.push({ type: "image", data: attachment.content, mimeType: attachment.mimeType })
				} else if (attachment.type === "document" && attachment.extractedText) {
					content.push({ type: "text", text: `\n\n[Document: ${attachment.fileName}]\n${attachment.extractedText}` })
				}
			}

			llmMessages.push({ ...rest, content } as Message)
			continue
		}

		if (message.role === "assistant" || message.role === "toolResult") {
			llmMessages.push(message as Message)
		}
	}

	// Apply hook transforms
	return hookRunner.emitContext(llmMessages)
}

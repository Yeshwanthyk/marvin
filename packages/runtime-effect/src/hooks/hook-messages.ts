import type { HookMessage } from "./types.js"
import type { TextContent } from "@marvin-agents/ai"

/**
 * Create a HookMessage with current timestamp.
 */
export function createHookMessage<T = unknown>(
	input: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">
): HookMessage<T> {
	const message: HookMessage<T> = {
		role: "hookMessage",
		customType: input.customType,
		content: input.content,
		display: input.display,
		timestamp: Date.now(),
	}

	if (input.details !== undefined) {
		message.details = input.details
	}

	return message
}

/**
 * Extract text content from a HookMessage.
 */
export function hookMessageToText(message: HookMessage): string {
	if (typeof message.content === "string") return message.content
	const parts = message.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
	return parts.join("\n")
}

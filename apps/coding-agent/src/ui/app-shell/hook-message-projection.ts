import type { UIMessage } from "../../types.js"
import { createHookMessage } from "@yeshwanthyk/runtime-effect/hooks/index.js"

export type CreatedHookMessage = ReturnType<typeof createHookMessage>

export const hookMessageToUiMessage = (hookMessage: CreatedHookMessage): UIMessage => ({
	id: crypto.randomUUID(),
	role: "assistant",
	content:
		typeof hookMessage.content === "string"
			? hookMessage.content
			: hookMessage.content.map((part) => (part.type === "text" ? part.text : "[image]")).join(""),
	timestamp: hookMessage.timestamp,
})

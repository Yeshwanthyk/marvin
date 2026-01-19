import type { AppMessage } from "@yeshwanthyk/agent-core"
import type { AssistantMessage, TextContent, ToolCall } from "@yeshwanthyk/ai"
import type { RuntimeServices } from "@yeshwanthyk/runtime-effect/runtime.js"
import { isRecord } from "./internal.js"
import type { SdkResult, StopReason } from "./types.js"

const isAssistantMessage = (value: unknown): value is AssistantMessage => {
  if (!isRecord(value)) return false
  if (value["role"] !== "assistant") return false
  return Array.isArray(value["content"])
}

const isTextContent = (value: unknown): value is TextContent => {
  if (!isRecord(value)) return false
  if (value["type"] !== "text") return false
  return typeof value["text"] === "string"
}

const isToolCall = (value: unknown): value is ToolCall => {
  if (!isRecord(value)) return false
  if (value["type"] !== "toolCall") return false
  if (typeof value["id"] !== "string") return false
  if (typeof value["name"] !== "string") return false
  return isRecord(value["arguments"])
}

const lastAssistantMessage = (messages: AppMessage[]): AssistantMessage | undefined => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (isAssistantMessage(msg)) return msg
  }
  return undefined
}

const extractAssistantText = (message: AssistantMessage): string => {
  const parts: string[] = []
  for (const part of message.content) {
    if (isTextContent(part)) {
      parts.push(part.text)
    }
  }
  return parts.join("")
}

const extractToolCalls = (message: AssistantMessage): ToolCall[] => {
  const calls: ToolCall[] = []
  for (const part of message.content) {
    if (isToolCall(part)) calls.push(part)
  }
  return calls
}

const deriveStopReason = (message: AssistantMessage | undefined): StopReason => {
  if (!message) return "error"
  const reason = (message as { stopReason?: string }).stopReason
  if (reason === "aborted") return "aborted"
  if (reason === "maxTokens") return "maxTokens"
  if (reason === "error") return "error"
  return "complete"
}

export const buildSdkResult = (runtime: RuntimeServices, startTime: number): SdkResult => {
  const messages = runtime.agent.state.messages.slice()
  const assistant = lastAssistantMessage(messages)
  const durationMs = Date.now() - startTime
  const stopReason = deriveStopReason(assistant)

  const result: SdkResult = {
    text: assistant ? extractAssistantText(assistant) : "",
    messages,
    toolCalls: assistant ? extractToolCalls(assistant) : [],
    provider: runtime.config.provider,
    model: runtime.config.modelId,
    sessionId: runtime.sessionManager.sessionId,
    stopReason,
    durationMs,
  }
  if (assistant?.usage) {
    result.usage = assistant.usage
  }
  return result
}

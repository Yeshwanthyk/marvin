import type { Effect } from "effect"
import type { AgentEvent, AppMessage, Attachment, ThinkingLevel } from "@marvin-agents/agent-core"
import type { ToolCall, Usage } from "@marvin-agents/ai"
import type { LoadConfigOptions } from "@marvin-agents/runtime-effect/config.js"
import type { InstrumentationEvent } from "@marvin-agents/runtime-effect/instrumentation.js"
import type { HookMessage } from "@marvin-agents/runtime-effect/hooks/types.js"
import type { PromptDeliveryMode, PromptQueueSnapshot } from "@marvin-agents/runtime-effect/session/prompt-queue.js"
import type { SdkError } from "./errors.js"

export interface SdkResult {
  text: string
  messages: AppMessage[]
  toolCalls: ToolCall[]
  usage?: Usage
  provider: string
  model: string
  sessionId: string | null
}

export interface SdkSessionSnapshot {
  sessionId: string | null
  provider: string
  model: string
  thinking: ThinkingLevel
  messages: AppMessage[]
  queue: PromptQueueSnapshot
}

export type SdkEvent =
  | { type: "agent"; event: AgentEvent }
  | { type: "hookMessage"; message: HookMessage }
  | { type: "instrumentation"; event: InstrumentationEvent }

export interface SdkBaseOptions extends LoadConfigOptions {
  instrumentation?: (event: InstrumentationEvent) => void
}

export interface RunAgentOptions extends SdkBaseOptions {
  prompt: string
  mode?: PromptDeliveryMode
  attachments?: Attachment[]
}

export interface RunAgentStreamOptions extends RunAgentOptions {}

export interface SdkSessionOptions extends SdkBaseOptions {}

type SdkEffect<T> = Effect.Effect<T, SdkError>

export interface SdkSession<
  Chat = SdkEffect<SdkResult>,
  Snapshot = SdkEffect<SdkSessionSnapshot>,
  Drain = SdkEffect<string | null>,
  Close = Effect.Effect<void>
> {
  chat: (text: string, options?: { mode?: PromptDeliveryMode; attachments?: Attachment[] }) => Chat
  snapshot: () => Snapshot
  drainQueue: () => Drain
  close: () => Close
}

export type SdkSessionEffect = SdkSession
export type SdkSessionPromise = SdkSession<
  Promise<SdkResult>,
  Promise<SdkSessionSnapshot>,
  Promise<string | null>,
  Promise<void>
>

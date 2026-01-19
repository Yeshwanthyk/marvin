import type { Effect } from "effect"
import type { AgentEvent, AppMessage, Attachment, ThinkingLevel } from "@yeshwanthyk/agent-core"
import type { ToolCall, Usage } from "@yeshwanthyk/ai"
import type { LoadConfigOptions, LoadedAppConfig } from "@yeshwanthyk/runtime-effect/config.js"
import type { InstrumentationEvent } from "@yeshwanthyk/runtime-effect/instrumentation.js"
import type { HookMessage } from "@yeshwanthyk/runtime-effect/hooks/types.js"
import type { PromptDeliveryMode, PromptQueueSnapshot } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import type { ApiKeyResolver, TransportBundle } from "@yeshwanthyk/runtime-effect/transports.js"
import type { SdkError } from "./errors.js"

export type StopReason = "complete" | "maxTokens" | "aborted" | "error"

export interface SdkResult {
  text: string
  messages: AppMessage[]
  toolCalls: ToolCall[]
  usage?: Usage
  provider: string
  model: string
  sessionId: string | null
  stopReason: StopReason
  durationMs: number
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

export type TransportFactory = (config: LoadedAppConfig, resolver: ApiKeyResolver) => TransportBundle

export interface SdkBaseOptions extends LoadConfigOptions {
  instrumentation?: (event: InstrumentationEvent) => void
  transportFactory?: TransportFactory
  maxTokens?: number
  temperature?: number
}

export interface RunAgentOptions extends SdkBaseOptions {
  prompt: string
  mode?: PromptDeliveryMode
  attachments?: Attachment[]
  signal?: AbortSignal
}

export interface RunAgentStreamOptions extends RunAgentOptions {}

export interface SdkSessionOptions extends SdkBaseOptions {}

type SdkEffect<T> = Effect.Effect<T, SdkError>

export interface SdkSession<
  Chat = SdkEffect<SdkResult>,
  Snapshot = SdkEffect<SdkSessionSnapshot>,
  Drain = SdkEffect<string | null>,
  Close = Effect.Effect<void>,
  Abort = Effect.Effect<void>
> {
  chat: (text: string, options?: { mode?: PromptDeliveryMode; attachments?: Attachment[]; signal?: AbortSignal }) => Chat
  snapshot: () => Snapshot
  drainQueue: () => Drain
  abort: () => Abort
  close: () => Close
}

export type SdkSessionEffect = SdkSession
export type SdkSessionPromise = SdkSession<
  Promise<SdkResult>,
  Promise<SdkSessionSnapshot>,
  Promise<string | null>,
  Promise<void>,
  void
>

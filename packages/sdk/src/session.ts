import { Effect } from "effect"
import type { SdkError } from "./errors.js"
import { toSdkError } from "./errors.js"
import type { Attachment } from "@marvin-agents/agent-core"
import type { PromptDeliveryMode } from "@marvin-agents/runtime-effect/session/prompt-queue.js"
import { buildSdkResult } from "./sdk-result.js"
import { createSdkRuntime } from "./runtime.js"
import type { SdkSessionEffect, SdkSessionOptions, SdkSessionPromise, SdkSessionSnapshot } from "./types.js"

const buildSnapshot = (
  services: {
    agent: { state: { messages: SdkSessionSnapshot["messages"] } }
    sessionManager: { sessionId: string | null }
    config: { provider: string; modelId: string; thinking: SdkSessionSnapshot["thinking"] }
  },
  queue: SdkSessionSnapshot["queue"],
): SdkSessionSnapshot => ({
  sessionId: services.sessionManager.sessionId,
  provider: services.config.provider,
  model: services.config.modelId,
  thinking: services.config.thinking,
  messages: services.agent.state.messages.slice(),
  queue,
})

export const createAgentSessionEffect: (
  options: SdkSessionOptions,
) => Effect.Effect<SdkSessionEffect, SdkError> = Effect.fn(function* (
  options: SdkSessionOptions,
) {
    const runtime = yield* createSdkRuntime(options)

    const chat = (text: string, promptOptions?: { mode?: PromptDeliveryMode; attachments?: Attachment[] }) => {
      const chatOptions: { mode?: PromptDeliveryMode; attachments?: Attachment[] } = {}
      if (promptOptions?.mode !== undefined) chatOptions.mode = promptOptions.mode
      if (promptOptions?.attachments !== undefined) chatOptions.attachments = promptOptions.attachments
      return runtime.submitPromptAndWait(text, chatOptions).pipe(Effect.map(() => buildSdkResult(runtime.services)))
    }

    const snapshot = () =>
      runtime.services.sessionOrchestrator.snapshot.pipe(
        Effect.map((queue) => buildSnapshot(runtime.services, queue)),
      )

    const drainQueue = () => runtime.services.sessionOrchestrator.drainToScript

    const close = () => runtime.close

    return { chat, snapshot, drainQueue, close } satisfies SdkSessionEffect
  })

export const createAgentSession = async (options: SdkSessionOptions): Promise<SdkSessionPromise> => {
  try {
    const session = await Effect.runPromise(createAgentSessionEffect(options))
    return {
      chat: (text, promptOptions) => Effect.runPromise(session.chat(text, promptOptions)),
      snapshot: () => Effect.runPromise(session.snapshot()),
      drainQueue: () => Effect.runPromise(session.drainQueue()),
      close: () => Effect.runPromise(session.close()),
    }
  } catch (error) {
    return Promise.reject(toSdkError(error))
  }
}

import { Effect } from "effect"
import type { SdkError } from "./errors.js"
import { toSdkError } from "./errors.js"
import { err, ok, type Result } from "./result.js"
import type { Attachment } from "@yeshwanthyk/agent-core"
import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import { buildSdkResult } from "./sdk-result.js"
import { createSdkRuntime } from "./runtime.js"
import type { RunAgentOptions, SdkResult } from "./types.js"

export const runAgentEffect = (options: RunAgentOptions): Effect.Effect<SdkResult, SdkError> =>
  createSdkRuntime(options).pipe(
    Effect.flatMap((runtime) => {
      const promptOptions: { mode?: PromptDeliveryMode; attachments?: Attachment[] } = {}
      if (options.mode !== undefined) promptOptions.mode = options.mode
      if (options.attachments !== undefined) promptOptions.attachments = options.attachments

      return runtime.submitPromptAndWait(options.prompt, promptOptions).pipe(
        Effect.map(() => buildSdkResult(runtime.services)),
        Effect.ensuring(runtime.close),
      )
    }),
  )

export const runAgent = async (options: RunAgentOptions): Promise<Result<SdkResult, SdkError>> => {
  try {
    const value = await Effect.runPromise(runAgentEffect(options))
    return ok(value)
  } catch (error) {
    return err(toSdkError(error))
  }
}

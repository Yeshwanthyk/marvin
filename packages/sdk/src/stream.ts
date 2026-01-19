import { Effect, Stream } from "effect"
import type { Attachment } from "@yeshwanthyk/agent-core"
import type { InstrumentationEvent } from "@yeshwanthyk/runtime-effect/instrumentation.js"
import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import { createSdkRuntime } from "./runtime.js"
import type { SdkError } from "./errors.js"
import type { RunAgentStreamOptions, SdkEvent } from "./types.js"

/**
 * Stream variant for Effect users. Provides backpressure and composition.
 *
 * @example
 * ```typescript
 * import { Stream, Effect } from "effect"
 *
 * // Take first 10 events
 * const limited = runAgentStreamEffect(opts).pipe(Stream.take(10))
 *
 * // Collect all events
 * const events = await Effect.runPromise(Stream.runCollect(runAgentStreamEffect(opts)))
 *
 * // With timeout
 * const withTimeout = runAgentStreamEffect(opts).pipe(
 *   Stream.timeout(Duration.seconds(30))
 * )
 * ```
 */
export const runAgentStreamEffect = (
  options: RunAgentStreamOptions,
): Stream.Stream<SdkEvent, SdkError> =>
  Stream.asyncPush<SdkEvent, SdkError>((emit) =>
    Effect.gen(function* () {
      const runtime = yield* createSdkRuntime({
        ...options,
        hookMessageSink: (message) => {
          emit.single({ type: "hookMessage", message })
        },
        instrumentationSink: (event: InstrumentationEvent) => {
          emit.single({ type: "instrumentation", event })
        },
      })

      const unsubscribe = runtime.services.agent.subscribe((event) => {
        emit.single({ type: "agent", event })
      })

      const promptOptions: { mode?: PromptDeliveryMode; attachments?: Attachment[] } = {}
      if (options.mode !== undefined) promptOptions.mode = options.mode
      if (options.attachments !== undefined) promptOptions.attachments = options.attachments

      yield* runtime.submitPromptAndWait(options.prompt, promptOptions).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.sync(() => emit.fail(error)),
          onSuccess: () => Effect.sync(() => emit.end()),
        }),
        Effect.ensuring(Effect.sync(() => unsubscribe())),
        Effect.ensuring(runtime.close),
      )
    }),
  )

/**
 * Streaming async iterable for standard JavaScript consumers.
 */
export const runAgentStream = (options: RunAgentStreamOptions): AsyncIterable<SdkEvent> =>
  Stream.toAsyncIterable(runAgentStreamEffect(options))

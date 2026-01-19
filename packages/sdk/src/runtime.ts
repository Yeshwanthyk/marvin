import { Context, Effect, Exit, Layer, Scope } from "effect"
import type { Attachment } from "@yeshwanthyk/agent-core"
import type { LoadConfigOptions, LspConfig } from "@yeshwanthyk/runtime-effect/config.js"
import type { BeforeAgentStartResult, HookMessage } from "@yeshwanthyk/runtime-effect/hooks/types.js"
import { createHookMessage, hookMessageToText } from "@yeshwanthyk/runtime-effect/hooks/hook-messages.js"
import type { InstrumentationEvent, InstrumentationService } from "@yeshwanthyk/runtime-effect/instrumentation.js"
import type { PromptDeliveryMode } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import type { SendRef } from "@yeshwanthyk/runtime-effect/extensibility/custom-tools/types.js"
import {
  RuntimeLayer,
  RuntimeServicesTag,
  type RuntimeLayerOptions,
  type RuntimeServices,
} from "@yeshwanthyk/runtime-effect/runtime.js"
import type { SdkError } from "./errors.js"
import { toSdkError } from "./errors.js"
import type { TransportFactory } from "./types.js"

export interface SdkRuntimeOptions extends LoadConfigOptions {
  instrumentation?: (event: InstrumentationEvent) => void
  instrumentationSink?: (event: InstrumentationEvent) => void
  hookMessageSink?: (message: HookMessage) => void
  transportFactory?: TransportFactory
}

export interface PromptOptions {
  mode?: PromptDeliveryMode
  attachments?: Attachment[]
}

export interface SdkRuntime {
  services: RuntimeServices
  close: Effect.Effect<void>
  submitPrompt: (text: string, options?: PromptOptions) => Effect.Effect<void, SdkError>
  submitPromptAndWait: (text: string, options?: PromptOptions) => Effect.Effect<void, SdkError>
}

const defaultLspConfig = (): LspConfig => ({ enabled: false, autoInstall: false })

const normalizePrompt = (text: string): string | null => {
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

const createInstrumentationService = (options: SdkRuntimeOptions): InstrumentationService => ({
  record: (event: InstrumentationEvent) => {
    options.instrumentation?.(event)
    options.instrumentationSink?.(event)
  },
})

const emitHookMessage = (sink: SdkRuntimeOptions["hookMessageSink"], message: HookMessage): void => {
  if (!sink) return
  sink(message)
}

const prepareHookMessage = (
  sink: SdkRuntimeOptions["hookMessageSink"],
  input: HookMessage | null | undefined,
): void => {
  if (!input) return
  if (!input.display) return
  emitHookMessage(sink, input)
}

const createHookHandlers = (
  runtime: RuntimeServices,
  sendRef: SendRef,
  hookMessageSink: SdkRuntimeOptions["hookMessageSink"],
  submitPromptEffect: (text: string, options?: PromptOptions, wait?: boolean) => Effect.Effect<void, SdkError>,
): void => {
  const fireAndForget = (effect: Effect.Effect<void, SdkError>) => {
    void Effect.runPromise(effect).catch(() => {})
  }

  const sendHandler = (text: string) => {
    fireAndForget(submitPromptEffect(text, { mode: "followUp" }, false))
  }

  const steerHandler = (text: string) => {
    fireAndForget(submitPromptEffect(text, { mode: "steer" }, false))
  }

  const followUpHandler = (text: string) => {
    fireAndForget(submitPromptEffect(text, { mode: "followUp" }, false))
  }

  const sendUserMessageHandler = (text: string, options?: { deliverAs?: PromptDeliveryMode }) => {
    const mode = options?.deliverAs ?? "followUp"
    return Effect.runPromise(submitPromptEffect(text, { mode }, false))
  }

  const sendMessageHandler = <T = unknown>(
    message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
    triggerTurn?: boolean,
  ) => {
    const hookMessage = createHookMessage(message)
    if (hookMessage.display) {
      emitHookMessage(hookMessageSink, hookMessage)
    }
    if (triggerTurn) {
      const text = hookMessageToText(hookMessage)
      fireAndForget(submitPromptEffect(text, { mode: "followUp" }, false))
    }
  }

  runtime.hookRunner.initialize({
    sendHandler,
    sendMessageHandler,
    sendUserMessageHandler,
    steerHandler,
    followUpHandler,
    isIdleHandler: () => !runtime.agent.state.isStreaming,
    appendEntryHandler: (customType: string, data?: unknown) =>
      runtime.sessionManager.appendEntry(customType, data),
    getSessionId: () => runtime.sessionManager.sessionId,
    getModel: () => runtime.agent.state.model,
    hasUI: false,
  })

  sendRef.current = sendHandler
}

const createSdkRuntimeImpl = Effect.fn(function* (options: SdkRuntimeOptions) {
    const sendRef: SendRef = { current: () => {} }
    const lsp = options.lsp ?? defaultLspConfig()

    const runtimeOptions: RuntimeLayerOptions = {
      adapter: "headless",
      hasUI: false,
      sendRef,
      instrumentation: createInstrumentationService(options),
      lsp,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.configDir !== undefined ? { configDir: options.configDir } : {}),
      ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
      ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      ...(options.transportFactory !== undefined ? { transportFactory: options.transportFactory } : {}),
    }

    const layer = RuntimeLayer(runtimeOptions)

    const scope = yield* Scope.make()
    const context = yield* Layer.buildWithScope(layer, scope)
    const services: RuntimeServices = Context.get(context, RuntimeServicesTag)

    if (options.systemPrompt !== undefined) {
      services.agent.setSystemPrompt(services.config.systemPrompt)
    }

    const close = Effect.suspend(() => Scope.close(scope, Exit.void))

    const submitPromptEffect = Effect.fn(function* (
      text: string,
      promptOptions?: PromptOptions,
      wait = false,
    ) {
        const prompt = normalizePrompt(text)
        if (!prompt) {
          return yield* Effect.fail(toSdkError("Empty prompt", "RuntimeError"))
        }

        const beforeStartResult = yield* Effect.tryPromise(() =>
          services.hookRunner.emitBeforeAgentStart(prompt),
        ).pipe(Effect.mapError((err) => toSdkError(err, "HookError")))

        if (beforeStartResult?.message) {
          const hookMessage = createHookMessage(beforeStartResult.message)
          prepareHookMessage(options.hookMessageSink, hookMessage)
        }

        const mode = promptOptions?.mode ?? "followUp"
        const attachments = promptOptions?.attachments

        const submitOptions: { mode: PromptDeliveryMode; attachments?: Attachment[]; beforeStartResult?: BeforeAgentStartResult } = {
          mode,
        }
        if (attachments !== undefined) submitOptions.attachments = attachments
        if (beforeStartResult !== undefined) submitOptions.beforeStartResult = beforeStartResult

        if (wait) {
          return yield* services.sessionOrchestrator
            .submitPromptAndWait(prompt, submitOptions)
            .pipe(Effect.mapError((err) => toSdkError(err, "RuntimeError")))
        }

        yield* services.sessionOrchestrator.submitPrompt(prompt, submitOptions)
      })

    createHookHandlers(services, sendRef, options.hookMessageSink, submitPromptEffect)

    return {
      services,
      close,
      submitPrompt: (text: string, promptOptions?: PromptOptions) =>
        submitPromptEffect(text, promptOptions, false),
      submitPromptAndWait: (text: string, promptOptions?: PromptOptions) =>
        submitPromptEffect(text, promptOptions, true),
    }
  })

export const createSdkRuntime = (options: SdkRuntimeOptions): Effect.Effect<SdkRuntime, SdkError> =>
  createSdkRuntimeImpl(options).pipe(Effect.mapError((err) => toSdkError(err, "ConfigError")))

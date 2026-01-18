import { Context, Effect, Layer, Ref } from "effect"
import type { Api, Model } from "@marvin-agents/ai"
import type {
	AppendEntryHandler,
	DeliveryHandler,
	IsIdleHandler,
	SendHandler,
	SendMessageHandler,
	SendUserMessageHandler,
} from "./loader.js"
import type { HookSessionContext, HookUIContext } from "./types.js"
import { ExtensibilityTag } from "../extensibility/index.js"
import { InstrumentationTag } from "../instrumentation.js"

export interface HookContextHandlers {
	sendHandler: SendHandler
	sendMessageHandler: SendMessageHandler
	sendUserMessageHandler: SendUserMessageHandler
	steerHandler: DeliveryHandler
	followUpHandler: DeliveryHandler
	isIdleHandler: IsIdleHandler
	appendEntryHandler: AppendEntryHandler
	getSessionId: () => string | null
	getModel: () => Model<Api> | null
	uiContext?: HookUIContext
	sessionContext?: HookSessionContext
	hasUI?: boolean
}

export interface HookContextController {
	configure(handlers: HookContextHandlers): Effect.Effect<void>
	configured(): Effect.Effect<boolean>
}

export const HookContextControllerTag = Context.GenericTag<HookContextController>("runtime-effect/HookContextController")

export const HookContextControllerLayer = Layer.effect(
	HookContextControllerTag,
	Effect.gen(function* () {
		const { hookRunner } = yield* ExtensibilityTag
		const instrumentation = yield* InstrumentationTag
		const configuredRef = yield* Ref.make(false)

			return {
				configure: Effect.fn(function* (handlers: HookContextHandlers) {
					hookRunner.initialize(handlers)
					instrumentation.record({
						type: "hook:context-configured",
						hasUI: handlers.hasUI ?? false,
					})
					yield* Ref.set(configuredRef, true)
				}),
				configured: () => Ref.get(configuredRef),
			} satisfies HookContextController
	}),
)

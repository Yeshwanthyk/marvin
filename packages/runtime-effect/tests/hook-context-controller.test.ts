import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import * as Runtime from "effect/Runtime"
import type { Api, Model } from "@marvin-agents/ai"
import {
	HookContextControllerLayer,
	HookContextControllerTag,
	type HookContextHandlers,
} from "../src/hooks/context-controller.js"
import { InstrumentationTag, type InstrumentationEvent, type InstrumentationService } from "../src/instrumentation.js"
import { ExtensibilityTag } from "../src/extensibility/index.js"
import type { HookRunner } from "../src/hooks/index.js"

const testModel = { id: "test", label: "test", provider: "anthropic", contextWindow: 200000 } as Model<Api>

class StubHookRunner {
	initializeCalls: number = 0
	lastOptions: Record<string, unknown> | null = null

	initialize(options: Record<string, unknown>) {
		this.initializeCalls += 1
		this.lastOptions = options
	}
}

class TestInstrumentation implements InstrumentationService {
	events: InstrumentationEvent[] = []

	record(event: InstrumentationEvent) {
		this.events.push(event)
	}
}

const createLayer = (runner: HookRunner, instrumentation: InstrumentationService) => {
	const base = Layer.mergeAll(
		Layer.succeed(ExtensibilityTag, {
			hookRunner: runner,
			customTools: [],
			validationIssues: [],
			hookCount: 0,
		}),
		Layer.succeed(InstrumentationTag, instrumentation),
	)
	return Layer.provideMerge(HookContextControllerLayer, base)
}

const runWithLayer = async <A>(layer: Layer.Layer<never, never, never>, program: Effect.Effect<A>) => {
	const scoped = Effect.scoped(
		Effect.gen(function* () {
			const runtime = yield* Layer.toRuntime(layer)
			return yield* Effect.promise(() => Runtime.runPromise(runtime, program))
		}),
	)
	return await Effect.runPromise(scoped)
}

const sampleHandlers: HookContextHandlers = {
	sendHandler: () => {},
	sendMessageHandler: () => {},
	sendUserMessageHandler: async () => {},
	steerHandler: async () => {},
	followUpHandler: async () => {},
	isIdleHandler: () => true,
	appendEntryHandler: () => {},
	getSessionId: () => "session-1",
	getModel: () => testModel,
	uiContext: undefined,
	sessionContext: undefined,
	hasUI: true,
}

describe("HookContextController", () => {
	it("configures hook runner and tracks configuration status", async () => {
		const runner = new StubHookRunner()
		const instrumentation = new TestInstrumentation()
		const layer = createLayer(runner as unknown as HookRunner, instrumentation)

		await runWithLayer(
			layer,
			Effect.gen(function* () {
				const controller = yield* HookContextControllerTag
				const before = yield* controller.configured()
				expect(before).toBe(false)

				yield* controller.configure(sampleHandlers)

				const after = yield* controller.configured()
				expect(after).toBe(true)
			}),
		)

		expect(runner.initializeCalls).toBe(1)
		expect(runner.lastOptions).toMatchObject({ hasUI: true })
		expect(instrumentation.events).toContainEqual({ type: "hook:context-configured", hasUI: true })
	})

	it("allows configuring multiple times", async () => {
		const runner = new StubHookRunner()
		const instrumentation = new TestInstrumentation()
		const layer = createLayer(runner as unknown as HookRunner, instrumentation)

		await runWithLayer(
			layer,
			Effect.gen(function* () {
				const controller = yield* HookContextControllerTag
				yield* controller.configure(sampleHandlers)
				yield* controller.configure({ ...sampleHandlers, hasUI: false })
			}),
		)

		expect(runner.initializeCalls).toBe(2)
		expect(instrumentation.events.at(-1)).toEqual({ type: "hook:context-configured", hasUI: false })
	})
})

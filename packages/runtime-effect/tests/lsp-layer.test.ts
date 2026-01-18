import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import * as Runtime from "effect/Runtime"
import type { LspManager } from "@marvin-agents/lsp"
import { LspLayer, LspServiceTag } from "../src/lsp.js"
import { ConfigTag } from "../src/config.js"
import { InstrumentationTag, type InstrumentationEvent, type InstrumentationService } from "../src/instrumentation.js"

const createConfig = () => ({
	config: {
		configDir: "/tmp/marvin-test",
		configPath: "/tmp/marvin-test/config.json",
		provider: { id: "anthropic", label: "Anthropic", models: [] },
		modelId: "anthropic/model",
		model: { id: "anthropic/model", label: "Anthropic", provider: "anthropic", contextWindow: 200000 },
		thinking: "off",
		theme: "marvin",
		systemPrompt: "",
		agentsConfig: { combined: "" },
		lsp: { enabled: true, autoInstall: false },
	},
})

class TestInstrumentation implements InstrumentationService {
	events: InstrumentationEvent[] = []
	record(event: InstrumentationEvent) {
		this.events.push(event)
	}
}

const runLayer = async (layer: Layer.Layer<never, never, never>, program: Effect.Effect<void>) => {
	const scoped = Effect.scoped(
		Effect.gen(function* () {
			const runtime = yield* Layer.toRuntime(layer)
			return yield* Effect.promise(() => Runtime.runPromise(runtime, program))
		}),
	)
	await Effect.runPromise(scoped)
}

describe("LspLayer", () => {
	it("shuts down manager on scope exit and records activity events", async () => {
		let shutdownCalled = false
		const manager: LspManager = {
			touchFile: async () => {},
			diagnostics: async () => ({}),
			shutdown: async () => {
				shutdownCalled = true
			},
			activeServers: () => [],
			diagnosticCounts: () => ({ errors: 0, warnings: 0 }),
		}
		const instrumentation = new TestInstrumentation()

		const base = Layer.mergeAll(
			Layer.succeed(ConfigTag, createConfig()),
			Layer.succeed(InstrumentationTag, instrumentation),
		)
		const layer = Layer.provideMerge(LspLayer({ cwd: "/tmp/project", lspFactory: () => manager }), base)

		await runLayer(
			layer,
			Effect.gen(function* () {
				const service = yield* LspServiceTag
				expect(service.manager).toBe(manager)
				service.notifyActivity(true)
			}),
		)

		expect(shutdownCalled).toBe(true)
		expect(instrumentation.events).toContainEqual({ type: "lsp:activity", active: true })
	})
})

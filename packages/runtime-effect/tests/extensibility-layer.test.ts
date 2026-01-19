import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import * as Runtime from "effect/Runtime"
import { ExtensibilityLayer, ExtensibilityTag, type ExtensibilityLayerOptions } from "../src/extensibility/index.js"
import { InstrumentationTag, type InstrumentationEvent, type InstrumentationService } from "../src/instrumentation.js"
import { ConfigTag, type LoadedAppConfig } from "../src/config.js"
import { SessionManager, SessionManagerTag } from "../src/session-manager.js"
import { CustomCommandTag } from "../src/extensibility/custom-commands.js"
import type { LoadedCustomTool } from "../src/extensibility/custom-tools/index.js"
import type { HookRunner } from "../src/hooks/index.js"
import { getModels } from "@yeshwanthyk/ai"
import { Type } from "@sinclair/typebox"
import type { CustomAgentTool } from "../src/extensibility/custom-tools/types.js"

class TestInstrumentation implements InstrumentationService {
	events: InstrumentationEvent[] = []

	record(event: InstrumentationEvent) {
		this.events.push(event)
	}
}

const getAnthropicModel = () => {
	const models = getModels("anthropic")
	if (models.length === 0) {
		throw new Error("No anthropic models available")
	}
	return models[0]
}

const createConfig = (): LoadedAppConfig => {
	const model = getAnthropicModel()
	return {
		provider: "anthropic",
		modelId: model.id,
		model,
		thinking: "off",
		theme: "marvin",
		systemPrompt: "system",
		agentsConfig: { combined: "" },
		configDir: "/tmp",
		configPath: "/tmp/config.json",
		lsp: { enabled: false, autoInstall: false },
	}
}

const stubTool = (name: string): LoadedCustomTool => {
	const tool: CustomAgentTool = {
		name,
		label: name,
		description: "",
		parameters: Type.Object({}),
		execute: async () => ({ content: [], details: undefined }),
	}
	return {
		path: `/tmp/${name}.ts`,
		resolvedPath: `/tmp/${name}.ts`,
		tool,
	}
}

const runWithLayer = async (layer: Layer.Layer<never, never, never>, program: Effect.Effect<void>) => {
	const scoped = Effect.scoped(
		Effect.gen(function* () {
			const runtime = yield* Layer.toRuntime(layer)
			return yield* Effect.promise(() => Runtime.runPromise(runtime, program))
		}),
	)
	await Effect.runPromise(scoped)
}

describe("ExtensibilityLayer instrumentation", () => {
	it("records summaries including custom command count and tool details", async () => {
		const instrumentation = new TestInstrumentation()
		const loader: NonNullable<ExtensibilityLayerOptions["loader"]> = async () => ({
			hookRunner: {
				onError: () => () => {},
			} as HookRunner,
			customTools: [stubTool("alpha-tool"), stubTool("delta-tool")],
			validationIssues: [],
			hookCount: 2,
		})

		const baseProviders = Layer.mergeAll(
			Layer.succeed(ConfigTag, { config: createConfig() }),
			Layer.succeed(SessionManagerTag, { sessionManager: new SessionManager("/tmp") }),
			Layer.succeed(CustomCommandTag, {
				commands: new Map([
					["alpha", { name: "alpha", description: "", template: "" }],
					["beta", { name: "beta", description: "", template: "" }],
				]),
				issues: [],
			}),
			Layer.succeed(InstrumentationTag, instrumentation),
		)
		const layer = Layer.provideMerge(
			ExtensibilityLayer({
				sendRef: { current: () => {} },
				builtinToolNames: [],
				hasUI: false,
				loader,
			}),
			baseProviders,
		)

		await runWithLayer(
			layer,
			Effect.gen(function* () {
				const service = yield* ExtensibilityTag
				expect(service.customTools).toHaveLength(2)
			}),
		)

		expect(instrumentation.events).toContainEqual({
			type: "extensibility:loaded",
			hooks: 2,
			customTools: 2,
			customCommands: 2,
		})
		expect(instrumentation.events).toContainEqual({
			type: "extensibility:custom-tools-loaded",
			count: 2,
			entries: [
				{ name: "alpha-tool", path: "/tmp/alpha-tool.ts" },
				{ name: "delta-tool", path: "/tmp/delta-tool.ts" },
			],
		})
	})
})

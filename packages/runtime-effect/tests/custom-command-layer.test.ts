import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import * as Runtime from "effect/Runtime"
import { CustomCommandLayer, CustomCommandTag } from "../src/extensibility/custom-commands.js"
import { InstrumentationTag, type InstrumentationEvent, type InstrumentationService } from "../src/instrumentation.js"

class TestInstrumentation implements InstrumentationService {
	events: InstrumentationEvent[] = []

	record(event: InstrumentationEvent) {
		this.events.push(event)
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

describe("CustomCommandLayer instrumentation", () => {
	it("records command load summaries and validation issues", async () => {
		const instrumentation = new TestInstrumentation()
		const loader = () => ({
			commands: new Map([
				["alpha", { name: "alpha", description: "Alpha cmd", template: "alpha" }],
				["beta", { name: "beta", description: "Beta cmd", template: "beta" }],
			]),
			issues: [
				{ kind: "command", severity: "warning", path: "/tmp/beta.md", message: "warn" },
			],
		})

		const layer = Layer.provideMerge(
			CustomCommandLayer({ configDir: "/tmp", loader }),
			Layer.succeed(InstrumentationTag, instrumentation),
		)

		await runWithLayer(
			layer,
			Effect.gen(function* () {
				const service = yield* CustomCommandTag
				expect(service.commands.size).toBe(2)
			}),
		)

		expect(instrumentation.events).toContainEqual({
			type: "extensibility:validation-issue",
			issue: { kind: "command", severity: "warning", path: "/tmp/beta.md", message: "warn" },
		})
		expect(instrumentation.events).toContainEqual({
			type: "extensibility:commands-loaded",
			count: 2,
			names: ["alpha", "beta"],
		})
	})
})

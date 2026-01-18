import { Context, Layer } from "effect"
import type { ValidationIssue } from "./extensibility/schema.js"

export type InstrumentationEvent =
	| { type: "hook:error"; hookPath: string; event: string; error: string }
	| { type: "extensibility:validation-issue"; issue: ValidationIssue }
	| { type: "extensibility:loaded"; hooks: number; customTools: number }
	| { type: "dmux:log"; level: "info" | "warn" | "error"; message: string; details?: Record<string, unknown> }

export interface InstrumentationService {
	record: (event: InstrumentationEvent) => void
}

export const InstrumentationTag = Context.GenericTag<InstrumentationService>("runtime-effect/InstrumentationService")

export const NoopInstrumentationLayer = Layer.succeed(InstrumentationTag, {
	record: () => {},
})

export const ConsoleInstrumentationLayer = (options?: { prefix?: string }) =>
	Layer.succeed(InstrumentationTag, {
		record: (event: InstrumentationEvent) => {
			const prefix = options?.prefix ?? "[runtime]"
			// eslint-disable-next-line no-console
			console.error(`${prefix} ${event.type}`, event)
		},
	})

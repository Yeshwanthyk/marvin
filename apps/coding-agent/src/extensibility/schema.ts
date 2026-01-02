import { Type } from "@sinclair/typebox"
import type { Static } from "@sinclair/typebox"

export const VALIDATION_KINDS = ["hook", "tool", "command"] as const
export type ValidationKind = (typeof VALIDATION_KINDS)[number]

export const VALIDATION_SEVERITIES = ["error", "warning"] as const
export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number]

export const validationKindSchema = Type.Union([
	Type.Literal("hook"),
	Type.Literal("tool"),
	Type.Literal("command"),
])
export const validationSeveritySchema = Type.Union([Type.Literal("error"), Type.Literal("warning")])

export interface ValidationIssue {
	kind: ValidationKind
	severity: ValidationSeverity
	path: string
	message: string
	hint?: string
}

export const validationIssueSchema = Type.Object({
	kind: validationKindSchema,
	severity: validationSeveritySchema,
	path: Type.String({ minLength: 1 }),
	message: Type.String({ minLength: 1 }),
	hint: Type.Optional(Type.String({ minLength: 1 })),
})

export const customCommandSchema = Type.Object({
	name: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$", minLength: 1 }),
	description: Type.String({ minLength: 1 }),
	template: Type.String({ minLength: 1 }),
})

export type CustomCommandManifest = Static<typeof customCommandSchema>

export const customToolSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		label: Type.String({ minLength: 1 }),
		description: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: true },
)

export type CustomToolDescriptor = Static<typeof customToolSchema>

export const HOOK_EVENT_NAMES = [
	"app.start",
	"session.start",
	"session.resume",
	"session.clear",
	"session.before_compact",
	"session.compact",
	"session.shutdown",
	"agent.before_start",
	"agent.start",
	"agent.end",
	"turn.start",
	"turn.end",
	"tool.execute.before",
	"tool.execute.after",
	"chat.message",
	"chat.messages.transform",
	"chat.system.transform",
	"chat.params",
	"auth.get",
	"model.resolve",
] as const

const hookEventLiteralSchema = Type.Union([
	Type.Literal("app.start"),
	Type.Literal("session.start"),
	Type.Literal("session.resume"),
	Type.Literal("session.clear"),
	Type.Literal("session.before_compact"),
	Type.Literal("session.compact"),
	Type.Literal("session.shutdown"),
	Type.Literal("agent.before_start"),
	Type.Literal("agent.start"),
	Type.Literal("agent.end"),
	Type.Literal("turn.start"),
	Type.Literal("turn.end"),
	Type.Literal("tool.execute.before"),
	Type.Literal("tool.execute.after"),
	Type.Literal("chat.message"),
	Type.Literal("chat.messages.transform"),
	Type.Literal("chat.system.transform"),
	Type.Literal("chat.params"),
	Type.Literal("auth.get"),
	Type.Literal("model.resolve"),
])

export const hookDescriptorSchema = Type.Object({
	path: Type.String({ minLength: 1 }),
	events: Type.Array(hookEventLiteralSchema, { default: [] }),
})

export type HookDescriptor = Static<typeof hookDescriptorSchema>

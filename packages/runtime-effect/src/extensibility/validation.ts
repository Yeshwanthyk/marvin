import { Value } from "@sinclair/typebox/value"
import type { TSchema } from "@sinclair/typebox"
import {
	customCommandSchema,
	customToolSchema,
	hookDescriptorSchema,
	type CustomCommandManifest,
	type CustomToolDescriptor,
	type HookDescriptor,
	type ValidationIssue,
	type ValidationKind,
	type ValidationSeverity,
} from "./schema.js"

interface SchemaValidationContext {
	kind: ValidationKind
	severity?: ValidationSeverity
	path: string
}

const formatSchemaErrorMessage = (error: { path: string; message: string }): string => {
	const path = error.path === "" ? "value" : error.path
	return `${path}: ${error.message}`
}

const createIssue = (params: {
	kind: ValidationKind
	path: string
	message: string
	severity?: ValidationSeverity
	hint?: string
}): ValidationIssue => {
	const issue: ValidationIssue = {
		kind: params.kind,
		path: params.path,
		message: params.message,
		severity: params.severity ?? "error",
	}

	if (params.hint !== undefined) {
		issue.hint = params.hint
	}

	return issue
}

export const issueFromError = (
	kind: ValidationKind,
	path: string,
	error: unknown,
	options?: { hint?: string; severity?: ValidationSeverity },
): ValidationIssue => {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: String(error)
	const params: {
		kind: ValidationKind
		path: string
		message: string
		severity?: ValidationSeverity
		hint?: string
	} = { kind, path, message, severity: options?.severity ?? "error" }

	if (options?.hint !== undefined) {
		params.hint = options.hint
	}

	return createIssue(params)
}

const validateWithSchema = (schema: TSchema, value: unknown, ctx: SchemaValidationContext): ValidationIssue[] => {
	const errors = [...Value.Errors(schema, value)]
	return errors.map((error) => createIssue({
		kind: ctx.kind,
		path: ctx.path,
		message: formatSchemaErrorMessage(error),
		severity: ctx.severity ?? "error",
	}))
}

export const validateCustomCommand = (manifest: CustomCommandManifest, path: string): ValidationIssue[] => {
	return validateWithSchema(customCommandSchema, manifest, { kind: "command", path })
}

export const validateCustomTool = (descriptor: CustomToolDescriptor, path: string): ValidationIssue[] => {
	return validateWithSchema(customToolSchema, descriptor, { kind: "tool", path })
}

export const validateHookDescriptor = (descriptor: HookDescriptor): ValidationIssue[] => {
	return validateWithSchema(hookDescriptorSchema, descriptor, {
		kind: "hook",
		path: descriptor.path,
		severity: "warning",
	})
}

export const formatValidationIssue = (issue: ValidationIssue): string => {
	const prefix = `[${issue.severity.toUpperCase()}][${issue.kind}]`
	const hint = issue.hint ? `\n  hint: ${issue.hint}` : ""
	return `${prefix} ${issue.path}: ${issue.message}${hint}`
}

export const hasBlockingIssues = (issues: ValidationIssue[]): boolean =>
	issues.some((issue) => issue.severity === "error")

import type { AgentTool } from "@marvin-agents/ai"
import { loadHooks, HookRunner, type HookError } from "../../hooks/index.js"
import {
	loadCustomTools,
	getToolNames,
	type LoadedCustomTool,
	type SendRef,
} from "../../custom-tools/index.js"
import type { ValidationIssue } from "@ext/schema.js"

export interface ExtensibilityLoadOptions {
	configDir: string
	cwd: string
	sendRef: SendRef
	builtinTools: AgentTool<any, any>[]
	/** Whether running in interactive mode (TUI) */
	hasUI: boolean
}

export interface ExtensibilityLoadResult {
	hookRunner: HookRunner
	customTools: LoadedCustomTool[]
	validationIssues: ValidationIssue[]
}

export const loadExtensibility = async (
	options: ExtensibilityLoadOptions,
): Promise<ExtensibilityLoadResult> => {
	const { hooks, issues: hookIssues } = await loadHooks(options.configDir)
	const hookRunner = new HookRunner(hooks, options.cwd, options.configDir)

	const { tools: customTools, issues: toolIssues } = await loadCustomTools(
		options.configDir,
		options.cwd,
		getToolNames(options.builtinTools),
		options.sendRef,
		options.hasUI,
	)

	return {
		hookRunner,
		customTools,
		validationIssues: [...hookIssues, ...toolIssues],
	}
}

export const attachHookErrorLogging = (hookRunner: HookRunner, log: (message: string) => void) => {
	hookRunner.onError((err: HookError) => {
		log(`Hook error [${err.event}] ${err.hookPath}: ${err.error}`)
	})
}

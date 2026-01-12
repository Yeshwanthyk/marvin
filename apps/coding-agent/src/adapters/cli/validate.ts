import { toolRegistry } from "@marvin-agents/base-tools"
import type { AgentTool } from "@marvin-agents/ai"
import { loadAppConfig } from "../../config.js"
import { loadCustomCommands } from "../../custom-commands.js"
import type { RuntimeInitArgs } from "@runtime/factory.js"
import { loadExtensibility } from "@runtime/extensibility/index.js"
import { formatValidationIssue, hasBlockingIssues } from "@ext/validation.js"
import type { ValidationIssue } from "@ext/schema.js"
import type { SendRef } from "../../custom-tools/types.js"
import { SessionManager } from "../../session-manager.js"

export const runValidate = async (args: RuntimeInitArgs = {}): Promise<void> => {
	const loaded = await loadAppConfig({
		configDir: args.configDir,
		configPath: args.configPath,
		provider: args.provider,
		model: args.model,
		thinking: args.thinking,
	})

	const { issues: commandIssues } = loadCustomCommands(loaded.configDir)
	const sendRef: SendRef = { current: () => {} }
	const sessionManager = new SessionManager(loaded.configDir)
	
	// Create minimal tool objects for extensibility (just needs name property)
	const builtinToolMocks = Object.entries(toolRegistry).map(([name]) => ({
		name,
	})) as unknown as AgentTool<any, any>[]
	
	const extensibility = await loadExtensibility({
		configDir: loaded.configDir,
		cwd: process.cwd(),
		sendRef,
		builtinTools: builtinToolMocks,
		hasUI: false,
		sessionManager,
	})

	const issues: ValidationIssue[] = [...commandIssues, ...extensibility.validationIssues]

	if (issues.length === 0) {
		process.stdout.write("No validation issues found.\n")
		return
	}

	process.stdout.write(`Found ${issues.length} validation issue${issues.length === 1 ? "" : "s"}:\n`)
	for (const issue of issues) {
		process.stdout.write(`${formatValidationIssue(issue)}\n`)
	}

	if (hasBlockingIssues(issues)) {
		process.exitCode = 1
	}
}

import { codingTools } from "@marvin-agents/base-tools"
import { loadAppConfig } from "../../config.js"
import { loadCustomCommands } from "../../custom-commands.js"
import type { RuntimeInitArgs } from "@runtime/factory.js"
import { loadExtensibility } from "@runtime/extensibility/index.js"
import { formatValidationIssue, hasBlockingIssues } from "@ext/validation.js"
import type { ValidationIssue } from "@ext/schema.js"
import type { SendRef } from "../../custom-tools/types.js"

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
	const extensibility = await loadExtensibility({
		configDir: loaded.configDir,
		cwd: process.cwd(),
		sendRef,
		builtinTools: codingTools,
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

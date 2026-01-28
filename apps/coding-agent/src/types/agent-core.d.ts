/**
 * Module declaration merging to extend CustomMessages for our app-specific message types
 */

import type { HookMessage } from "@yeshwanthyk/runtime-effect/hooks/index.js"

// Shell message type for command execution results
export interface ShellMessage {
	role: "shell"
	command: string
	output: string
	exitCode: number | null
	truncated: boolean
	tempFilePath?: string
	timestamp?: number
}

declare module "@yeshwanthyk/agent-core" {
	interface CustomMessages {
		shell: ShellMessage
		hook: HookMessage<any>
	}
}
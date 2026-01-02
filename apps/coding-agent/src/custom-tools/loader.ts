/**
 * Custom tool loader - discovers and loads TypeScript tool modules.
 *
 * Tools are loaded from:
 *   - ~/.config/marvin/tools/*.ts (single-file tools)
 *   - ~/.config/marvin/tools/<name>/index.ts (directory-based tools)
 *
 * Uses Bun's native import() which handles TypeScript directly.
 */

import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { AgentTool } from "@marvin-agents/ai"
import type {
	CustomToolFactory,
	CustomToolsLoadResult,
	ExecOptions,
	ExecResult,
	LoadedCustomTool,
	SendRef,
	ToolAPI,
} from "./types.js"
import type { ValidationIssue, ValidationSeverity } from "@ext/schema.js"
import { validateCustomTool, issueFromError } from "@ext/validation.js"

const createToolIssue = (path: string, message: string, severity: ValidationSeverity = "error"): ValidationIssue => ({
	kind: "tool",
	severity,
	path,
	message,
})

/**
 * Execute a command and return stdout/stderr/code.
 * Supports cancellation via AbortSignal and timeout.
 */
async function execCommand(command: string, args: string[], cwd: string, options?: ExecOptions): Promise<ExecResult> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""
		let killed = false
		let timeoutId: ReturnType<typeof setTimeout> | undefined

		const killProcess = () => {
			if (!killed) {
				killed = true
				proc.kill("SIGTERM")
				// Force kill after 5s if SIGTERM doesn't work
				setTimeout(() => {
					if (!proc.killed) {
						proc.kill("SIGKILL")
					}
				}, 5000)
			}
		}

		// Handle abort signal
		if (options?.signal) {
			if (options.signal.aborted) {
				killProcess()
			} else {
				options.signal.addEventListener("abort", killProcess, { once: true })
			}
		}

		// Handle timeout
		if (options?.timeout && options.timeout > 0) {
			timeoutId = setTimeout(killProcess, options.timeout)
		}

		proc.stdout.on("data", (data) => {
			stdout += data.toString()
		})

		proc.stderr.on("data", (data) => {
			stderr += data.toString()
		})

		proc.on("close", (code) => {
			if (timeoutId) clearTimeout(timeoutId)
			if (options?.signal) {
				options.signal.removeEventListener("abort", killProcess)
			}
			resolve({
				stdout,
				stderr,
				code: code ?? 0,
				killed,
			})
		})

		proc.on("error", (err) => {
			if (timeoutId) clearTimeout(timeoutId)
			if (options?.signal) {
				options.signal.removeEventListener("abort", killProcess)
			}
			resolve({
				stdout,
				stderr: stderr || err.message,
				code: 1,
				killed,
			})
		})
	})
}

/**
 * Load a single tool module.
 */
async function loadTool(
	toolPath: string,
	cwd: string,
	api: ToolAPI,
): Promise<{ tools: LoadedCustomTool[] | null; error: string | null }> {
	const resolvedPath = resolve(toolPath)

	try {
		// Use file URL for import - Bun handles TS natively
		const fileUrl = pathToFileURL(resolvedPath).href
		const module = await import(fileUrl)
		const factory = module.default as CustomToolFactory

		if (typeof factory !== "function") {
			return { tools: null, error: "Tool must export a default function" }
		}

		// Call factory with API
		const result = await factory(api)

		// Handle single tool or array of tools
		const toolsArray = Array.isArray(result) ? result : [result]

		const loadedTools: LoadedCustomTool[] = toolsArray.map((tool) => ({
			path: toolPath,
			resolvedPath,
			tool,
		}))

		return { tools: loadedTools, error: null }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return { tools: null, error: `Failed to load tool: ${message}` }
	}
}

/**
 * Discover tool files from a directory.
 * Finds both:
 *   - tools/*.ts (single-file tools)
 *   - tools/<name>/index.ts (directory-based tools with assets)
 */
function discoverToolsInDir(dir: string): string[] {
	if (!existsSync(dir)) {
		return []
	}

	const paths: string[] = []

	try {
		const entries = readdirSync(dir, { withFileTypes: true })

		for (const entry of entries) {
			if (entry.isFile() || entry.isSymbolicLink()) {
				// Single-file tool: tools/name.ts
				if (entry.name.endsWith(".ts")) {
					paths.push(join(dir, entry.name))
				}
			} else if (entry.isDirectory()) {
				// Directory-based tool: tools/name/index.ts
				const indexPath = join(dir, entry.name, "index.ts")
				if (existsSync(indexPath)) {
					paths.push(indexPath)
				}
			}
		}
	} catch {
		// Ignore read errors
	}

	return paths
}

/**
 * Discover and load tools from the config directory.
 * Loads from ~/.config/marvin/tools/*.ts
 *
 * @param configDir - Base config directory (e.g., ~/.config/marvin)
 * @param cwd - Current working directory for tool execution
 * @param builtInToolNames - Names of built-in tools to check for conflicts
 * @param sendRef - Ref for send handler (set by App after initialization)
 */
export async function loadCustomTools(
	configDir: string,
	cwd: string,
	builtInToolNames: string[],
	sendRef: SendRef,
): Promise<CustomToolsLoadResult> {
	const tools: LoadedCustomTool[] = []
	const issues: ValidationIssue[] = []
	const seenNames = new Set<string>(builtInToolNames)

	// Shared API object - all tools get the same instance
	const api: ToolAPI = {
		cwd,
		exec: (command: string, args: string[], options?: ExecOptions) => execCommand(command, args, cwd, options),
		send: (text: string) => sendRef.current(text),
	}

	const toolsDir = join(configDir, "tools")
	const paths = discoverToolsInDir(toolsDir)

	for (const toolPath of paths) {
		const { tools: loadedTools, error } = await loadTool(toolPath, cwd, api)

		if (error) {
			issues.push(issueFromError("tool", toolPath, error))
			continue
		}

		if (loadedTools) {
			for (const loadedTool of loadedTools) {
				// Check for name conflicts
				if (seenNames.has(loadedTool.tool.name)) {
					issues.push(
						createToolIssue(
							toolPath,
							`Tool name "${loadedTool.tool.name}" conflicts with existing tool`,
						),
					)
					continue
				}

				seenNames.add(loadedTool.tool.name)
				tools.push(loadedTool)

				issues.push(...validateCustomTool(loadedTool.tool as any, toolPath))

				if (typeof loadedTool.tool.execute !== "function") {
					issues.push(
						createToolIssue(
							toolPath,
							`Tool "${loadedTool.tool.name}" is missing an execute() function`,
						),
					)
				}
				if (!loadedTool.tool.parameters) {
					issues.push(
						createToolIssue(
							toolPath,
							`Tool "${loadedTool.tool.name}" does not export parameters schema`,
							"warning",
						),
					)
				}
			}
		}
	}

	return { tools, issues }
}

/**
 * Get built-in tool names from an array of tools.
 */
export function getToolNames(tools: AgentTool<any, any>[]): string[] {
	return tools.map((t) => t.name)
}

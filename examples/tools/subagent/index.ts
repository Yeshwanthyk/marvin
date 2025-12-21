/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `marvin` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses headless mode to capture structured output from subagents.
 */

import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Type, type Static } from "@sinclair/typebox"

// Types
type AgentScope = "user" | "project" | "both"

interface AgentConfig {
	name: string
	description: string
	tools?: string[]
	model?: string
	systemPrompt: string
	source: "user" | "project"
	filePath: string
}

interface UsageStats {
	input: number
	output: number
	cost: number
	turns: number
}

interface SingleResult {
	agent: string
	agentSource: "user" | "project" | "unknown"
	task: string
	exitCode: number
	output: string
	stderr: string
	usage: UsageStats
	model?: string
	step?: number
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain"
	agentScope: AgentScope
	results: SingleResult[]
}

// Agent discovery
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const frontmatter: Record<string, string> = {}
	const normalized = content.replace(/\r\n/g, "\n")

	if (!normalized.startsWith("---")) {
		return { frontmatter, body: normalized }
	}

	const endIndex = normalized.indexOf("\n---", 3)
	if (endIndex === -1) {
		return { frontmatter, body: normalized }
	}

	const frontmatterBlock = normalized.slice(4, endIndex)
	const body = normalized.slice(endIndex + 4).trim()

	for (const line of frontmatterBlock.split("\n")) {
		const match = line.match(/^([\w-]+):\s*(.*)$/)
		if (match) {
			let value = match[2].trim()
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1)
			}
			frontmatter[match[1]] = value
		}
	}

	return { frontmatter, body }
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = []

	if (!fs.existsSync(dir)) return agents

	let entries: fs.Dirent[]
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return agents
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue
		if (!entry.isFile() && !entry.isSymbolicLink()) continue

		const filePath = path.join(dir, entry.name)
		let content: string
		try {
			content = fs.readFileSync(filePath, "utf-8")
		} catch {
			continue
		}

		const { frontmatter, body } = parseFrontmatter(content)
		if (!frontmatter.name || !frontmatter.description) continue

		const tools = frontmatter.tools
			?.split(",")
			.map((t) => t.trim())
			.filter(Boolean)

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		})
	}

	return agents
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd
	while (true) {
		const candidate = path.join(currentDir, ".marvin", "agents")
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate
		} catch {}

		const parentDir = path.dirname(currentDir)
		if (parentDir === currentDir) return null
		currentDir = parentDir
	}
}

function discoverAgents(cwd: string, scope: AgentScope): { agents: AgentConfig[]; projectAgentsDir: string | null } {
	const userDir = path.join(os.homedir(), ".config", "marvin", "agents")
	const projectAgentsDir = findNearestProjectAgentsDir(cwd)

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user")
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project")

	const agentMap = new Map<string, AgentConfig>()

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent)
		for (const agent of projectAgents) agentMap.set(agent.name, agent)
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent)
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent)
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir }
}

// Run single agent
async function runSingleAgent(
	cwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	step: number | undefined,
	signal: AbortSignal | undefined
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName)

	if (!agent) {
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			output: "",
			stderr: `Unknown agent: ${agentName}`,
			usage: { input: 0, output: 0, cost: 0, turns: 0 },
			step,
		}
	}

	const args: string[] = ["--headless"]
	if (agent.model) args.push("--model", agent.model)

	// Build the full prompt with system context
	let fullPrompt = task
	if (agent.systemPrompt.trim()) {
		fullPrompt = `System context:\n${agent.systemPrompt}\n\nTask: ${task}`
	}
	args.push(fullPrompt)

	return new Promise((resolve) => {
		const proc = spawn("marvin", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] })

		let stdout = ""
		let stderr = ""
		let wasAborted = false

		proc.stdout.on("data", (data) => {
			stdout += data.toString()
		})
		proc.stderr.on("data", (data) => {
			stderr += data.toString()
		})

		proc.on("close", (code) => {
			let output = ""
			let model: string | undefined

			// Parse headless JSON output
			try {
				const result = JSON.parse(stdout.trim())
				output = result.assistant || ""
				model = result.model
			} catch {
				output = stdout
			}

			resolve({
				agent: agentName,
				agentSource: agent.source,
				task,
				exitCode: wasAborted ? 1 : code ?? 0,
				output,
				stderr,
				usage: { input: 0, output: 0, cost: 0, turns: 1 },
				model,
				step,
			})
		})

		proc.on("error", (err) => {
			resolve({
				agent: agentName,
				agentSource: agent.source,
				task,
				exitCode: 1,
				output: "",
				stderr: err.message,
				usage: { input: 0, output: 0, cost: 0, turns: 0 },
				step,
			})
		})

		if (signal) {
			const killProc = () => {
				wasAborted = true
				proc.kill("SIGTERM")
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL")
				}, 5000)
			}
			if (signal.aborted) killProc()
			else signal.addEventListener("abort", killProc, { once: true })
		}
	})
}

// Concurrency helper
async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
	if (items.length === 0) return []
	const limit = Math.max(1, Math.min(concurrency, items.length))
	const results: TOut[] = new Array(items.length)
	let nextIndex = 0
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++
			if (current >= items.length) return
			results[current] = await fn(items[current], current)
		}
	})
	await Promise.all(workers)
	return results
}

// Schema
const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
})

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
})

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(
		Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("both")], {
			description: 'Which agent directories to use. Default: "user".',
			default: "user",
		})
	),
})

type SubagentParamsType = Static<typeof SubagentParams>

const MAX_PARALLEL_TASKS = 8
const MAX_CONCURRENCY = 4

// Tool factory
export default function (api: { cwd: string }) {
	return {
		name: "subagent",
		label: "Subagent",
		get description() {
			const discovery = discoverAgents(api.cwd, "both")
			const agentList =
				discovery.agents.length > 0
					? discovery.agents
							.slice(0, 5)
							.map((a) => `${a.name} (${a.source}): ${a.description}`)
							.join("; ")
					: "none configured"
			const more = discovery.agents.length > 5 ? `; ... and ${discovery.agents.length - 5} more` : ""
			return [
				"Delegate tasks to specialized subagents with isolated context.",
				"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
				`Available agents: ${agentList}${more}.`,
				"Create agents in ~/.config/marvin/agents/*.md with frontmatter: name, description, model (optional).",
			].join(" ")
		},
		parameters: SubagentParams,

		async execute(
			_toolCallId: string,
			params: SubagentParamsType,
			signal?: AbortSignal
		): Promise<{ content: Array<{ type: "text"; text: string }>; details: SubagentDetails }> {
			const agentScope: AgentScope = params.agentScope ?? "user"
			const discovery = discoverAgents(api.cwd, agentScope)
			const agents = discovery.agents

			const hasChain = (params.chain?.length ?? 0) > 0
			const hasTasks = (params.tasks?.length ?? 0) > 0
			const hasSingle = Boolean(params.agent && params.task)
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle)

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({ mode, agentScope, results })

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none"
				return {
					content: [{ type: "text", text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}` }],
					details: makeDetails("single")([]),
				}
			}

			// Chain mode
			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = []
				let previousOutput = ""

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i]
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput)
					const result = await runSingleAgent(api.cwd, agents, step.agent, taskWithContext, i + 1, signal)
					results.push(result)

					if (result.exitCode !== 0) {
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${result.stderr || result.output || "(no output)"}` }],
							details: makeDetails("chain")(results),
						}
					}
					previousOutput = result.output
				}

				return {
					content: [{ type: "text", text: results[results.length - 1]?.output || "(no output)" }],
					details: makeDetails("chain")(results),
				}
			}

			// Parallel mode
			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					return {
						content: [{ type: "text", text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
						details: makeDetails("parallel")([]),
					}
				}

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t) => {
					return runSingleAgent(api.cwd, agents, t.agent, t.task, undefined, signal)
				})

				const successCount = results.filter((r) => r.exitCode === 0).length
				const summaries = results.map((r) => {
					const preview = r.output.slice(0, 100) + (r.output.length > 100 ? "..." : "")
					return `[${r.agent}] ${r.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`
				})

				return {
					content: [{ type: "text", text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}` }],
					details: makeDetails("parallel")(results),
				}
			}

			// Single mode
			if (params.agent && params.task) {
				const result = await runSingleAgent(api.cwd, agents, params.agent, params.task, undefined, signal)

				if (result.exitCode !== 0) {
					return {
						content: [{ type: "text", text: `Agent failed: ${result.stderr || result.output || "(no output)"}` }],
						details: makeDetails("single")([result]),
					}
				}

				return {
					content: [{ type: "text", text: result.output || "(no output)" }],
					details: makeDetails("single")([result]),
				}
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none"
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			}
		},
	}
}

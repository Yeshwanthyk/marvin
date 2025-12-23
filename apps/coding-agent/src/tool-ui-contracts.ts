export type DelegationMode = "single" | "parallel" | "chain"
export type DelegationStatus = "pending" | "running" | "ok" | "error"

export interface AgentDelegationUiItem {
	id: string
	agent: string
	task: string
	status: DelegationStatus
	preview?: string
}

export interface AgentDelegationUi {
	kind: "agent_delegation"
	mode: DelegationMode
	items: AgentDelegationUiItem[]
	activeId?: string
}

export interface AgentDelegationArgs {
	agent?: string
	task?: string
	tasks?: Array<{ agent: string; task: string }>
	chain?: Array<{ agent: string; task: string }>
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

export function getAgentDelegationArgs(args: unknown): AgentDelegationArgs | null {
	if (!isRecord(args)) return null
	const agent = typeof args.agent === "string" ? args.agent : undefined
	const task = typeof args.task === "string" ? args.task : undefined
	const tasks = Array.isArray(args.tasks) ? args.tasks : undefined
	const chain = Array.isArray(args.chain) ? args.chain : undefined

	const isTaskItem = (v: unknown): v is { agent: string; task: string } =>
		isRecord(v) && typeof v.agent === "string" && typeof v.task === "string"

	const normTasks = tasks?.every(isTaskItem) ? tasks : undefined
	const normChain = chain?.every(isTaskItem) ? chain : undefined

	if (normChain || normTasks || (agent && task)) return { agent, task, tasks: normTasks, chain: normChain }
	return null
}

export function getAgentDelegationUi(details: unknown): AgentDelegationUi | null {
	if (!isRecord(details)) return null
	if (!isRecord(details.ui)) return null
	if (details.ui.kind !== "agent_delegation") return null

	const ui = details.ui as Record<string, unknown>
	const mode = ui.mode
	if (mode !== "single" && mode !== "parallel" && mode !== "chain") return null
	if (!Array.isArray(ui.items)) return null

	const isStatus = (s: unknown): s is DelegationStatus =>
		s === "pending" || s === "running" || s === "ok" || s === "error"
	const items: AgentDelegationUiItem[] = []
	for (const raw of ui.items) {
		if (!isRecord(raw)) return null
		if (typeof raw.id !== "string" || typeof raw.agent !== "string" || typeof raw.task !== "string") return null
		if (!isStatus(raw.status)) return null
		items.push({
			id: raw.id,
			agent: raw.agent,
			task: raw.task,
			status: raw.status,
			preview: typeof raw.preview === "string" ? raw.preview : undefined,
		})
	}

	return {
		kind: "agent_delegation",
		mode,
		items,
		activeId: typeof ui.activeId === "string" ? ui.activeId : undefined,
	}
}

import {
	runCockpitInstallerAction,
	type CockpitAgent,
	type CockpitInstallerResult,
	type CockpitInstallOptions,
} from "@yeshwanthyk/runtime-effect/cockpit/installers.js"
import type { CockpitConfig } from "@yeshwanthyk/runtime-effect/config.js"

export interface CockpitAutoRepairConfig {
	readonly cockpit: CockpitConfig
}

export type CockpitInstallerRunner = (
	action: "install",
	options: CockpitInstallOptions,
) => Promise<CockpitInstallerResult[]>

export const cockpitAutoRepairAgents = (config: CockpitAutoRepairConfig): CockpitAgent[] => {
	if (!config.cockpit.enabled || !config.cockpit.autoRepair) return []
	const agents: CockpitAgent[] = []
	if (config.cockpit.agents.claude.enabled) agents.push("claude")
	if (config.cockpit.agents.codex.enabled) agents.push("codex")
	if (config.cockpit.agents.pi.enabled) agents.push("pi")
	return agents
}

export const runCockpitAutoRepair = async (
	config: CockpitAutoRepairConfig,
	hookBinarySource: string,
	runInstaller: CockpitInstallerRunner = runCockpitInstallerAction,
): Promise<CockpitInstallerResult[]> => {
	const agents = cockpitAutoRepairAgents(config)
	if (agents.length === 0) return []
	return runInstaller("install", { agents, hookBinarySource })
}

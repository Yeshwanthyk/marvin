import { describe, expect, it } from "bun:test"
import type { CockpitConfig } from "@yeshwanthyk/runtime-effect/config.js"
import { cockpitAutoRepairAgents, runCockpitAutoRepair } from "../src/runtime/cockpit-autorepair.js"

const cockpitConfig = (overrides: Partial<CockpitConfig> = {}): { cockpit: CockpitConfig } => ({
	cockpit: {
		enabled: false,
		autoRepair: false,
		agents: {
			claude: { enabled: true },
			codex: { enabled: true },
			pi: { enabled: true },
		},
		...overrides,
		agents: {
			claude: overrides.agents?.claude ?? { enabled: true },
			codex: overrides.agents?.codex ?? { enabled: true },
			pi: overrides.agents?.pi ?? { enabled: true },
		},
	},
})

describe("cockpit auto-repair", () => {
	it("is disabled unless cockpit and autoRepair are both enabled", async () => {
		expect(cockpitAutoRepairAgents(cockpitConfig())).toEqual([])
		expect(cockpitAutoRepairAgents(cockpitConfig({ enabled: true }))).toEqual([])
		expect(await runCockpitAutoRepair(cockpitConfig(), "hook", async () => {
			throw new Error("should not run")
		})).toEqual([])
	})

	it("runs installer only for enabled agents when opted in", async () => {
		const calls: unknown[] = []
		const result = await runCockpitAutoRepair(
			cockpitConfig({
				enabled: true,
				autoRepair: true,
				agents: {
					claude: { enabled: false },
					codex: { enabled: true },
					pi: { enabled: false },
				},
			}),
			"hook-source",
			async (action, options) => {
				calls.push({ action, options })
				return [{ agent: "codex", status: "installed", changed: false, path: "/tmp/hooks.json" }]
			},
		)

		expect(calls).toEqual([{ action: "install", options: { agents: ["codex"], hookBinarySource: "hook-source" } }])
		expect(result).toEqual([{ agent: "codex", status: "installed", changed: false, path: "/tmp/hooks.json" }])
	})
})

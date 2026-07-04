import { describe, expect, it } from "bun:test"
import { createSignal } from "solid-js"
import { createFocusedRuntimeFacade, type FocusedRuntimeBinding } from "../src/runtime/focused-runtime.js"

const binding = (label: string): FocusedRuntimeBinding => ({
	laneId: label,
	bundle: {
		projectId: label,
		cwd: `/tmp/${label}`,
		config: {
			configDir: `/tmp/${label}/config`,
			configPath: `/tmp/${label}/config/config.json`,
			theme: "marvin",
			provider: "anthropic",
			modelId: `${label}-model`,
			model: { id: `${label}-model`, name: `${label} model`, contextWindow: 100 },
			thinking: "off",
			keymap: { lanes: {} },
		},
		cycleModels: [],
		getApiKey: () => undefined,
		transports: { router: {}, provider: {}, codex: {} },
		customCommands: new Map([["cmd", { name: label }]]),
		customTools: [],
		toolRegistry: {},
		toolByName: new Map([["tool", { label }]]),
		hookDefinitions: { paths: [], issues: [] },
		validationIssues: [],
		createActorServices: async () => { throw new Error("unused") },
		close: async () => {},
	} as unknown as FocusedRuntimeBinding["bundle"],
	services: {
		agent: {
			state: { messages: [label], isStreaming: false, pendingToolCalls: new Set() },
			setModel: (model: { id: string }) => {
				;(model as { seen?: string }).seen = label
			},
		},
		sessionManager: {
			projectCwd: `/tmp/${label}`,
			sessionId: label,
			sessionPath: `/tmp/${label}.jsonl`,
		},
		promptQueue: { marker: label },
		sessionOrchestrator: { marker: label },
		hookRunner: { marker: label },
		hookContext: { marker: label },
		createAgent: () => ({}),
		hookedTransport: {},
		tools: [],
		close: async () => {},
	} as unknown as FocusedRuntimeBinding["services"],
	sendRef: { current: () => {} },
	close: async () => {},
})

describe("focused runtime facade", () => {
	it("forwards stable runtime properties to the current focused binding", () => {
		const [current, setCurrent] = createSignal<FocusedRuntimeBinding | null>(binding("one"))
		const sendRef = { current: () => {} }
		const runtime = createFocusedRuntimeFacade(current, sendRef)

		expect(runtime.sessionManager.projectCwd).toBe("/tmp/one")
		expect(runtime.config.modelId).toBe("one-model")
		expect(runtime.toolByName.get("tool")?.label).toBe("one")

		setCurrent(binding("two"))

		expect(runtime.sessionManager.projectCwd).toBe("/tmp/two")
		expect(runtime.config.modelId).toBe("two-model")
		expect(runtime.toolByName.get("tool")?.label).toBe("two")

		setCurrent(binding("three"))

		expect(runtime.sessionManager.projectCwd).toBe("/tmp/three")
		expect(runtime.config.modelId).toBe("three-model")
		expect(runtime.toolByName.get("tool")?.label).toBe("three")
		expect(runtime.sendRef).toBe(sendRef)

		const delivered: string[] = []
		runtime.sendRef.current = (text) => {
			delivered.push(`${runtime.sessionManager.projectCwd}:${text}`)
		}
		runtime.sendRef.current("after-three")

		setCurrent(binding("two"))
		runtime.sendRef.current("after-two")

		expect(delivered).toEqual([
			"/tmp/three:after-three",
			"/tmp/two:after-two",
		])
	})
})

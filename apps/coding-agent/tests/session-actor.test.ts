import { describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Agent, type AgentTransport } from "@yeshwanthyk/agent-core"
import type { AppMessage } from "@yeshwanthyk/agent-core"
import {
	createHookUIContext,
	HookedTransport,
	HookRunner,
	loadHooks,
} from "@yeshwanthyk/runtime-effect/hooks/index.js"
import { SessionManager } from "@yeshwanthyk/runtime-effect/session-manager.js"
import type {
	ProjectRuntimeBundle,
	ScopedSessionActorServices,
	SessionActorDescriptor,
} from "@yeshwanthyk/runtime-effect/project-bundle.js"
import { Effect, Stream } from "effect"
import { createSessionActor } from "../src/runtime/session-actor.js"

const fakeTransport: AgentTransport = {
	run: async function* () {},
	continue: async function* () {},
}

const descriptor: SessionActorDescriptor = {
	laneId: "lane-a",
	projectId: "/tmp/project",
	cwd: "/tmp/project",
	sessionId: null,
	sessionPath: null,
}

const createServices = (hookRunner: HookRunner, sessionManager: SessionManager): ScopedSessionActorServices => {
	const hookedTransport = new HookedTransport(fakeTransport, hookRunner)
	const agent = new Agent({ transport: hookedTransport })
	const promptQueue = {
		enqueue: () => Effect.void,
		enqueueMany: () => Effect.void,
		trackImmediate: () => Effect.void,
		take: Effect.never,
		takeForProcessing: Effect.never,
		takeAll: Effect.succeed([]),
		acknowledgeHead: () => Effect.void,
		drainToScript: Effect.succeed(null),
		clear: Effect.void,
		pendingSnapshot: Effect.succeed([]),
		countsSnapshot: Effect.succeed({ steer: 0, followUp: 0, total: 0 }),
		snapshot: Effect.succeed({ pending: [], counts: { steer: 0, followUp: 0, total: 0 } }),
		stateStream: Stream.empty,
		restore: () => Effect.void,
		restoreFromScript: () => Effect.void,
	}
	return {
		agent,
		createAgent: () => agent,
		sessionManager,
		promptQueue,
		sessionOrchestrator: {
			queue: promptQueue,
			submitPrompt: () => Effect.void,
			submitPromptAndWait: () => Effect.void,
			snapshot: promptQueue.snapshot,
			drainToScript: Effect.succeed(null),
		},
		hookRunner,
		hookContext: {
			configure: () => Effect.void,
			configured: () => Effect.succeed(true),
		},
		hookedTransport,
		tools: [],
		close: async () => {},
	}
}

describe("SessionActor", () => {
	it("downgrades focused hook UI handlers when the actor becomes hidden", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "session-actor-hook-"))
		try {
			await mkdir(path.join(dir, "hooks"), { recursive: true })
			await writeFile(
				path.join(dir, "hooks", "prompt.ts"),
				`
export default function hook(marvin) {
  marvin.on("app.start", async (_event, ctx) => {
    await ctx.ui.input("Need input", "value")
  })
}
`,
				"utf8",
			)
			const { hooks } = await loadHooks(dir)
			const sessionManager = new SessionManager(dir, descriptor.cwd)
			const hookRunner = new HookRunner(hooks, descriptor.cwd, dir, sessionManager)
			const services = createServices(hookRunner, sessionManager)
			const livePrompts: string[] = []
			const hiddenPrompts: string[] = []
			const notifications: string[] = []
			const bundle: ProjectRuntimeBundle = {
				projectId: descriptor.projectId,
				cwd: descriptor.cwd,
				config: {
					configDir: dir,
					configPath: path.join(dir, "config.json"),
					theme: "marvin",
					provider: "anthropic",
					modelId: "claude",
					model: { id: "claude", name: "claude", contextWindow: 100 },
					thinking: "off",
					keymap: { lanes: {} },
				},
				cycleModels: [],
				getApiKey: () => undefined,
				transports: { router: fakeTransport, provider: fakeTransport, codex: fakeTransport },
				customCommands: new Map(),
				customTools: [],
				toolRegistry: {},
				toolByName: new Map(),
				hookDefinitions: { paths: [], issues: [] },
				validationIssues: [],
				createActorServices: async () => services,
				close: async () => {},
			} as ProjectRuntimeBundle
			const actor = createSessionActor({
				descriptor,
				getBundle: async () => bundle,
				getUiPolicy: () => ({
					hookUIContext: createHookUIContext({
						setEditorText: () => {},
						getEditorText: () => "",
						showSelect: async () => undefined,
						showInput: async (title) => {
							hiddenPrompts.push(title)
							return undefined
						},
						showConfirm: async () => false,
						showNotify: (message) => notifications.push(message),
					}),
					notify: (_title, message) => notifications.push(message),
				}),
			})

			actor.bindView({ isFocused: () => true })
			await actor.hydrate("focus")
			hookRunner.initialize({
				sendHandler: () => {},
				sendMessageHandler: () => {},
				sendUserMessageHandler: async () => {},
				steerHandler: async () => {},
				followUpHandler: async () => {},
				isIdleHandler: () => true,
				appendEntryHandler: () => {},
				getSessionId: () => sessionManager.sessionId,
				getModel: () => services.agent.getModel(),
				uiContext: createHookUIContext({
					setEditorText: () => {},
					getEditorText: () => "",
					showSelect: async () => undefined,
					showInput: async (title) => {
						livePrompts.push(title)
						return undefined
					},
					showConfirm: async () => false,
					showNotify: () => {},
				}),
				hasUI: true,
			})

			actor.refreshUiPolicy(false)
			await hookRunner.emit({ type: "app.start" })

			expect(livePrompts).toEqual([])
			expect(hiddenPrompts).toEqual(["Need input"])
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("restores JSONL messages into agent and projection when hydrating a suspended actor", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "session-actor-rehydrate-"))
		try {
			const seed = new SessionManager(dir, descriptor.cwd)
			const sessionId = seed.startSession("anthropic", "claude", "off")
			const sessionPath = seed.sessionPath
			if (sessionPath === null) throw new Error("session fixture missing path")
			const message: AppMessage = {
				role: "user",
				content: [{ type: "text", text: "restore me" }],
				timestamp: Date.now(),
			}
			seed.appendMessage(message)
			const actorDescriptor: SessionActorDescriptor = {
				...descriptor,
				sessionId,
				sessionPath,
			}
			const servicesManager = new SessionManager(dir, descriptor.cwd)
			const hookRunner = new HookRunner([], descriptor.cwd, dir, servicesManager)
			const services = createServices(hookRunner, servicesManager)
			const bundle: ProjectRuntimeBundle = {
				projectId: descriptor.projectId,
				cwd: descriptor.cwd,
				config: {
					configDir: dir,
					configPath: path.join(dir, "config.json"),
					theme: "marvin",
					provider: "anthropic",
					modelId: "claude",
					model: { id: "claude", name: "claude", contextWindow: 100 },
					thinking: "off",
					keymap: { lanes: {} },
				},
				cycleModels: [],
				getApiKey: () => undefined,
				transports: { router: fakeTransport, provider: fakeTransport, codex: fakeTransport },
				customCommands: new Map(),
				customTools: [],
				toolRegistry: {},
				toolByName: new Map(),
				hookDefinitions: { paths: [], issues: [] },
				validationIssues: [],
				createActorServices: async () => {
					servicesManager.continueSession(sessionPath, sessionId)
					return services
				},
				close: async () => {},
			} as ProjectRuntimeBundle
			const actor = createSessionActor({
				descriptor: actorDescriptor,
				getBundle: async () => bundle,
			})

			await actor.hydrate("focus")

			expect(services.agent.state.messages).toEqual([message])
			expect(actor.projection.messages()).toHaveLength(1)
			expect(actor.projection.messages()[0]?.content).toBe("restore me")
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})

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

const createServices = (
	hookRunner: HookRunner,
	sessionManager: SessionManager,
	onClose: () => void | Promise<void> = () => {},
): ScopedSessionActorServices => {
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
		close: async () => {
			await onClose()
		},
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

	it("shares concurrent hydration work", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "session-actor-hydrate-"))
		try {
			const sessionManager = new SessionManager(dir, descriptor.cwd)
			const hookRunner = new HookRunner([], descriptor.cwd, dir, sessionManager)
			const services = createServices(hookRunner, sessionManager)
			let releaseHydrate!: () => void
			const hydrateGate = new Promise<void>((resolve) => {
				releaseHydrate = resolve
			})
			let createCalls = 0
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
					createCalls += 1
					await hydrateGate
					return services
				},
				close: async () => {},
			} as ProjectRuntimeBundle
			const actor = createSessionActor({
				descriptor,
				getBundle: async () => bundle,
			})

			const first = actor.hydrate("focus")
			const second = actor.hydrate("focus")

			expect(actor.status()).toBe("hydrating")
			releaseHydrate()
			const [firstServices, secondServices] = await Promise.all([first, second])

			expect(firstServices).toBe(services)
			expect(secondServices).toBe(services)
			expect(createCalls).toBe(1)
			expect(actor.status()).toBe("warm")
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("does not publish services when suspend interrupts hydration", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "session-actor-suspend-hydrate-"))
		try {
			const sessionManager = new SessionManager(dir, descriptor.cwd)
			const hookRunner = new HookRunner([], descriptor.cwd, dir, sessionManager)
			let closeCalls = 0
			const services = createServices(hookRunner, sessionManager, () => {
				closeCalls += 1
			})
			let releaseHydrate!: () => void
			const hydrateGate = new Promise<void>((resolve) => {
				releaseHydrate = resolve
			})
			let markCreateStarted!: () => void
			const createStarted = new Promise<void>((resolve) => {
				markCreateStarted = resolve
			})
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
					markCreateStarted()
					await hydrateGate
					return services
				},
				close: async () => {},
			} as ProjectRuntimeBundle
			const actor = createSessionActor({
				descriptor,
				getBundle: async () => bundle,
			})

			const pending = actor.hydrate("focus")
			await createStarted
			const cancelled = pending.catch((error: unknown) => error)
			let suspendResolved = false
			const suspendPending = actor.suspend().then(() => {
				suspendResolved = true
			})
			await Promise.resolve()
			expect(suspendResolved).toBe(false)
			releaseHydrate()

			await suspendPending
			const error = await cancelled
			expect(error).toBeInstanceOf(Error)
			expect((error as Error).message).toContain("hydration cancelled")
			expect(actor.status()).toBe("suspended")
			expect(actor.services()).toBeNull()
			expect(closeCalls).toBe(1)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("does not publish services when close interrupts hydration", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "session-actor-close-hydrate-"))
		try {
			const sessionManager = new SessionManager(dir, descriptor.cwd)
			const hookRunner = new HookRunner([], descriptor.cwd, dir, sessionManager)
			let closeCalls = 0
			const services = createServices(hookRunner, sessionManager, () => {
				closeCalls += 1
			})
			let releaseHydrate!: () => void
			const hydrateGate = new Promise<void>((resolve) => {
				releaseHydrate = resolve
			})
			let markCreateStarted!: () => void
			const createStarted = new Promise<void>((resolve) => {
				markCreateStarted = resolve
			})
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
					markCreateStarted()
					await hydrateGate
					return services
				},
				close: async () => {},
			} as ProjectRuntimeBundle
			const actor = createSessionActor({
				descriptor,
				getBundle: async () => bundle,
			})

			const pending = actor.hydrate("focus")
			await createStarted
			const cancelled = pending.catch((error: unknown) => error)
			let closeResolved = false
			const closePending = actor.close().then(() => {
				closeResolved = true
			})
			await Promise.resolve()
			expect(closeResolved).toBe(false)
			releaseHydrate()

			await closePending
			const error = await cancelled
			expect(error).toBeInstanceOf(Error)
			expect((error as Error).message).toContain("hydration cancelled")
			expect(actor.status()).toBe("closed")
			expect(actor.services()).toBeNull()
			expect(closeCalls).toBe(1)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("waits to rehydrate until suspend finishes cancelling pending hydration", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "session-actor-suspend-queue-"))
		try {
			const firstManager = new SessionManager(dir, descriptor.cwd)
			const firstHookRunner = new HookRunner([], descriptor.cwd, dir, firstManager)
			let firstCloseCalls = 0
			const firstServices = createServices(firstHookRunner, firstManager, () => {
				firstCloseCalls += 1
			})
			const secondManager = new SessionManager(dir, descriptor.cwd)
			const secondHookRunner = new HookRunner([], descriptor.cwd, dir, secondManager)
			const secondServices = createServices(secondHookRunner, secondManager)
			let releaseFirstHydrate!: () => void
			const firstHydrateGate = new Promise<void>((resolve) => {
				releaseFirstHydrate = resolve
			})
			let markFirstCreateStarted!: () => void
			const firstCreateStarted = new Promise<void>((resolve) => {
				markFirstCreateStarted = resolve
			})
			let createCalls = 0
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
					createCalls += 1
					if (createCalls === 1) {
						markFirstCreateStarted()
						await firstHydrateGate
						return firstServices
					}
					return secondServices
				},
				close: async () => {},
			} as ProjectRuntimeBundle
			const actor = createSessionActor({
				descriptor,
				getBundle: async () => bundle,
			})

			const firstHydrate = actor.hydrate("focus")
			await firstCreateStarted
			const firstCancelled = firstHydrate.catch((error: unknown) => error)
			const suspendPending = actor.suspend()
			const rehydrate = actor.hydrate("focus")
			let rehydrateResolved = false
			void rehydrate.then(() => {
				rehydrateResolved = true
			})
			await Promise.resolve()

			expect(createCalls).toBe(1)
			expect(rehydrateResolved).toBe(false)
			releaseFirstHydrate()
			await suspendPending
			expect(actor.status()).toBe("suspended")
			expect(actor.services()).toBeNull()
			const error = await firstCancelled
			expect(error).toBeInstanceOf(Error)
			expect((error as Error).message).toContain("hydration cancelled")

			const hydrated = await rehydrate

			expect(hydrated).toBe(secondServices)
			expect(actor.status()).toBe("warm")
			expect(actor.services()).toBe(secondServices)
			expect(createCalls).toBe(2)
			expect(firstCloseCalls).toBe(1)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("does not return warm services that are being suspended", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "session-actor-warm-suspend-"))
		try {
			const firstManager = new SessionManager(dir, descriptor.cwd)
			const firstHookRunner = new HookRunner([], descriptor.cwd, dir, firstManager)
			let releaseClose!: () => void
			const closeGate = new Promise<void>((resolve) => {
				releaseClose = resolve
			})
			const firstServices = createServices(firstHookRunner, firstManager, async () => {
				await closeGate
			})
			const secondManager = new SessionManager(dir, descriptor.cwd)
			const secondHookRunner = new HookRunner([], descriptor.cwd, dir, secondManager)
			const secondServices = createServices(secondHookRunner, secondManager)
			let createCalls = 0
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
					createCalls += 1
					return createCalls === 1 ? firstServices : secondServices
				},
				close: async () => {},
			} as ProjectRuntimeBundle
			const actor = createSessionActor({
				descriptor,
				getBundle: async () => bundle,
			})

			expect(await actor.hydrate("focus")).toBe(firstServices)
			const suspendPending = actor.suspend()
			const rehydrate = actor.hydrate("focus")
			let rehydrateResolved = false
			void rehydrate.then(() => {
				rehydrateResolved = true
			})
			await Promise.resolve()

			expect(rehydrateResolved).toBe(false)
			releaseClose()
			await suspendPending
			expect(actor.status()).toBe("suspended")
			expect(actor.services()).toBeNull()

			const hydrated = await rehydrate

			expect(hydrated).toBe(secondServices)
			expect(hydrated).not.toBe(firstServices)
			expect(actor.status()).toBe("warm")
			expect(actor.services()).toBe(secondServices)
			expect(createCalls).toBe(2)
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

	it("uses an updated empty-lane descriptor when rehydrating after first submit", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "session-actor-empty-lane-"))
		try {
			const seed = new SessionManager(dir, descriptor.cwd)
			const sessionId = seed.startSession("anthropic", "claude", "off")
			const sessionPath = seed.sessionPath
			if (sessionPath === null) throw new Error("session fixture missing path")
			const message: AppMessage = {
				role: "user",
				content: [{ type: "text", text: "restore after empty lane" }],
				timestamp: Date.now(),
			}
			seed.appendMessage(message)
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
				createActorServices: async (input: SessionActorDescriptor) => {
					const manager = new SessionManager(dir, descriptor.cwd)
					if (input.sessionPath !== null && input.sessionId !== null) {
						manager.continueSession(input.sessionPath, input.sessionId)
					}
					const hookRunner = new HookRunner([], descriptor.cwd, dir, manager)
					return createServices(hookRunner, manager)
				},
				close: async () => {},
			} as ProjectRuntimeBundle
			const actor = createSessionActor({
				descriptor: { ...descriptor, sessionId: null, sessionPath: null },
				getBundle: async () => bundle,
			})

			await actor.hydrate("focus")
			await actor.suspend()
			actor.updateDescriptor({ ...descriptor, sessionId, sessionPath })
			await actor.hydrate("focus")

			expect(actor.descriptor()).toMatchObject({ sessionId, sessionPath })
			expect(actor.services()?.sessionManager.sessionPath).toBe(sessionPath)
			expect(actor.projection.messages()).toHaveLength(1)
			expect(actor.projection.messages()[0]?.content).toBe("restore after empty lane")
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})

import type { ScopedSessionActorServices, ProjectRuntimeBundle } from "@yeshwanthyk/runtime-effect/project-bundle.js"
import type { SendRef } from "@yeshwanthyk/runtime-effect/extensibility/custom-tools/index.js"
import type { RuntimeContext } from "./factory.js"

export interface FocusedRuntimeBinding {
	readonly laneId: string
	readonly bundle: ProjectRuntimeBundle
	readonly services: ScopedSessionActorServices
	readonly sendRef: SendRef
	close(): Promise<void>
}

// Boundary shim for Phase 5c: TuiApp still consumes a RuntimeContext-shaped object,
// while focus changes swap the actor services underneath it.
const proxyFor = <T extends object>(getTarget: () => T): T =>
	new Proxy({}, {
		get(_target, property) {
			const target = getTarget()
			const value = Reflect.get(target, property)
			return typeof value === "function" ? value.bind(target) : value
		},
		set(_target, property, value) {
			return Reflect.set(getTarget(), property, value)
		},
		has(_target, property) {
			return property in getTarget()
		},
		ownKeys() {
			return Reflect.ownKeys(getTarget())
		},
		getOwnPropertyDescriptor(_target, property) {
			return Reflect.getOwnPropertyDescriptor(getTarget(), property)
		},
	}) as T

export const createFocusedRuntimeFacade = (
	getBinding: () => FocusedRuntimeBinding | null,
	sendRef: SendRef,
): RuntimeContext => {
	const binding = () => {
		const current = getBinding()
		if (current === null) throw new Error("Focused runtime is not ready")
		return current
	}
	const services = () => binding().services
	const bundle = () => binding().bundle

	return {
		adapter: "tui",
		agent: proxyFor(() => services().agent),
		createAgent: (options) => services().createAgent(options),
		sessionManager: proxyFor(() => services().sessionManager),
		hookRunner: proxyFor(() => services().hookRunner),
		hookContext: proxyFor(() => services().hookContext),
		customCommands: proxyFor(() => bundle().customCommands),
		toolByName: proxyFor(() => bundle().toolByName),
		sendRef,
		config: proxyFor(() => bundle().config),
		cycleModels: proxyFor(() => [...bundle().cycleModels]),
		getApiKey: (provider) => bundle().getApiKey(provider),
		transport: proxyFor(() => bundle().transports.router),
		providerTransport: proxyFor(() => bundle().transports.provider),
		codexTransport: proxyFor(() => bundle().transports.codex),
		validationIssues: proxyFor(() => [...bundle().validationIssues]),
		promptQueue: proxyFor(() => services().promptQueue),
		sessionOrchestrator: proxyFor(() => services().sessionOrchestrator),
		close: () => binding().close(),
	}
}

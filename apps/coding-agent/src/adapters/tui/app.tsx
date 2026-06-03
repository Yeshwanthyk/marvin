import { render } from "@opentui/solid"
import { RuntimeProvider } from "../../runtime/context.js"
import { createRuntime, type RuntimeInitArgs } from "@runtime/factory.js"
import type { LoadedSession } from "../../session-manager.js"
import { selectSession as selectSessionOpen } from "../../session-picker.js"
import { TuiApp } from "@ui/app-shell/TuiApp.js"
import { WorkspaceSwitchProvider, type WorkspaceSwitchController, type WorkspaceSwitchRequest } from "../../runtime/workspace-switch.js"
import { createSignal, onCleanup, Show } from "solid-js"
import type { RuntimeContext } from "../../runtime/factory.js"

interface RunTuiArgs extends RuntimeInitArgs {
	continueSession?: boolean
	resumeSession?: boolean
	/** Session ID (UUID, prefix, or path) to load directly */
	session?: string
	/** Initial prompt to submit on startup */
	prompt?: string
}

interface RuntimeHostState {
	runtime: RuntimeContext
	initialSession: LoadedSession | null
	initialPrompt?: string
}

function TuiRuntimeHost(props: { args?: RunTuiArgs; initialRuntime: RuntimeContext; initialSession: LoadedSession | null; initialPrompt?: string }) {
	const [state, setState] = createSignal<RuntimeHostState>({
		runtime: props.initialRuntime,
		initialSession: props.initialSession,
		...(props.initialPrompt !== undefined ? { initialPrompt: props.initialPrompt } : {}),
	})

	let closed = false
	const closeRuntime = (runtime: RuntimeContext) => {
		if (closed) return
		void runtime.close()
	}

	const controller: WorkspaceSwitchController = {
		currentCwd: () => state().runtime.sessionManager.projectCwd,
		switchTo: async (request: WorkspaceSwitchRequest) => {
			const current = state().runtime
			if (request.cwd === current.sessionManager.projectCwd) {
				return current.sessionManager.loadSession(request.sessionPath)
			}

			const { continueSession: _continueSession, resumeSession: _resumeSession, session: _session, prompt: _prompt, ...runtimeArgs } = props.args ?? {}
			const nextRuntime = await createRuntime({ ...runtimeArgs, cwd: request.cwd }, "tui")
			const loaded = nextRuntime.sessionManager.loadSession(request.sessionPath)
			if (!loaded) {
				await nextRuntime.close()
				return null
			}

			setState({ runtime: nextRuntime, initialSession: loaded })
			queueMicrotask(() => closeRuntime(current))
			return loaded
		},
	}

	onCleanup(() => {
		closed = true
		void state().runtime.close()
	})

	return (
		<Show keyed when={state()}>
			{(current) => (
				<WorkspaceSwitchProvider controller={controller}>
					<RuntimeProvider runtime={current.runtime}>
						<TuiApp initialSession={current.initialSession} initialPrompt={current.initialPrompt} />
					</RuntimeProvider>
				</WorkspaceSwitchProvider>
			)}
		</Show>
	)
}

export const runTuiOpen = async (args?: RunTuiArgs) => {
	const runtime = await createRuntime(args, "tui")
	const { sessionManager } = runtime
	let initialSession: LoadedSession | null = null

	// Direct session loading via --session flag takes priority
	if (args?.session) {
		const sessionInfo = sessionManager.findSession(args.session)
		if (sessionInfo === null) {
			process.stderr.write(`Session not found: ${args.session}\n`)
			process.exit(1)
		}
		initialSession = sessionManager.loadSession(sessionInfo.path)
	}

	if (args?.resumeSession && !initialSession) {
		const selectedPath = await selectSessionOpen(sessionManager)
		if (selectedPath === null) {
			process.stdout.write("No session selected\n")
			return
		}
		initialSession = sessionManager.loadSession(selectedPath)
	}

	if (args?.continueSession && !initialSession) {
		initialSession = sessionManager.loadLatest()
	}

	render(
		() => (
			<TuiRuntimeHost args={args} initialRuntime={runtime} initialSession={initialSession} initialPrompt={args?.prompt} />
		),
		{ targetFps: 30, exitOnCtrlC: false, useKittyKeyboard: {} },
	)
}

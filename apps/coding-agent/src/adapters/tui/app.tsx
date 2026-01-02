import { render } from "@opentui/solid"
import { RuntimeProvider } from "../../runtime/context.js"
import { createRuntime, type RuntimeInitArgs } from "@runtime/factory.js"
import type { LoadedSession } from "../../session-manager.js"
import { selectSession as selectSessionOpen } from "../../session-picker.js"
import { TuiApp } from "@ui/app-shell/TuiApp.js"

interface RunTuiArgs extends RuntimeInitArgs {
	continueSession?: boolean
	resumeSession?: boolean
}

export const runTuiOpen = async (args?: RunTuiArgs) => {
	const runtime = await createRuntime(args, "tui")
	const { sessionManager } = runtime
	let initialSession: LoadedSession | null = null

	if (args?.resumeSession) {
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
			<RuntimeProvider runtime={runtime}>
				<TuiApp initialSession={initialSession} />
			</RuntimeProvider>
		),
		{ targetFps: 30, exitOnCtrlC: false, useKittyKeyboard: {} },
	)
}

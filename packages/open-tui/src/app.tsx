/**
 * App entry point - wrapper around OpenTUI's render function
 */

import type { CliRendererConfig } from "@opentui/core"
import { render } from "@opentui/solid"
import type { JSX } from "@opentui/solid/jsx-runtime"

export interface AppConfig extends CliRendererConfig {
	/** Exit callback when app terminates */
	onExit?: () => Promise<void>
}

/**
 * Start the TUI application with the given root component
 *
 * @param rootComponent - Function returning the root JSX element
 * @param config - Configuration options for the renderer
 * @returns Promise that resolves when the app exits
 */
export function startApp(rootComponent: () => JSX.Element, config: AppConfig = {}): Promise<void> {
	return new Promise<void>((resolve) => {
		const { onExit, ...renderConfig } = config

		render(rootComponent, {
			targetFps: 30,
			exitOnCtrlC: false,
			useKittyKeyboard: {},
			...renderConfig,
			onDestroy: async () => {
				renderConfig.onDestroy?.()
				await onExit?.()
				resolve()
			},
		})
	})
}

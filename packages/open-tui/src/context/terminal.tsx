/**
 * Terminal context - provides access to renderer and dimensions
 * Re-exports OpenTUI's hooks for convenience
 */

export type { CliRenderer, KeyEvent, PasteEvent } from "@opentui/core"
export {
	onResize,
	RendererContext,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/solid"

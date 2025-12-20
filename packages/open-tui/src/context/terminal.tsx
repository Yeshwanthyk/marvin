/**
 * Terminal context - provides access to renderer and dimensions
 * Re-exports OpenTUI's hooks for convenience
 */

export type { CliRenderer, KeyEvent, PasteEvent, Selection } from "@opentui/core"
export {
	onResize,
	RendererContext,
	useRenderer,
	useSelectionHandler,
	useTerminalDimensions,
} from "@opentui/solid"

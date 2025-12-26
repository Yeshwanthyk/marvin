/**
 * @marvin-agents/open-tui
 *
 * OpenTUI-based Terminal User Interface with SolidJS reactive rendering
 */

import "./opentui-augmentations.js"

// Re-export commonly used OpenTUI types and utilities
export {
	BoxRenderable,
	// Renderer config
	type CliRendererConfig,
	type ColorInput,
	InputRenderable,
	MouseButton,
	// Mouse events
	MouseEvent,
	// Color utilities
	parseColor,
	// Renderable types for advanced usage
	type Renderable,
	ScrollBoxRenderable,
	SelectRenderable,
	// Text attributes
	TextAttributes,
	TextareaRenderable,
	TextRenderable,
} from "@opentui/core"
// Re-export SolidJS render and hooks
export { render, testRender } from "@opentui/solid"
// App entry point
export { type AppConfig, startApp } from "./app.js"
export {
	type CliRenderer,
	type KeyEvent,
	onResize,
	type PasteEvent,
	RendererContext,
	type Selection,
	useRenderer,
	useSelectionHandler,
	useTerminalDimensions,
} from "./context/terminal.js"
// Context providers
export {
	BUILTIN_THEMES,
	createSyntaxStyle,
	RGBA,
	type SyntaxVariant,
	type Theme,
	type ThemeColors,
	type ThemeMode,
	ThemeProvider,
	type ThemeProviderProps,
	toRGBA,
	useTheme,
} from "./context/theme.js"
export type { UseKeyboardOptions } from "./hooks/use-keyboard.js"
// Hooks
export { useKeyboard, usePaste } from "./hooks/use-keyboard.js"
// Utilities
export { copyToClipboard } from "./utils/clipboard.js"
export {
	stripAnsi,
	truncateToWidth,
	visibleWidth,
} from "./utils/text-width.js"
// Components
export { Editor, Input, type EditorProps, type EditorRef, type EditorTheme, type InputProps } from "./components/editor.js"
export {
	getCellDimensions,
	getCapabilities,
	getImageDimensions,
	Image,
	type ImageDimensions,
	type ImageProps,
	type ImageProtocol,
	resetCapabilitiesCache,
	setCellDimensions,
	type TerminalCapabilities,
} from "./components/image.js"
export { Loader, type LoaderProps } from "./components/loader.js"
export { Markdown, type MarkdownProps, type MarkdownTheme } from "./components/markdown.js"
export {
	SelectList,
	SelectListKeys,
	type SelectItem,
	type SelectListProps,
	type SelectListRef,
	type SelectListTheme,
} from "./components/select-list.js"
export { Spacer, type SpacerProps } from "./components/spacer.js"
export { Badge, type BadgeProps, type BadgeVariant } from "./components/badge.js"
export { CodeBlock, type CodeBlockProps } from "./components/code-block.js"
export { Dialog, type DialogProps } from "./components/dialog.js"
export { Diff, type DiffProps, type DiffView, type DiffWrapMode } from "./components/diff.js"
export { Divider, type DividerOrientation, type DividerProps } from "./components/divider.js"
export { Panel, type PanelProps, type PanelVariant } from "./components/panel.js"
export {
	Toast,
	ToastViewport,
	type ToastItem,
	type ToastVariant,
	type ToastViewportPosition,
	type ToastViewportProps,
} from "./components/toast.js"

// Autocomplete support
export {
	type AutocompleteItem,
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
	FileIndex,
	type FileIndexOptions,
	type FileSearchResult,
	type SlashCommand,
} from "./autocomplete/index.js"

// Tree-sitter parser configuration
export { parsersConfig } from "./parsers-config.js"

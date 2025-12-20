/**
 * Theme context - provides theming for TUI components
 */

import type { ColorInput } from "@opentui/core"
import { parseColor, type RGBA } from "@opentui/core"
import type { Accessor, Context, JSX, ParentProps } from "solid-js"
import { createContext, useContext } from "solid-js"
import { createStore } from "solid-js/store"

/**
 * Theme color definitions
 */
export interface ThemeColors {
	primary: RGBA
	secondary: RGBA
	accent: RGBA
	error: RGBA
	warning: RGBA
	success: RGBA
	info: RGBA
	text: RGBA
	textMuted: RGBA
	background: RGBA
	backgroundPanel: RGBA
	backgroundElement: RGBA
	border: RGBA
	borderActive: RGBA
	// Diff colors
	diffAdded: RGBA
	diffRemoved: RGBA
	diffContext: RGBA
	// Markdown colors
	markdownText: RGBA
	markdownHeading: RGBA
	markdownLink: RGBA
	markdownCode: RGBA
	markdownBlockQuote: RGBA
}

export type Theme = ThemeColors

/**
 * Default dark theme colors
 */
const defaultDarkTheme: Theme = {
	primary: parseColor("#fab283"),
	secondary: parseColor("#89b4fa"),
	accent: parseColor("#a6e3a1"),
	error: parseColor("#f38ba8"),
	warning: parseColor("#fab387"),
	success: parseColor("#a6e3a1"),
	info: parseColor("#89b4fa"),
	text: parseColor("#cdd6f4"),
	textMuted: parseColor("#6c7086"),
	background: parseColor("#1e1e2e"),
	backgroundPanel: parseColor("#181825"),
	backgroundElement: parseColor("#313244"),
	border: parseColor("#45475a"),
	borderActive: parseColor("#89b4fa"),
	diffAdded: parseColor("#a6e3a1"),
	diffRemoved: parseColor("#f38ba8"),
	diffContext: parseColor("#6c7086"),
	markdownText: parseColor("#cdd6f4"),
	markdownHeading: parseColor("#89b4fa"),
	markdownLink: parseColor("#f5c2e7"),
	markdownCode: parseColor("#fab387"),
	markdownBlockQuote: parseColor("#6c7086"),
}

/**
 * Default light theme colors
 */
const defaultLightTheme: Theme = {
	primary: parseColor("#df8e1d"),
	secondary: parseColor("#1e66f5"),
	accent: parseColor("#40a02b"),
	error: parseColor("#d20f39"),
	warning: parseColor("#df8e1d"),
	success: parseColor("#40a02b"),
	info: parseColor("#1e66f5"),
	text: parseColor("#4c4f69"),
	textMuted: parseColor("#9ca0b0"),
	background: parseColor("#eff1f5"),
	backgroundPanel: parseColor("#e6e9ef"),
	backgroundElement: parseColor("#ccd0da"),
	border: parseColor("#bcc0cc"),
	borderActive: parseColor("#1e66f5"),
	diffAdded: parseColor("#40a02b"),
	diffRemoved: parseColor("#d20f39"),
	diffContext: parseColor("#9ca0b0"),
	markdownText: parseColor("#4c4f69"),
	markdownHeading: parseColor("#1e66f5"),
	markdownLink: parseColor("#ea76cb"),
	markdownCode: parseColor("#df8e1d"),
	markdownBlockQuote: parseColor("#9ca0b0"),
}

export type ThemeMode = "dark" | "light"

interface ThemeContextValue {
	theme: Theme
	mode: Accessor<ThemeMode>
	setMode: (mode: ThemeMode) => void
}

const ThemeContext: Context<ThemeContextValue | undefined> = createContext<ThemeContextValue>()

export interface ThemeProviderProps extends ParentProps {
	/** Initial theme mode */
	mode?: ThemeMode
	/** Custom theme overrides */
	customTheme?: Partial<Theme>
}

export function ThemeProvider(props: ThemeProviderProps): JSX.Element {
	const [store, setStore] = createStore({
		mode: props.mode ?? "dark",
	})

	const baseTheme = (): Theme => (store.mode === "dark" ? defaultDarkTheme : defaultLightTheme)

	const theme = (): Theme => ({
		...baseTheme(),
		...props.customTheme,
	})

	const value: ThemeContextValue = {
		get theme(): Theme {
			return theme()
		},
		mode: (): ThemeMode => store.mode,
		setMode: (mode: ThemeMode): void => {
			setStore("mode", mode)
		},
	}

	return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
	const context = useContext(ThemeContext)
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider")
	}
	return context
}

/**
 * Parse a color input to RGBA
 */
export function toRGBA(color: ColorInput): RGBA {
	return parseColor(color)
}

// Re-export RGBA for convenience
export { RGBA } from "@opentui/core"

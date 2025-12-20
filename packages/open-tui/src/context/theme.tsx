/**
 * Theme context - provides theming for TUI components
 */

import type { ColorInput } from "@opentui/core"
import { parseColor, type RGBA, SyntaxStyle } from "@opentui/core"
import type { Accessor, Context, JSX, ParentProps } from "solid-js"
import { createContext, createMemo, useContext } from "solid-js"
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
	backgroundMenu: RGBA

	border: RGBA
	borderSubtle: RGBA
	borderActive: RGBA

	selectionBg: RGBA
	selectionFg: RGBA

	// Diff colors
	diffAdded: RGBA
	diffRemoved: RGBA
	diffContext: RGBA
	diffAddedBg: RGBA
	diffRemovedBg: RGBA
	diffContextBg: RGBA
	diffLineNumberFg: RGBA
	diffLineNumberBg: RGBA
	diffAddedLineNumberBg: RGBA
	diffRemovedLineNumberBg: RGBA
	diffAddedSign: RGBA
	diffRemovedSign: RGBA
	diffHighlightAddedBg: RGBA
	diffHighlightRemovedBg: RGBA

	// Markdown colors
	markdownText: RGBA
	markdownHeading: RGBA
	markdownLink: RGBA
	markdownLinkUrl: RGBA
	markdownCode: RGBA
	markdownCodeBlock: RGBA
	markdownCodeBlockBorder: RGBA
	markdownBlockQuote: RGBA
	markdownBlockQuoteBorder: RGBA
	markdownHr: RGBA
	markdownListBullet: RGBA

	// Syntax colors
	syntaxComment: RGBA
	syntaxString: RGBA
	syntaxKeyword: RGBA
	syntaxFunction: RGBA
	syntaxVariable: RGBA
	syntaxType: RGBA
	syntaxNumber: RGBA
	syntaxConstant: RGBA
	syntaxOperator: RGBA
	syntaxPunctuation: RGBA
	syntaxProperty: RGBA
	syntaxTag: RGBA
	syntaxAttribute: RGBA
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
	warning: parseColor("#f9e2af"),
	success: parseColor("#a6e3a1"),
	info: parseColor("#89b4fa"),

	text: parseColor("#cdd6f4"),
	textMuted: parseColor("#6c7086"),

	background: parseColor("#1e1e2e"),
	backgroundPanel: parseColor("#181825"),
	backgroundElement: parseColor("#313244"),
	backgroundMenu: parseColor("#11111b"),

	border: parseColor("#45475a"),
	borderSubtle: parseColor("#313244"),
	borderActive: parseColor("#89b4fa"),

	selectionBg: parseColor("#45475a"),
	selectionFg: parseColor("#cdd6f4"),

	diffAdded: parseColor("#a6e3a1"),
	diffRemoved: parseColor("#f38ba8"),
	diffContext: parseColor("#6c7086"),
	diffAddedBg: parseColor("#203b2a"),
	diffRemovedBg: parseColor("#3a2228"),
	diffContextBg: parseColor("transparent"),
	diffLineNumberFg: parseColor("#6c7086"),
	diffLineNumberBg: parseColor("transparent"),
	diffAddedLineNumberBg: parseColor("#203b2a"),
	diffRemovedLineNumberBg: parseColor("#3a2228"),
	diffAddedSign: parseColor("#22c55e"),
	diffRemovedSign: parseColor("#ef4444"),
	diffHighlightAddedBg: parseColor("#2a5a3a"),
	diffHighlightRemovedBg: parseColor("#5a2a35"),

	markdownText: parseColor("#cdd6f4"),
	markdownHeading: parseColor("#89b4fa"),
	markdownLink: parseColor("#f5c2e7"),
	markdownLinkUrl: parseColor("#6c7086"),
	markdownCode: parseColor("#fab387"),
	markdownCodeBlock: parseColor("#cdd6f4"),
	markdownCodeBlockBorder: parseColor("#313244"),
	markdownBlockQuote: parseColor("#6c7086"),
	markdownBlockQuoteBorder: parseColor("#313244"),
	markdownHr: parseColor("#313244"),
	markdownListBullet: parseColor("#a6e3a1"),

	syntaxComment: parseColor("#6c7086"),
	syntaxString: parseColor("#a6e3a1"),
	syntaxKeyword: parseColor("#cba6f7"),
	syntaxFunction: parseColor("#89b4fa"),
	syntaxVariable: parseColor("#cdd6f4"),
	syntaxType: parseColor("#f9e2af"),
	syntaxNumber: parseColor("#fab387"),
	syntaxConstant: parseColor("#fab387"),
	syntaxOperator: parseColor("#cdd6f4"),
	syntaxPunctuation: parseColor("#bac2de"),
	syntaxProperty: parseColor("#94e2d5"),
	syntaxTag: parseColor("#f38ba8"),
	syntaxAttribute: parseColor("#f9e2af"),
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
	backgroundMenu: parseColor("#dce0e8"),

	border: parseColor("#bcc0cc"),
	borderSubtle: parseColor("#dce0e8"),
	borderActive: parseColor("#1e66f5"),

	selectionBg: parseColor("#bcc0cc"),
	selectionFg: parseColor("#4c4f69"),

	diffAdded: parseColor("#40a02b"),
	diffRemoved: parseColor("#d20f39"),
	diffContext: parseColor("#9ca0b0"),
	diffAddedBg: parseColor("#d6f5da"),
	diffRemovedBg: parseColor("#f6d6d9"),
	diffContextBg: parseColor("transparent"),
	diffLineNumberFg: parseColor("#9ca0b0"),
	diffLineNumberBg: parseColor("transparent"),
	diffAddedLineNumberBg: parseColor("#d6f5da"),
	diffRemovedLineNumberBg: parseColor("#f6d6d9"),
	diffAddedSign: parseColor("#16a34a"),
	diffRemovedSign: parseColor("#dc2626"),
	diffHighlightAddedBg: parseColor("#bfe8c8"),
	diffHighlightRemovedBg: parseColor("#e8bfc5"),

	markdownText: parseColor("#4c4f69"),
	markdownHeading: parseColor("#1e66f5"),
	markdownLink: parseColor("#ea76cb"),
	markdownLinkUrl: parseColor("#9ca0b0"),
	markdownCode: parseColor("#df8e1d"),
	markdownCodeBlock: parseColor("#4c4f69"),
	markdownCodeBlockBorder: parseColor("#bcc0cc"),
	markdownBlockQuote: parseColor("#9ca0b0"),
	markdownBlockQuoteBorder: parseColor("#bcc0cc"),
	markdownHr: parseColor("#bcc0cc"),
	markdownListBullet: parseColor("#40a02b"),

	syntaxComment: parseColor("#9ca0b0"),
	syntaxString: parseColor("#40a02b"),
	syntaxKeyword: parseColor("#8839ef"),
	syntaxFunction: parseColor("#1e66f5"),
	syntaxVariable: parseColor("#4c4f69"),
	syntaxType: parseColor("#df8e1d"),
	syntaxNumber: parseColor("#fe640b"),
	syntaxConstant: parseColor("#fe640b"),
	syntaxOperator: parseColor("#4c4f69"),
	syntaxPunctuation: parseColor("#5c5f77"),
	syntaxProperty: parseColor("#179299"),
	syntaxTag: parseColor("#d20f39"),
	syntaxAttribute: parseColor("#df8e1d"),
}

export type ThemeMode = "dark" | "light"

export type SyntaxVariant = "normal" | "subtle"

export function createSyntaxStyle(theme: Theme, variant: SyntaxVariant = "normal"): SyntaxStyle {
	const dim = variant === "subtle"
	return SyntaxStyle.fromStyles({
		comment: { fg: theme.syntaxComment, italic: true, ...(dim ? { dim: true } : {}) },
		string: { fg: theme.syntaxString, ...(dim ? { dim: true } : {}) },
		number: { fg: theme.syntaxNumber, ...(dim ? { dim: true } : {}) },
		constant: { fg: theme.syntaxConstant, ...(dim ? { dim: true } : {}) },
		keyword: { fg: theme.syntaxKeyword, ...(dim ? { dim: true } : { bold: true }) },
		operator: { fg: theme.syntaxOperator, ...(dim ? { dim: true } : {}) },
		punctuation: { fg: theme.syntaxPunctuation, ...(dim ? { dim: true } : {}) },
		function: { fg: theme.syntaxFunction, ...(dim ? { dim: true } : {}) },
		variable: { fg: theme.syntaxVariable, ...(dim ? { dim: true } : {}) },
		property: { fg: theme.syntaxProperty, ...(dim ? { dim: true } : {}) },
		type: { fg: theme.syntaxType, ...(dim ? { dim: true } : {}) },
		tag: { fg: theme.syntaxTag, ...(dim ? { dim: true } : {}) },
		attribute: { fg: theme.syntaxAttribute, ...(dim ? { dim: true } : {}) },
	})
}

interface ThemeContextValue {
	theme: Theme
	mode: Accessor<ThemeMode>
	setMode: (mode: ThemeMode) => void
	syntaxStyle: SyntaxStyle
	subtleSyntaxStyle: SyntaxStyle
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

	const theme = createMemo((): Theme => ({
		...baseTheme(),
		...props.customTheme,
	}))

	// Use createMemo for syntax styles - they'll recompute when theme changes
	const syntaxStyle = createMemo(() => createSyntaxStyle(theme(), "normal"))
	const subtleSyntaxStyle = createMemo(() => createSyntaxStyle(theme(), "subtle"))

	// Note: SyntaxStyle cleanup is handled internally by opentui when memos recompute

	const value: ThemeContextValue = {
		get theme(): Theme {
			return theme()
		},
		mode: (): ThemeMode => store.mode,
		setMode: (mode: ThemeMode): void => {
			setStore("mode", mode)
		},
		get syntaxStyle(): SyntaxStyle {
			return syntaxStyle()
		},
		get subtleSyntaxStyle(): SyntaxStyle {
			return subtleSyntaxStyle()
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

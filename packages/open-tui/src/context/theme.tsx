/**
 * Theme context - provides theming for TUI components
 */

import type { ColorInput } from "@opentui/core"
import { parseColor, RGBA, SyntaxStyle } from "@opentui/core"
import type { Accessor, Context, JSX, ParentProps } from "solid-js"
import { createContext, createEffect, createMemo, useContext } from "solid-js"
import { createStore } from "solid-js/store"

// Theme JSON imports
import aura from "../themes/aura.json"
import ayu from "../themes/ayu.json"
import catppuccin from "../themes/catppuccin.json"
import catppuccinMacchiato from "../themes/catppuccin-macchiato.json"
import cobalt2 from "../themes/cobalt2.json"
import dracula from "../themes/dracula.json"
import everforest from "../themes/everforest.json"
import flexoki from "../themes/flexoki.json"
import github from "../themes/github.json"
import gruvbox from "../themes/gruvbox.json"
import kanagawa from "../themes/kanagawa.json"
import lucentOrng from "../themes/lucent-orng.json"
import material from "../themes/material.json"
import matrix from "../themes/matrix.json"
import mercury from "../themes/mercury.json"
import monokai from "../themes/monokai.json"
import nightowl from "../themes/nightowl.json"
import nord from "../themes/nord.json"
import onedark from "../themes/one-dark.json"
import opencode from "../themes/opencode.json"
import orng from "../themes/orng.json"
import palenight from "../themes/palenight.json"
import rosepine from "../themes/rosepine.json"
import solarized from "../themes/solarized.json"
import synthwave84 from "../themes/synthwave84.json"
import tokyonight from "../themes/tokyonight.json"
import vercel from "../themes/vercel.json"
import vesper from "../themes/vesper.json"
import zenburn from "../themes/zenburn.json"

// Theme JSON types (from opencode)
type HexColor = `#${string}`
type RefName = string
type Variant = { dark: HexColor | RefName; light: HexColor | RefName }
type ColorValue = HexColor | RefName | Variant | RGBA

interface ThemeJson {
	$schema?: string
	defs?: Record<string, HexColor | RefName>
	theme: Record<string, ColorValue>
}

export const BUILTIN_THEMES: Record<string, ThemeJson> = {
	aura: aura as ThemeJson,
	ayu: ayu as ThemeJson,
	catppuccin: catppuccin as ThemeJson,
	"catppuccin-macchiato": catppuccinMacchiato as ThemeJson,
	cobalt2: cobalt2 as ThemeJson,
	dracula: dracula as ThemeJson,
	everforest: everforest as ThemeJson,
	flexoki: flexoki as ThemeJson,
	github: github as ThemeJson,
	gruvbox: gruvbox as ThemeJson,
	kanagawa: kanagawa as ThemeJson,
	"lucent-orng": lucentOrng as ThemeJson,
	material: material as ThemeJson,
	matrix: matrix as ThemeJson,
	mercury: mercury as ThemeJson,
	monokai: monokai as ThemeJson,
	nightowl: nightowl as ThemeJson,
	nord: nord as ThemeJson,
	"one-dark": onedark as ThemeJson,
	opencode: opencode as ThemeJson,
	orng: orng as ThemeJson,
	palenight: palenight as ThemeJson,
	rosepine: rosepine as ThemeJson,
	solarized: solarized as ThemeJson,
	synthwave84: synthwave84 as ThemeJson,
	tokyonight: tokyonight as ThemeJson,
	vercel: vercel as ThemeJson,
	vesper: vesper as ThemeJson,
	zenburn: zenburn as ThemeJson,
}

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
	// Extended markdown colors for tree-sitter
	markdownStrong: RGBA
	markdownEmph: RGBA
	markdownListEnumeration: RGBA
	markdownImage: RGBA
	markdownStrikethrough: RGBA

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
 * Default dark theme colors - soft contrast, minimal aesthetic
 */
const defaultDarkTheme: Theme = {
	// Muted, desaturated primaries
	primary: parseColor("#d4a373"),    // warm muted tan
	secondary: parseColor("#7d9bba"),  // soft steel blue
	accent: parseColor("#87a987"),     // sage green
	error: parseColor("#c47a7a"),      // soft coral
	warning: parseColor("#d4b483"),    // muted gold
	success: parseColor("#87a987"),    // sage green
	info: parseColor("#7d9bba"),       // soft steel blue

	text: parseColor("#c8c8c8"),       // soft white
	textMuted: parseColor("#6b6b6b"),  // medium gray

	background: parseColor("#161616"), // near black
	backgroundPanel: parseColor("#1a1a1a"),  // slightly lifted
	backgroundElement: parseColor("#222222"), // subtle contrast
	backgroundMenu: parseColor("#131313"),

	border: parseColor("#2a2a2a"),     // very subtle
	borderSubtle: parseColor("#222222"),
	borderActive: parseColor("#7d9bba"),

	selectionBg: parseColor("#333333"),
	selectionFg: parseColor("#e0e0e0"),

	// Softer diff colors
	diffAdded: parseColor("#87a987"),
	diffRemoved: parseColor("#c47a7a"),
	diffContext: parseColor("#6b6b6b"),
	diffAddedBg: parseColor("#1a2a1a"),
	diffRemovedBg: parseColor("#2a1a1a"),
	diffContextBg: parseColor("transparent"),
	diffLineNumberFg: parseColor("#4a4a4a"),
	diffLineNumberBg: parseColor("transparent"),
	diffAddedLineNumberBg: parseColor("#1a2a1a"),
	diffRemovedLineNumberBg: parseColor("#2a1a1a"),
	diffAddedSign: parseColor("#6b9b6b"),
	diffRemovedSign: parseColor("#b06060"),
	diffHighlightAddedBg: parseColor("#253525"),
	diffHighlightRemovedBg: parseColor("#352525"),

	// Markdown - muted
	markdownText: parseColor("#c8c8c8"),
	markdownHeading: parseColor("#a0a0a0"),
	markdownLink: parseColor("#9090a0"),
	markdownLinkUrl: parseColor("#606060"),
	markdownCode: parseColor("#b0a090"),
	markdownCodeBlock: parseColor("#b0b0b0"),
	markdownCodeBlockBorder: parseColor("#2a2a2a"),
	markdownBlockQuote: parseColor("#707070"),
	markdownBlockQuoteBorder: parseColor("#303030"),
	markdownHr: parseColor("#303030"),
	markdownListBullet: parseColor("#707070"),
	markdownStrong: parseColor("#c8c8c8"),
	markdownEmph: parseColor("#d4c48a"),
	markdownListEnumeration: parseColor("#7d9bba"),
	markdownImage: parseColor("#9090a0"),
	markdownStrikethrough: parseColor("#6b6b6b"),

	// Syntax - soft but readable contrast
	syntaxComment: parseColor("#5a5a5a"),
	syntaxString: parseColor("#98b998"),   // sage green, slightly brighter
	syntaxKeyword: parseColor("#b09cc0"),  // soft lavender
	syntaxFunction: parseColor("#8aafc8"), // steel blue
	syntaxVariable: parseColor("#c0c0c0"),
	syntaxType: parseColor("#d4c48a"),     // warm gold
	syntaxNumber: parseColor("#d4a87a"),   // soft orange
	syntaxConstant: parseColor("#d4a87a"),
	syntaxOperator: parseColor("#a0a0a0"),
	syntaxPunctuation: parseColor("#909090"),
	syntaxProperty: parseColor("#8ac0b0"), // teal
	syntaxTag: parseColor("#c09090"),      // dusty rose
	syntaxAttribute: parseColor("#d4c48a"),
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
	markdownStrong: parseColor("#4c4f69"),
	markdownEmph: parseColor("#df8e1d"),
	markdownListEnumeration: parseColor("#1e66f5"),
	markdownImage: parseColor("#ea76cb"),
	markdownStrikethrough: parseColor("#9ca0b0"),

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

/**
 * Resolve a ThemeJson to concrete RGBA colors for a given mode
 */
function resolveThemeJson(themeJson: ThemeJson, mode: ThemeMode): Partial<Record<string, RGBA>> {
	const defs = themeJson.defs ?? {}

	function resolveColor(c: ColorValue): RGBA {
		if (c instanceof RGBA) return c
		if (typeof c === "string") {
			if (c === "transparent" || c === "none") return parseColor("transparent")
			if (c.startsWith("#")) return parseColor(c)
			// Reference to defs
			if (defs[c] != null) return resolveColor(defs[c] as ColorValue)
			// Reference to another theme key
			if (themeJson.theme[c] !== undefined) return resolveColor(themeJson.theme[c] as ColorValue)
			// Unknown reference - return magenta as debug indicator
			console.warn(`Unknown color reference: ${c}`)
			return parseColor("#ff00ff")
		}
		// Variant object { dark: ..., light: ... }
		if (typeof c === "object" && c !== null && "dark" in c && "light" in c) {
			return resolveColor(c[mode] as ColorValue)
		}
		// Unknown - return magenta
		return parseColor("#ff00ff")
	}

	const resolved: Partial<Record<string, RGBA>> = {}
	for (const [key, value] of Object.entries(themeJson.theme)) {
		if (key === "$schema") continue
		resolved[key] = resolveColor(value as ColorValue)
	}
	return resolved
}

/**
 * Map resolved opencode theme colors to marvin ThemeColors with fallbacks
 */
function mapToThemeColors(resolved: Partial<Record<string, RGBA>>, mode: ThemeMode): Theme {
	const base = mode === "dark" ? defaultDarkTheme : defaultLightTheme

	// Helper to get color with fallback
	const get = (key: string, ...fallbacks: string[]): RGBA => {
		if (resolved[key]) return resolved[key]!
		for (const fb of fallbacks) {
			if (resolved[fb]) return resolved[fb]!
		}
		return base[key as keyof Theme] ?? base.text
	}

	return {
		primary: get("primary"),
		secondary: get("secondary"),
		accent: get("accent"),
		error: get("error"),
		warning: get("warning"),
		success: get("success"),
		info: get("info"),

		text: get("text"),
		textMuted: get("textMuted"),

		background: get("background"),
		backgroundPanel: get("backgroundPanel"),
		backgroundElement: get("backgroundElement"),
		backgroundMenu: get("backgroundMenu", "backgroundElement"),

		border: get("border"),
		borderSubtle: get("borderSubtle"),
		borderActive: get("borderActive"),

		selectionBg: get("selectionBg", "backgroundElement"),
		selectionFg: get("selectionFg", "text"),

		// Diff colors - map from opencode names
		diffAdded: get("diffAdded"),
		diffRemoved: get("diffRemoved"),
		diffContext: get("diffContext"),
		diffAddedBg: get("diffAddedBg"),
		diffRemovedBg: get("diffRemovedBg"),
		diffContextBg: get("diffContextBg"),
		diffLineNumberFg: get("diffLineNumber", "textMuted"),
		diffLineNumberBg: get("diffLineNumberBg", "background"),
		diffAddedLineNumberBg: get("diffAddedLineNumberBg", "diffAddedBg"),
		diffRemovedLineNumberBg: get("diffRemovedLineNumberBg", "diffRemovedBg"),
		diffAddedSign: get("diffAddedSign", "diffAdded"),
		diffRemovedSign: get("diffRemovedSign", "diffRemoved"),
		diffHighlightAddedBg: get("diffHighlightAddedBg", "diffAddedBg"),
		diffHighlightRemovedBg: get("diffHighlightRemovedBg", "diffRemovedBg"),

		// Markdown colors
		markdownText: get("markdownText", "text"),
		markdownHeading: get("markdownHeading", "primary"),
		markdownLink: get("markdownLink", "accent"),
		markdownLinkUrl: get("markdownLinkUrl", "markdownLinkText", "textMuted"),
		markdownCode: get("markdownCode", "success"),
		markdownCodeBlock: get("markdownCodeBlock", "text"),
		markdownCodeBlockBorder: get("markdownCodeBlockBorder", "border"),
		markdownBlockQuote: get("markdownBlockQuote", "textMuted"),
		markdownBlockQuoteBorder: get("markdownBlockQuoteBorder", "border"),
		markdownHr: get("markdownHorizontalRule", "border"),
		markdownListBullet: get("markdownListBullet", "markdownListItem", "accent"),
		markdownStrong: get("markdownStrong", "text"),
		markdownEmph: get("markdownEmph", "warning"),
		markdownListEnumeration: get("markdownListEnumeration", "markdownListBullet"),
		markdownImage: get("markdownImage", "markdownLink"),
		markdownStrikethrough: get("markdownStrikethrough", "textMuted"),

		// Syntax colors
		syntaxComment: get("syntaxComment"),
		syntaxString: get("syntaxString"),
		syntaxKeyword: get("syntaxKeyword"),
		syntaxFunction: get("syntaxFunction"),
		syntaxVariable: get("syntaxVariable"),
		syntaxType: get("syntaxType"),
		syntaxNumber: get("syntaxNumber"),
		syntaxConstant: get("syntaxConstant", "syntaxNumber"),
		syntaxOperator: get("syntaxOperator"),
		syntaxPunctuation: get("syntaxPunctuation"),
		syntaxProperty: get("syntaxProperty", "syntaxVariable"),
		syntaxTag: get("syntaxTag", "syntaxKeyword"),
		syntaxAttribute: get("syntaxAttribute", "syntaxProperty"),
	}
}

export type SyntaxVariant = "normal" | "subtle"

export function createSyntaxStyle(theme: Theme, variant: SyntaxVariant = "normal"): SyntaxStyle {
	const rules = getSyntaxRules(theme)
	if (variant === "subtle") {
		return SyntaxStyle.fromTheme(
			rules.map((rule) => ({
				...rule,
				style: { ...rule.style, dim: true },
			})),
		)
	}
	return SyntaxStyle.fromTheme(rules)
}

interface SyntaxRule {
	scope: string[]
	style: {
		foreground?: RGBA
		background?: RGBA
		bold?: boolean
		italic?: boolean
		underline?: boolean
	}
}

function getSyntaxRules(theme: Theme): SyntaxRule[] {
	return [
		// Default text
		{ scope: ["default"], style: { foreground: theme.text } },

		// Comments
		{ scope: ["comment", "comment.documentation"], style: { foreground: theme.syntaxComment, italic: true } },

		// Strings
		{ scope: ["string", "symbol"], style: { foreground: theme.syntaxString } },
		{ scope: ["string.escape", "string.regexp"], style: { foreground: theme.syntaxKeyword } },
		{ scope: ["character", "character.special"], style: { foreground: theme.syntaxString } },

		// Numbers and constants
		{ scope: ["number", "boolean", "float"], style: { foreground: theme.syntaxNumber } },
		{ scope: ["constant", "constant.builtin"], style: { foreground: theme.syntaxConstant } },

		// Keywords
		{ scope: ["keyword"], style: { foreground: theme.syntaxKeyword, italic: true } },
		{
			scope: ["keyword.function", "keyword.return", "keyword.conditional", "keyword.repeat"],
			style: { foreground: theme.syntaxKeyword, italic: true },
		},
		{ scope: ["keyword.operator", "operator"], style: { foreground: theme.syntaxOperator } },
		{ scope: ["keyword.import", "keyword.export"], style: { foreground: theme.syntaxKeyword } },
		{ scope: ["keyword.type"], style: { foreground: theme.syntaxType, bold: true, italic: true } },

		// Functions
		{
			scope: ["function", "function.call", "function.method", "function.method.call", "function.builtin"],
			style: { foreground: theme.syntaxFunction },
		},
		{ scope: ["constructor"], style: { foreground: theme.syntaxFunction } },

		// Variables and parameters
		{ scope: ["variable", "variable.parameter", "parameter"], style: { foreground: theme.syntaxVariable } },
		{ scope: ["variable.member", "property", "field"], style: { foreground: theme.syntaxProperty } },
		{ scope: ["variable.builtin", "variable.super"], style: { foreground: theme.error } },

		// Types
		{ scope: ["type", "type.builtin", "type.definition"], style: { foreground: theme.syntaxType } },
		{ scope: ["class", "module", "namespace"], style: { foreground: theme.syntaxType } },

		// Punctuation
		{ scope: ["punctuation", "punctuation.bracket", "punctuation.delimiter"], style: { foreground: theme.syntaxPunctuation } },
		{ scope: ["punctuation.special"], style: { foreground: theme.syntaxOperator } },

		// Tags (HTML/XML)
		{ scope: ["tag"], style: { foreground: theme.syntaxTag } },
		{ scope: ["tag.attribute"], style: { foreground: theme.syntaxAttribute } },
		{ scope: ["tag.delimiter"], style: { foreground: theme.syntaxOperator } },

		// Attributes and annotations
		{ scope: ["attribute", "annotation"], style: { foreground: theme.warning } },

		// Markdown specific
		{
			scope: ["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"],
			style: { foreground: theme.markdownHeading, bold: true },
		},
		{ scope: ["markup.bold", "markup.strong"], style: { foreground: theme.markdownStrong, bold: true } },
		{ scope: ["markup.italic"], style: { foreground: theme.markdownEmph, italic: true } },
		{ scope: ["markup.strikethrough"], style: { foreground: theme.markdownStrikethrough } },
		{ scope: ["markup.link", "markup.link.url"], style: { foreground: theme.markdownLink, underline: true } },
		{ scope: ["markup.link.label", "label"], style: { foreground: theme.markdownLinkUrl } },
		{ scope: ["markup.raw", "markup.raw.inline", "markup.raw.block"], style: { foreground: theme.markdownCode } },
		{ scope: ["markup.list"], style: { foreground: theme.markdownListBullet } },
		{ scope: ["markup.list.checked"], style: { foreground: theme.success } },
		{ scope: ["markup.list.unchecked"], style: { foreground: theme.textMuted } },
		{ scope: ["markup.quote"], style: { foreground: theme.markdownBlockQuote, italic: true } },

		// Diff
		{ scope: ["diff.plus"], style: { foreground: theme.diffAdded, background: theme.diffAddedBg } },
		{ scope: ["diff.minus"], style: { foreground: theme.diffRemoved, background: theme.diffRemovedBg } },
		{ scope: ["diff.delta"], style: { foreground: theme.diffContext, background: theme.diffContextBg } },

		// Conceal (for hidden markdown syntax)
		{ scope: ["conceal"], style: { foreground: theme.textMuted } },

		// Misc
		{ scope: ["spell", "nospell"], style: { foreground: theme.text } },
		{ scope: ["error"], style: { foreground: theme.error, bold: true } },
		{ scope: ["warning"], style: { foreground: theme.warning, bold: true } },
		{ scope: ["info"], style: { foreground: theme.info } },
	]
}

interface ThemeContextValue {
	theme: Theme
	mode: Accessor<ThemeMode>
	setMode: (mode: ThemeMode) => void
	syntaxStyle: SyntaxStyle
	subtleSyntaxStyle: SyntaxStyle
	// Named theme support
	themeName: Accessor<string>
	setTheme: (name: string) => void
	availableThemes: () => string[]
}

const ThemeContext: Context<ThemeContextValue | undefined> = createContext<ThemeContextValue>()

export interface ThemeProviderProps extends ParentProps {
	/** Initial theme mode */
	mode?: ThemeMode
	/** Initial theme name (default: "marvin") */
	themeName?: string
	/** Custom theme overrides (applied on top of named theme) */
	customTheme?: Partial<Theme>
	/** Callback when theme changes (for persistence) */
	onThemeChange?: (name: string) => void
}

export function ThemeProvider(props: ThemeProviderProps): JSX.Element {
	const [store, setStore] = createStore({
		mode: props.mode ?? "dark",
		themeName: props.themeName ?? "marvin",
	})

	// Sync themeName prop changes to store (for external control)
	createEffect(() => {
		if (props.themeName !== undefined && props.themeName !== store.themeName) {
			setStore("themeName", props.themeName)
		}
	})

	const resolvedTheme = createMemo((): Theme => {
		const name = store.themeName
		const mode = store.mode

		// "marvin" is the built-in default
		if (name === "marvin" || !BUILTIN_THEMES[name]) {
			const base = mode === "dark" ? defaultDarkTheme : defaultLightTheme
			return { ...base, ...props.customTheme }
		}

		// Resolve named theme
		const themeJson = BUILTIN_THEMES[name]
		const resolved = resolveThemeJson(themeJson, mode)
		const mapped = mapToThemeColors(resolved, mode)
		return { ...mapped, ...props.customTheme }
	})

	// Use createMemo for syntax styles - they'll recompute when theme changes
	const syntaxStyle = createMemo(() => createSyntaxStyle(resolvedTheme(), "normal"))
	const subtleSyntaxStyle = createMemo(() => createSyntaxStyle(resolvedTheme(), "subtle"))

	// Note: SyntaxStyle cleanup is handled internally by opentui when memos recompute

	const value: ThemeContextValue = {
		get theme(): Theme {
			return resolvedTheme()
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
		themeName: (): string => store.themeName,
		setTheme: (name: string): void => {
			setStore("themeName", name)
			props.onThemeChange?.(name)
		},
		availableThemes: (): string[] => ["marvin", ...Object.keys(BUILTIN_THEMES)],
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

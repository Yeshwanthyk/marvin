# Port OpenCode Themes to Marvin Implementation Plan

## Overview
Port the opencode theme system (29 named themes + theme resolution) to marvin's open-tui package, enabling users to switch themes via config or `/theme` slash command.

## Current State

### Marvin (open-tui)
- `packages/open-tui/src/context/theme.tsx` - simple dark/light mode toggle
- `ThemeProvider` accepts `mode?: "dark" | "light"` and `customTheme?: Partial<Theme>`
- No named themes, no runtime theme switching
- Config at `~/.config/marvin/config.json` has no `theme` field

### OpenCode
- 29 theme JSON files at `packages/opencode/src/cli/cmd/tui/context/theme/`
- Theme JSON format: `{ defs: {...}, theme: {...} }` with dark/light variants
- Resolution logic handles: hex colors, def references, dark/light variants
- Persists theme choice via KV store + config file
- `/theme` slash command opens picker dialog

### Key Discoveries
- **ThemeColors mismatch**: opencode and marvin have similar but not identical interfaces
  - Opencode has: `selectedListItemText`, `diffHunkHeader`, `markdownEmph`, `markdownStrong`, `markdownListEnumeration`, `markdownImage`, `markdownImageText`
  - Marvin has: `selectionBg`, `selectionFg`, `diffAddedSign`, `diffRemovedSign`, `diffHighlightAddedBg`, `diffHighlightRemovedBg`, `markdownLinkUrl`, `markdownCodeBlockBorder`, `markdownBlockQuoteBorder`, `markdownHr`, `markdownListBullet`, `syntaxConstant`, `syntaxProperty`, `syntaxTag`, `syntaxAttribute`
- **Resolution needed**: Theme JSONs use `{ dark: "...", light: "..." }` variants and def references
- **Slash commands**: `apps/coding-agent/src/autocomplete-commands.ts` defines available commands

## Desired End State
- 29 named themes available in marvin
- Theme selectable via `~/.config/marvin/config.json`: `{ "theme": "dracula" }`
- `/theme` slash command lists available themes
- `/theme <name>` switches immediately and persists
- Dark/light mode still works within each theme

### How to Verify
```bash
bun run check                    # typecheck + test pass
bun run marvin                   # start TUI
# In TUI: type /theme → see list of themes
# Select "dracula" → colors change immediately
# Restart marvin → dracula still active
cat ~/.config/marvin/config.json # should show "theme": "dracula"
```

## Out of Scope
- Custom user themes from `~/.config/marvin/themes/` (defer)
- System theme generation from terminal palette (defer)
- Theme editor/preview (defer)

## Error Handling Strategy
- Unknown theme name → fall back to "marvin" (default)
- Missing theme field in JSON → use sensible fallback from resolved colors
- Never throw in theme resolution; log warning and continue

## Implementation Approach

**Strategy**: Minimal adaptation layer
1. Copy theme JSONs as-is from opencode
2. Add theme resolution logic to open-tui (adapted from opencode)
3. Map resolved opencode colors → marvin ThemeColors with fallbacks
4. Wire config + slash command in coding-agent

**Alternative considered**: Convert all theme JSONs to marvin format upfront
- Rejected: 29 files × manual conversion = error-prone, hard to sync with opencode updates

---

## Phase 1: Add Theme JSONs and Resolution Logic to open-tui

### Overview
Copy theme JSON files and add resolution/mapping logic to `packages/open-tui/src/context/theme.tsx`.

### Prerequisites
- [ ] Clean working tree

### Changes

#### 1. Create themes directory and copy JSONs
```bash
mkdir -p packages/open-tui/src/themes
cp /Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/cli/cmd/tui/context/theme/*.json packages/open-tui/src/themes/
```

#### 2. Add theme imports and types
**File**: `packages/open-tui/src/context/theme.tsx`
**Lines**: 1-10 (add after existing imports)

**Add**:
```typescript
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
	// "marvin" is the built-in default (current defaultDarkTheme/defaultLightTheme)
}
```

#### 3. Add theme resolution function
**File**: `packages/open-tui/src/context/theme.tsx`
**Lines**: After BUILTIN_THEMES definition

**Add**:
```typescript
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
		if (typeof c === "object" && "dark" in c && "light" in c) {
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
```

#### 4. Update ThemeProviderProps and ThemeContextValue
**File**: `packages/open-tui/src/context/theme.tsx`

**Before** (ThemeContextValue interface):
```typescript
interface ThemeContextValue {
	theme: Theme
	mode: Accessor<ThemeMode>
	setMode: (mode: ThemeMode) => void
	syntaxStyle: SyntaxStyle
	subtleSyntaxStyle: SyntaxStyle
}
```

**After**:
```typescript
interface ThemeContextValue {
	theme: Theme
	mode: Accessor<ThemeMode>
	setMode: (mode: ThemeMode) => void
	syntaxStyle: SyntaxStyle
	subtleSyntaxStyle: SyntaxStyle
	// New: named theme support
	themeName: Accessor<string>
	setTheme: (name: string) => void
	availableThemes: () => string[]
}
```

**Before** (ThemeProviderProps):
```typescript
export interface ThemeProviderProps extends ParentProps {
	/** Initial theme mode */
	mode?: ThemeMode
	/** Custom theme overrides */
	customTheme?: Partial<Theme>
}
```

**After**:
```typescript
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
```

#### 5. Update ThemeProvider implementation
**File**: `packages/open-tui/src/context/theme.tsx`

**Before**:
```typescript
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
```

**After**:
```typescript
export function ThemeProvider(props: ThemeProviderProps): JSX.Element {
	const [store, setStore] = createStore({
		mode: props.mode ?? "dark",
		themeName: props.themeName ?? "marvin",
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

	const syntaxStyle = createMemo(() => createSyntaxStyle(resolvedTheme(), "normal"))
	const subtleSyntaxStyle = createMemo(() => createSyntaxStyle(resolvedTheme(), "subtle"))

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
```

#### 6. Export BUILTIN_THEMES from index
**File**: `packages/open-tui/src/index.ts`

**Add export** (find existing theme exports):
```typescript
export { BUILTIN_THEMES } from "./context/theme"
```

### Success Criteria
```bash
cd packages/open-tui && bun run typecheck   # or tsc --noEmit
bun run check                                # full check
```

### Rollback
```bash
rm -rf packages/open-tui/src/themes/
git checkout HEAD -- packages/open-tui/src/context/theme.tsx packages/open-tui/src/index.ts
```

---

## Phase 2: Wire Theme Config in Marvin

### Overview
Update marvin config to read `theme` field and pass to ThemeProvider.

### Prerequisites
- [ ] Phase 1 complete and typechecks

### Changes

#### 1. Update LoadedAppConfig interface
**File**: `apps/coding-agent/src/config.ts`

**Before**:
```typescript
export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
}
```

**After**:
```typescript
export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  theme: string;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
}
```

#### 2. Read theme from config
**File**: `apps/coding-agent/src/config.ts`
**Lines**: In `loadAppConfig` function, after `thinking` resolution

**Add** (before `return`):
```typescript
  // Theme - default to "marvin"
  const themeRaw = rawObj.theme;
  const theme = typeof themeRaw === "string" && themeRaw.trim() ? themeRaw.trim() : "marvin";
```

**Update return**:
```typescript
  return {
    provider,
    modelId: model.id,
    model,
    thinking,
    theme,  // Add this line
    systemPrompt,
    agentsConfig,
    configDir,
    configPath,
  };
```

#### 3. Add theme to updateAppConfig
**File**: `apps/coding-agent/src/config.ts`
**Lines**: In `updateAppConfig` function

**Before**:
```typescript
export const updateAppConfig = async (
  options: { configDir?: string; configPath?: string },
  patch: { provider?: string; model?: string; thinking?: ThinkingLevel; systemPrompt?: string }
): Promise<void> => {
```

**After**:
```typescript
export const updateAppConfig = async (
  options: { configDir?: string; configPath?: string },
  patch: { provider?: string; model?: string; thinking?: ThinkingLevel; theme?: string; systemPrompt?: string }
): Promise<void> => {
```

**Add** (in the patching logic):
```typescript
  if (patch.theme) next.theme = patch.theme;
```

#### 4. Pass theme to ThemeProvider
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: Around line 381

**Before**:
```tsx
	return (
		<ThemeProvider mode="dark">
			<MainView messages={messages()} ...
```

**After**:
```tsx
	const [currentTheme, setCurrentTheme] = createSignal(props.config.theme)

	const handleThemeChange = async (name: string) => {
		setCurrentTheme(name)
		await updateAppConfig({ configDir: props.config.configDir }, { theme: name })
	}

	return (
		<ThemeProvider mode="dark" themeName={currentTheme()} onThemeChange={handleThemeChange}>
			<MainView messages={messages()} ...
```

**Add import** at top:
```typescript
import { updateAppConfig } from "./config.js"
```

### Success Criteria
```bash
bun run check
# Manual: edit ~/.config/marvin/config.json to add "theme": "dracula"
# Run bun run marvin - should show dracula colors
```

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/config.ts apps/coding-agent/src/tui-app.tsx
```

---

## Phase 3: Add /theme Slash Command

### Overview
Add `/theme` and `/theme <name>` slash commands to switch themes at runtime.

### Prerequisites
- [ ] Phase 2 complete

### Changes

#### 1. Add theme command to slash commands
**File**: `apps/coding-agent/src/autocomplete-commands.ts`

**Add** to `slashCommands` array:
```typescript
  {
    name: 'theme',
    description: 'Set theme: /theme <name> (or /theme to list)',
    getArgumentCompletions: (argumentText: string) => {
      const prefix = argumentText.trim().toLowerCase();
      const themes = ['marvin', 'aura', 'ayu', 'catppuccin', 'catppuccin-macchiato', 'cobalt2', 
        'dracula', 'everforest', 'flexoki', 'github', 'gruvbox', 'kanagawa', 'lucent-orng',
        'material', 'matrix', 'mercury', 'monokai', 'nightowl', 'nord', 'one-dark', 'opencode',
        'orng', 'palenight', 'rosepine', 'solarized', 'synthwave84', 'tokyonight', 'vercel',
        'vesper', 'zenburn'];
      return themes
        .filter((t) => t.startsWith(prefix))
        .map((t) => ({ value: t, label: t }));
    },
  },
```

#### 2. Handle /theme command in tui-app
**File**: `apps/coding-agent/src/tui-app.tsx`
**Lines**: Find the slash command handling section (around line 329)

**Find** the switch/if block that handles slash commands and **add**:
```typescript
		if (cmd === "theme") {
			const themeName = args.trim()
			if (!themeName) {
				// List available themes
				const { availableThemes, themeName: current } = useTheme()
				const list = availableThemes().map(t => t === current() ? `• ${t} (current)` : `  ${t}`).join('\n')
				// Show as a system message or toast
				addToast({ type: "info", title: "Available Themes", message: list, duration: 10000 })
				return
			}
			// Set theme
			handleThemeChange(themeName)
			addToast({ type: "success", title: "Theme Changed", message: `Switched to ${themeName}`, duration: 3000 })
			return
		}
```

**Note**: The exact integration depends on how slash commands are currently processed. May need to pass `handleThemeChange` and `addToast` to the handler.

#### 3. Alternative: Add theme handler to MainView props
If slash command handling is in MainView, add props and handle there.

### Success Criteria
```bash
bun run check
# Manual: run marvin, type /theme → see completions
# Type /theme dracula → theme changes
# Restart → theme persists
```

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/autocomplete-commands.ts apps/coding-agent/src/tui-app.tsx
```

---

## Testing Strategy

### Manual Testing Checklist
1. [ ] `bun run marvin` starts with default "marvin" theme
2. [ ] Edit config.json to `"theme": "dracula"` → restart → dracula colors
3. [ ] `/theme` shows completions for all 30 themes
4. [ ] `/theme catppuccin` switches immediately
5. [ ] After `/theme` switch, restart → theme persists
6. [ ] Invalid theme name → falls back to marvin, no crash
7. [ ] Dark/light mode toggle still works within theme

### Themes to Spot-Check
- `dracula` - high contrast, well-known
- `catppuccin` - pastel, popular
- `gruvbox` - warm, distinct
- `nord` - cool, muted

## Anti-Patterns to Avoid
- Don't hardcode theme list in multiple places (use BUILTIN_THEMES)
- Don't throw on invalid theme names - fallback gracefully
- Don't forget to handle the "marvin" default case

## Open Questions
- [x] Should we support custom themes from `~/.config/marvin/themes/`? → Defer to future
- [x] Should mode (dark/light) be per-theme or global? → Global (matches opencode)

## References
- OpenCode theme system: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- OpenCode theme JSONs: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/cli/cmd/tui/context/theme/*.json`
- Marvin config: `apps/coding-agent/src/config.ts`
- Marvin TUI: `apps/coding-agent/src/tui-app.tsx`

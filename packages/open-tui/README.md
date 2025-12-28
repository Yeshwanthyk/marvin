# @marvin-agents/open-tui

A Terminal User Interface library built on [OpenTUI](https://github.com/anthropics/opentui) with SolidJS reactive rendering.

## Installation

```bash
bun add @marvin-agents/open-tui
```

## Quick Start

```tsx
import { render } from "@opentui/solid"
import { ThemeProvider, useTheme, Markdown, Panel } from "@marvin-agents/open-tui"

function App() {
  const { theme } = useTheme()
  
  return (
    <Panel variant="panel" padding={1}>
      <Markdown text="# Hello World\n\nThis is **bold** text." />
    </Panel>
  )
}

render(
  () => (
    <ThemeProvider mode="dark" themeName="tokyonight">
      <App />
    </ThemeProvider>
  ),
  { exitOnCtrlC: true }
)
```

## Components

### Layout
- `Panel` - Bordered container with theme variants
- `Dialog` - Modal overlay with backdrop
- `Spacer` - Flexible space filler
- `Divider` - Horizontal/vertical separator

### Content
- `Markdown` - Tree-sitter highlighted markdown
- `CodeBlock` - Syntax-highlighted code with line numbers
- `Diff` - Unified/split diff view
- `Image` - Kitty/iTerm2 inline images

### Input
- `Editor` - Multi-line text input
- `Input` - Single-line text input
- `SelectList` - Filterable selection list

### Feedback
- `Loader` - Animated spinner
- `Toast` / `ToastViewport` - Notification toasts
- `Badge` - Status badges

## Theming

### Built-in Themes
```tsx
<ThemeProvider themeName="dracula" mode="dark">
```

Available themes: `aura`, `ayu`, `catppuccin`, `cobalt2`, `dracula`, `everforest`, 
`flexoki`, `github`, `gruvbox`, `kanagawa`, `material`, `monokai`, `nightowl`, 
`nord`, `one-dark`, `palenight`, `rosepine`, `solarized`, `synthwave84`, 
`tokyonight`, `vercel`, `vesper`, `zenburn`, and more.

### Custom Theme Overrides
```tsx
<ThemeProvider 
  themeName="dracula"
  customTheme={{ primary: parseColor("#ff79c6") }}
>
```

### Accessing Theme
```tsx
function MyComponent() {
  const { theme, mode, setMode, themeName, setTheme } = useTheme()
  
  return <text fg={theme.primary}>Themed text</text>
}
```

## Tree-sitter Setup

For syntax highlighting, configure parsers before rendering:

```tsx
import { configureParsers } from "@marvin-agents/open-tui"

await configureParsers({
  languages: ["typescript", "python", "markdown"],
  wasmPath: "./parsers" // Path to .wasm files
})
```

## Autocomplete

```tsx
import { CombinedAutocompleteProvider } from "@marvin-agents/open-tui"

const provider = new CombinedAutocompleteProvider(
  [{ name: "help", description: "Show help" }],
  process.cwd()
)

// Get suggestions
const suggestions = provider.getSuggestions(lines, cursorLine, cursorCol)

// Apply completion
const result = provider.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
```

## License

MIT

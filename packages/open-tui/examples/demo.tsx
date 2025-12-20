/**
 * Demo app showing open-tui components
 *
 * Run with: cd packages/open-tui && bun run demo
 */

import { TextAttributes } from "@opentui/core"
import { render, useKeyboard } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import {
	Loader,
	Markdown,
	SelectList,
	Spacer,
	ThemeProvider,
	useTheme,
	type SelectItem,
} from "../src/index.js"

const DEMO_MARKDOWN = `# OpenTUI Demo

This is **bold** and *italic* text.

## Features

- Markdown rendering
- Select lists  
- Loader animation

\`\`\`typescript
const hello = "world"
\`\`\`

> A blockquote
`

const DEMO_ITEMS: SelectItem[] = [
	{ value: "markdown", label: "Markdown Demo", description: "Show markdown rendering" },
	{ value: "loader", label: "Loader Demo", description: "Show loading spinner" },
	{ value: "select", label: "Select List Demo", description: "Show this list" },
]

function DemoApp() {
	const { theme } = useTheme()
	const [currentView, setCurrentView] = createSignal<string>("select")
	const [selectedIndex, setSelectedIndex] = createSignal(0)

	useKeyboard({
		onKey: (e) => {
			if (e.name === "escape") {
				setCurrentView("select")
				return
			}
			if (currentView() === "select") {
				if (e.name === "up") {
					setSelectedIndex((i) => (i === 0 ? DEMO_ITEMS.length - 1 : i - 1))
				} else if (e.name === "down") {
					setSelectedIndex((i) => (i === DEMO_ITEMS.length - 1 ? 0 : i + 1))
				} else if (e.name === "return") {
					const item = DEMO_ITEMS[selectedIndex()]
					if (item) setCurrentView(item.value)
				} else if (e.name === "q") {
					process.exit(0)
				}
			}
		},
	})

	return (
		<box flexDirection="column" padding={1}>
			<text fg={theme.primary} attributes={TextAttributes.BOLD}>
				OpenTUI Component Demo
			</text>
			<text fg={theme.textMuted}>Press ESC to go back, Q to quit</text>
			<box height={1} />

			<Show when={currentView() === "select"}>
				<SelectList
					items={DEMO_ITEMS}
					selectedIndex={selectedIndex()}
					maxVisible={10}
					onSelect={(item) => setCurrentView(item.value)}
				/>
			</Show>

			<Show when={currentView() === "markdown"}>
				<Markdown text={DEMO_MARKDOWN} paddingX={1} />
			</Show>

			<Show when={currentView() === "loader"}>
				<box flexDirection="column" gap={1}>
					<Loader message="Loading..." color={theme.primary} dimColor={theme.textMuted} />
					<text fg={theme.textMuted}>Press ESC to go back</text>
				</box>
			</Show>

			<Spacer />
			<text fg={theme.textMuted}>View: {currentView()}</text>
		</box>
	)
}

// Start the app
render(
	() => (
		<ThemeProvider mode="dark">
			<DemoApp />
		</ThemeProvider>
	),
	{
		targetFps: 60,
		exitOnCtrlC: true,
		useKittyKeyboard: {},
	},
)

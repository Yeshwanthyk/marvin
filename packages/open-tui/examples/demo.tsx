/**
 * Demo app showing open-tui components
 *
 * Run with: cd packages/open-tui && bun run demo
 */

import { TextAttributes } from "@opentui/core"
import { render, useKeyboard } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import {
	CodeBlock,
	Dialog,
	Diff,
	Editor,
	type EditorRef,
	Loader,
	Markdown,
	SelectList,
	Spacer,
	ThemeProvider,
	Toast,
	ToastViewport,
	type ToastItem,
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

const DEMO_CODE = `function fibonacci(n: number): number {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}

// Calculate first 10 fibonacci numbers
const results = Array.from({ length: 10 }, (_, i) => fibonacci(i))
console.log(results)
`

const DEMO_DIFF = `--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,6 @@
 function greet(name: string) {
-  console.log("Hello, " + name)
+  const message = \`Hello, \${name}!\`
+  console.log(message)
+  return message
 }
`

const DEMO_ITEMS: SelectItem[] = [
	{ value: "markdown", label: "Markdown Demo", description: "Show markdown rendering" },
	{ value: "code", label: "Code Block Demo", description: "Show syntax highlighting" },
	{ value: "diff", label: "Diff Demo", description: "Show diff rendering" },
	{ value: "loader", label: "Loader Demo", description: "Show loading spinner" },
	{ value: "editor", label: "Editor Demo", description: "Show text editor" },
	{ value: "dialog", label: "Dialog Demo", description: "Show modal dialog" },
	{ value: "toast", label: "Toast Demo", description: "Show notifications" },
	{ value: "select", label: "Select List Demo", description: "Show this list" },
]

function DemoApp() {
	const { theme } = useTheme()
	const [currentView, setCurrentView] = createSignal<string>("select")
	const [selectedIndex, setSelectedIndex] = createSignal(0)
	const [dialogOpen, setDialogOpen] = createSignal(false)
	const [toasts, setToasts] = createSignal<ToastItem[]>([])
	const [editorValue, setEditorValue] = createSignal("")
	let editorRef: EditorRef | undefined

	const addToast = (variant: ToastItem["variant"]) => {
		const id = `toast-${Date.now()}`
		setToasts((prev) => [
			...prev,
			{
				id,
				title: `${variant?.toUpperCase() ?? "INFO"} Toast`,
				message: "This will auto-dismiss in 3 seconds",
				variant,
				duration: 3000,
			},
		])
	}

	const dismissToast = (id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id))
	}

	useKeyboard((e) => {
		if (e.name === "escape") {
			if (dialogOpen()) {
				setDialogOpen(false)
			} else if (currentView() !== "select") {
				setCurrentView("select")
			}
			return
		}

		if (currentView() === "select") {
			if (e.name === "up") {
				setSelectedIndex((i) => (i === 0 ? DEMO_ITEMS.length - 1 : i - 1))
			} else if (e.name === "down") {
				setSelectedIndex((i) => (i === DEMO_ITEMS.length - 1 ? 0 : i + 1))
			} else if (e.name === "return") {
				const item = DEMO_ITEMS[selectedIndex()]
				if (item) {
					if (item.value === "dialog") {
						setDialogOpen(true)
					} else {
						setCurrentView(item.value)
					}
				}
			} else if (e.name === "q") {
				process.exit(0)
			}
		}

		// Toast demo controls
		if (currentView() === "toast") {
			if (e.name === "1") addToast("info")
			if (e.name === "2") addToast("success")
			if (e.name === "3") addToast("warning")
			if (e.name === "4") addToast("error")
		}
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
					onSelect={(item) => {
						if (item.value === "dialog") {
							setDialogOpen(true)
						} else {
							setCurrentView(item.value)
						}
					}}
				/>
			</Show>

			<Show when={currentView() === "markdown"}>
				<Markdown text={DEMO_MARKDOWN} />
			</Show>

			<Show when={currentView() === "code"}>
				<box flexDirection="column" gap={1}>
					<text fg={theme.text}>Code Block with TypeScript highlighting:</text>
					<CodeBlock content={DEMO_CODE} filetype="typescript" title="fibonacci.ts" />
				</box>
			</Show>

			<Show when={currentView() === "diff"}>
				<box flexDirection="column" gap={1}>
					<text fg={theme.text}>Unified Diff View:</text>
					<Diff diffText={DEMO_DIFF} filetype="typescript" />
				</box>
			</Show>

			<Show when={currentView() === "loader"}>
				<box flexDirection="column" gap={1}>
					<Loader message="Loading with theme colors..." />
					<text fg={theme.textMuted}>Press ESC to go back</text>
				</box>
			</Show>

			<Show when={currentView() === "editor"}>
				<box flexDirection="column" gap={1}>
					<text fg={theme.text}>Editor (type something, Cmd+Enter for newline):</text>
					<Editor
						ref={(r) => (editorRef = r)}
						value={editorValue()}
						onChange={setEditorValue}
						placeholder="Type here..."
						focused
						minHeight={3}
						maxHeight={10}
						width="80%"
					/>
					<text fg={theme.textMuted}>
						Current value: {editorValue() || "(empty)"} ({editorValue().length} chars)
					</text>
				</box>
			</Show>

			<Show when={currentView() === "toast"}>
				<box flexDirection="column" gap={1}>
					<text fg={theme.text}>Press number keys to show toasts:</text>
					<text fg={theme.textMuted}>1=Info 2=Success 3=Warning 4=Error</text>
					<box height={1} />
					<text fg={theme.textMuted}>Toasts appear in top-right and auto-dismiss after 3s</text>
				</box>
			</Show>

			{/* Toast Viewport - always rendered */}
			<ToastViewport
				toasts={toasts()}
				onDismiss={dismissToast}
				defaultDuration={3000}
			/>

			{/* Dialog */}
			<Dialog
				open={dialogOpen()}
				title="Example Dialog"
				onClose={() => setDialogOpen(false)}
			>
				<text fg={theme.text}>This is a modal dialog.</text>
				<box height={1} />
				<text fg={theme.textMuted}>Press ESC or click outside to close.</text>
			</Dialog>

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

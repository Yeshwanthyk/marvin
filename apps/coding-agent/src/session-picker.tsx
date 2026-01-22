/**
 * OpenTUI-based session picker
 */

import { render, useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { SelectList, ThemeProvider, useTheme, type SelectItem, type SelectListRef, type ThemeMode } from "@yeshwanthyk/open-tui"
import type { SessionManager } from "./session-manager.js"

/** Detect system dark/light mode (macOS only, defaults to dark) */
function detectThemeMode(): ThemeMode {
	try {
		const result = Bun.spawnSync(["defaults", "read", "-g", "AppleInterfaceStyle"])
		return result.stdout.toString().trim().toLowerCase() === "dark" ? "dark" : "light"
	} catch {
		return "dark"
	}
}

interface SessionPickerProps {
	sessions: Array<{
		path: string
		firstMessage: string
		timestamp: number
		messageCount: number
		modelId: string
	}>
	onSelect: (path: string) => void
	onCancel: () => void
}

function SessionPickerApp(props: SessionPickerProps) {
	const { theme } = useTheme()
	const dimensions = useTerminalDimensions()
	let listRef: SelectListRef | undefined

	const items: SelectItem[] = props.sessions.map((s) => ({
		value: s.path,
		label: formatFirstMessage(s.firstMessage),
		description: formatMeta(s.timestamp, s.messageCount, s.modelId),
	}))

	useKeyboard((e: { name: string; ctrl?: boolean }) => {
		if (e.name === "up" || (e.ctrl && e.name === "p")) {
			listRef?.moveUp()
		} else if (e.name === "down" || (e.ctrl && e.name === "n")) {
			listRef?.moveDown()
		} else if (e.name === "return") {
			listRef?.select()
		} else if (e.name === "escape" || (e.ctrl && e.name === "c")) {
			props.onCancel()
		}
	})

	return (
		<box
			flexDirection="column"
			width={dimensions().width}
			height={dimensions().height}
		>
			<text fg={theme.textMuted}>Resume Session</text>
			<box height={1} />
			<SelectList
				ref={(r) => { listRef = r }}
				items={items}
				maxVisible={Math.min(10, dimensions().height - 4)}
				width={dimensions().width - 2}
				onSelect={(item) => props.onSelect(item.value)}
				onCancel={props.onCancel}
			/>
			<box flexGrow={1} />
			<text fg={theme.textMuted}>↑/↓ navigate · Enter select · Esc cancel</text>
		</box>
	)
}

function formatFirstMessage(msg: string): string {
	return msg.replace(/\n/g, " ").slice(0, 60)
}

function formatMeta(ts: number, count: number, model: string): string {
	const ago = formatRelativeTime(ts)
	return `${ago} · ${count} msgs · ${model}`
}

function formatRelativeTime(ts: number): string {
	const seconds = Math.floor((Date.now() - ts) / 1000)
	if (seconds < 60) return `${seconds}s ago`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

export async function selectSession(sessionManager: SessionManager): Promise<string | null> {
	const allSessions = sessionManager.loadAllSessions()
	// Filter out empty sessions and subagent sessions (start with "System context:")
	const sessions = allSessions.filter(
		(s) => s.messageCount > 0 && !s.firstMessage.startsWith("System context:")
	)
	if (sessions.length === 0) return null
	if (sessions.length === 1) return sessions[0]!.path

	return new Promise((resolve) => {
		let resolved = false

		const doResolve = (value: string | null) => {
			if (resolved) return
			resolved = true
			if (value === null) {
				// Cancel - exit immediately since we're done
				process.stdout.write("\nNo session selected\n")
				process.exit(0)
			}
			resolve(value)
		}

		const themeMode = detectThemeMode()

		render(
			() => (
				<ThemeProvider mode={themeMode}>
					<SessionPickerApp
						sessions={sessions}
						onSelect={(path) => doResolve(path)}
						onCancel={() => doResolve(null)}
					/>
				</ThemeProvider>
			),
			{
				targetFps: 30,
				exitOnCtrlC: false,
				useKittyKeyboard: {},
			}
		)
	})
}

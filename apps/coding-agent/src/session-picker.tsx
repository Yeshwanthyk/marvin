/**
 * OpenTUI-based session picker with full-text search
 */

import { render, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import {
	Input,
	type SelectItem,
	SelectList,
	type SelectListRef,
	type ThemeMode,
	ThemeProvider,
	useTheme,
} from "@yeshwanthyk/open-tui";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { searchSessions, triggerBackgroundIndex } from "./mmem.js";
import type { SessionManager } from "./session-manager.js";

/** Detect system dark/light mode (macOS only, defaults to dark) */
function detectThemeMode(): ThemeMode {
	try {
		const result = Bun.spawnSync([
			"defaults",
			"read",
			"-g",
			"AppleInterfaceStyle",
		]);
		return result.stdout.toString().trim().toLowerCase() === "dark"
			? "dark"
			: "light";
	} catch {
		return "dark";
	}
}

type DateCategory = "Today" | "Yesterday" | "This Week" | "Older";

function getDateCategory(timestamp: number): DateCategory {
	const now = new Date();
	const date = new Date(timestamp);

	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
	const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

	if (date >= today) return "Today";
	if (date >= yesterday) return "Yesterday";
	if (date >= weekAgo) return "This Week";
	return "Older";
}

interface GroupedSessions {
	category: DateCategory;
	sessions: SessionForDisplay[];
}

interface SessionForDisplay {
	path: string;
	title: string;
	lastActivity: number;
	messageCount?: number;
	modelId?: string;
}

function groupByDate(sessions: SessionForDisplay[]): GroupedSessions[] {
	const categories: DateCategory[] = [
		"Today",
		"Yesterday",
		"This Week",
		"Older",
	];
	const grouped: Record<DateCategory, SessionForDisplay[]> = {
		Today: [],
		Yesterday: [],
		"This Week": [],
		Older: [],
	};

	for (const session of sessions) {
		const cat = getDateCategory(session.lastActivity);
		grouped[cat].push(session);
	}

	return categories
		.map((cat) => ({ category: cat, sessions: grouped[cat] }))
		.filter((g) => g.sessions.length > 0);
}

interface SessionPickerProps {
	sessions: Array<{
		path: string;
		firstMessage: string;
		timestamp: number;
		lastActivity: number;
		messageCount: number;
		modelId: string;
	}>;
	cwd: string;
	onSelect: (path: string) => void;
	onCancel: () => void;
}

function SessionPickerApp(props: SessionPickerProps) {
	const { theme } = useTheme();
	const dimensions = useTerminalDimensions();
	let listRef: SelectListRef | undefined;

	const [query, setQuery] = createSignal("");
	const [searchFocused, setSearchFocused] = createSignal(true);
	const [usingFallback, setUsingFallback] = createSignal(false);

	// Trigger background index on mount
	onMount(() => {
		triggerBackgroundIndex();
	});

	// Convert loaded sessions to display format
	const loadedSessions = createMemo((): SessionForDisplay[] =>
		props.sessions.map((s) => ({
			path: s.path,
			title: s.firstMessage,
			lastActivity: s.lastActivity,
			messageCount: s.messageCount,
			modelId: s.modelId,
		})),
	);

	// Search results (mmem or fallback)
	const searchResults = createMemo((): SessionForDisplay[] | null => {
		const q = query().trim();
		if (!q) return null;

		// Try mmem search
		const result = searchSessions(q, props.cwd);
		if (result.ok) {
			setUsingFallback(false);
			return result.sessions;
		}

		// Fallback to title filter
		setUsingFallback(true);
		const lowerQ = q.toLowerCase();
		return loadedSessions().filter((s) =>
			s.title.toLowerCase().includes(lowerQ),
		);
	});

	// Final display list
	const displaySessions = createMemo(() => searchResults() ?? loadedSessions());

	// Group by date only when not searching
	const grouped = createMemo(() => {
		if (query().trim()) return null;
		return groupByDate(displaySessions());
	});

	// Flat items for SelectList
	const items = createMemo((): SelectItem[] =>
		displaySessions().map((s) => ({
			value: s.path,
			label: formatFirstMessage(s.title),
			description: formatMeta(s.lastActivity, s.messageCount, s.modelId),
		})),
	);

	useKeyboard((e: { name: string; ctrl?: boolean; shift?: boolean }) => {
		if (e.name === "up" || (e.ctrl && e.name === "p")) {
			listRef?.moveUp();
		} else if (e.name === "down" || (e.ctrl && e.name === "n")) {
			listRef?.moveDown();
		} else if (e.name === "return" && !searchFocused()) {
			listRef?.select();
		} else if (e.name === "escape" || (e.ctrl && e.name === "c")) {
			if (query()) {
				setQuery("");
			} else {
				props.onCancel();
			}
		}
	});

	const maxVisible = () => Math.min(10, dimensions().height - 6);

	return (
		<box
			flexDirection="column"
			width={dimensions().width}
			height={dimensions().height}
		>
			<text fg={theme.text}>Resume Session</text>
			<box height={1} />
			<box flexDirection="row" width={dimensions().width - 2}>
				<text fg={theme.textMuted}>Search: </text>
				<Input
					value={query()}
					placeholder="search sessions..."
					focused={searchFocused()}
					width={dimensions().width - 12}
					onChange={(v) => setQuery(v)}
					onSubmit={() => setSearchFocused(false)}
					onEscape={() => {
						if (query()) {
							setQuery("");
						} else {
							props.onCancel();
						}
					}}
				/>
			</box>
			<box height={1} />
			<Show
				when={grouped()}
				fallback={
					<SelectList
						ref={(r) => {
							listRef = r;
						}}
						items={items()}
						maxVisible={maxVisible()}
						width={dimensions().width - 2}
						onSelect={(item) => props.onSelect(item.value)}
						onCancel={props.onCancel}
					/>
				}
			>
				{(groups) => (
					<box flexDirection="column">
						<For each={groups()}>
							{(group) => (
								<box flexDirection="column">
									<text fg={theme.accent}>{group.category}</text>
									<For each={group.sessions}>
										{(session, idx) => (
											<text fg={idx() === 0 ? theme.text : theme.textMuted}>
												{idx() === 0 ? "→ " : "  "}
												{formatFirstMessage(session.title)}
												{"  "}
												<span style={{ fg: theme.textMuted }}>
													{formatRelativeTime(session.lastActivity)}
												</span>
											</text>
										)}
									</For>
									<box height={1} />
								</box>
							)}
						</For>
					</box>
				)}
			</Show>
			<box flexGrow={1} />
			<box
				flexDirection="row"
				justifyContent="space-between"
				width={dimensions().width - 2}
			>
				<text fg={theme.textMuted}>
					↑/↓ navigate · Enter select · Esc cancel
				</text>
				<Show when={usingFallback() && query()}>
					<text fg={theme.textMuted}>[title only]</text>
				</Show>
			</box>
		</box>
	);
}

function formatFirstMessage(msg: string): string {
	return msg.replace(/\n/g, " ").slice(0, 60);
}

function formatMeta(
	lastActivity: number,
	count?: number,
	model?: string,
): string {
	const ago = formatRelativeTime(lastActivity);
	const parts = [ago];
	if (count !== undefined) parts.push(`${count} msgs`);
	if (model) parts.push(model);
	return parts.join(" · ");
}

function formatRelativeTime(ts: number): string {
	const seconds = Math.floor((Date.now() - ts) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export async function selectSession(
	sessionManager: SessionManager,
): Promise<string | null> {
	const allSessions = sessionManager.loadAllSessions();
	// Filter out empty sessions and subagent sessions (start with "System context:")
	const sessions = allSessions.filter(
		(s) => s.messageCount > 0 && !s.firstMessage.startsWith("System context:"),
	);
	if (sessions.length === 0) return null;
	if (sessions.length === 1) return sessions[0].path;

	const cwd = process.cwd();

	return new Promise((resolve) => {
		let resolved = false;

		const doResolve = (value: string | null) => {
			if (resolved) return;
			resolved = true;
			if (value === null) {
				// Cancel - exit immediately since we're done
				process.stdout.write("\nNo session selected\n");
				process.exit(0);
			}
			resolve(value);
		};

		const themeMode = detectThemeMode();

		render(
			() => (
				<ThemeProvider mode={themeMode}>
					<SessionPickerApp
						sessions={sessions}
						cwd={cwd}
						onSelect={(path) => doResolve(path)}
						onCancel={() => doResolve(null)}
					/>
				</ThemeProvider>
			),
			{
				targetFps: 30,
				exitOnCtrlC: false,
				useKittyKeyboard: {},
			},
		);
	});
}

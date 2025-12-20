/**
 * OpenTUI-based TUI application for coding-agent
 */

import { TextareaRenderable, type KeyEvent } from "@opentui/core"
import { render } from "@opentui/solid"
import { createSignal, createEffect, For, Show, onCleanup, onMount, batch } from "solid-js"
import { ThemeProvider, useTheme, TextAttributes } from "@marvin-agents/open-tui"
import {
	Agent,
	ProviderTransport,
	RouterTransport,
	CodexTransport,
	loadTokens,
	saveTokens,
	clearTokens,
} from "@marvin-agents/agent-core"
import type { AgentEvent, ThinkingLevel } from "@marvin-agents/agent-core"
import { getApiKey, type Model, type Api } from "@marvin-agents/ai"
import { codingTools } from "@marvin-agents/base-tools"
import { loadAppConfig } from "./config.js"
import { colors } from "./tui/themes.js"
import { ToolBlock as ToolBlockComponent, Thinking, getToolText, getEditDiffText } from "./tui-open-rendering.js"
import { existsSync, readFileSync, watch, type FSWatcher } from "fs"
import { spawnSync } from "child_process"
import { dirname, join } from "path"

// ----- Types -----

interface Message {
	id: string
	role: "user" | "assistant"
	content: string
	thinking?: { summary: string; full: string }
}

interface ToolBlock {
	id: string
	name: string
	args: unknown
	output?: string
	editDiff?: string
	isError: boolean
	isComplete: boolean
}

type ActivityState = "idle" | "thinking" | "streaming" | "tool"

// ----- Git helpers -----

function findGitHeadPath(): string | null {
	let dir = process.cwd()
	while (true) {
		const gitHeadPath = join(dir, ".git", "HEAD")
		if (existsSync(gitHeadPath)) return gitHeadPath
		const parent = dirname(dir)
		if (parent === dir) return null
		dir = parent
	}
}

function getCurrentBranch(): string | null {
	try {
		const gitHeadPath = findGitHeadPath()
		if (!gitHeadPath) return null
		const content = readFileSync(gitHeadPath, "utf8").trim()
		if (content.startsWith("ref: refs/heads/")) return content.slice(16)
		return "detached"
	} catch {
		return null
	}
}

function getGitDiffStats(): { ins: number; del: number } | null {
	try {
		const result = spawnSync("git", ["diff", "--shortstat"], { cwd: process.cwd(), encoding: "utf8" })
		const output = (result.stdout || "").trim()
		if (!output) return { ins: 0, del: 0 }
		const ins = output.match(/(\d+) insertions?/)?.[1] ?? "0"
		const del = output.match(/(\d+) deletions?/)?.[1] ?? "0"
		return { ins: +ins, del: +del }
	} catch {
		return null
	}
}

// ----- Main -----

export const runTuiOpen = async (args?: {
	configDir?: string
	configPath?: string
	provider?: string
	model?: string
	thinking?: ThinkingLevel
}) => {
	const firstModelRaw = args?.model?.split(",")[0]?.trim()
	let firstProvider = args?.provider
	let firstModel = firstModelRaw
	if (firstModelRaw?.includes("/")) {
		const [p, m] = firstModelRaw.split("/")
		firstProvider = p
		firstModel = m
	}

	const loaded = await loadAppConfig({
		configDir: args?.configDir,
		configPath: args?.configPath,
		provider: firstProvider,
		model: firstModel,
		thinking: args?.thinking,
	})

	const getApiKeyForProvider = (provider: string): string | undefined => {
		if (provider === "anthropic") {
			return process.env["ANTHROPIC_OAUTH_TOKEN"] || getApiKey(provider)
		}
		return getApiKey(provider)
	}

	const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider })
	const codexTransport = new CodexTransport({
		getTokens: async () => loadTokens({ configDir: loaded.configDir }),
		setTokens: async (tokens) => saveTokens(tokens, { configDir: loaded.configDir }),
		clearTokens: async () => clearTokens({ configDir: loaded.configDir }),
	})

	const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport })
	const agent = new Agent({
		transport,
		initialState: {
			systemPrompt: loaded.systemPrompt,
			model: loaded.model,
			thinkingLevel: loaded.thinking,
			tools: codingTools,
		},
	})

	render(
		() => (
			<App
				agent={agent}
				modelId={loaded.modelId}
				model={loaded.model}
				thinking={loaded.thinking}
			/>
		),
		{
			targetFps: 60,
			exitOnCtrlC: false,
			useKittyKeyboard: {},
		}
	)
}

// ----- Content extraction -----

function extractText(content: unknown[]): string {
	let text = ""
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>
		if (b.type === "text" && typeof b.text === "string") {
			text += b.text
		}
	}
	return text
}

function extractThinking(content: unknown[]): { summary: string; full: string } | null {
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue
		const b = block as Record<string, unknown>
		if (b.type === "thinking" && typeof b.thinking === "string") {
			const full = b.thinking
			const lines = full.trim().split("\n").filter((l) => l.trim().length > 20)
			const summary = lines[0]?.trim().slice(0, 80) || full.trim().slice(0, 80)
			const truncated = summary.length >= 80 ? summary + "..." : summary
			return { summary: truncated, full }
		}
	}
	return null
}

// ----- App Component -----

function App(props: { agent: Agent; modelId: string; model: Model<Api>; thinking: ThinkingLevel }) {
	const { agent } = props

	// State
	const [messages, setMessages] = createSignal<Message[]>([])
	const [toolBlocks, setToolBlocks] = createSignal<ToolBlock[]>([])
	const [isResponding, setIsResponding] = createSignal(false)
	const [currentText, setCurrentText] = createSignal("")
	const [currentThinking, setCurrentThinking] = createSignal<{ summary: string; full: string } | null>(null)
	const [activityState, setActivityState] = createSignal<ActivityState>("idle")

	// Toggle states
	const [toolOutputExpanded, setToolOutputExpanded] = createSignal(false)
	const [thinkingVisible, setThinkingVisible] = createSignal(true)

	// Usage tracking
	const [contextTokens, setContextTokens] = createSignal(0)

	// Subscribe to agent events
	createEffect(() => {
		const unsubscribe = agent.subscribe((event: AgentEvent) => {
			try {
				handleAgentEvent(event)
			} catch (err) {
				// Silently handle errors
			}
		})

		onCleanup(() => unsubscribe())
	})

	const handleAgentEvent = (event: AgentEvent) => {
		if (event.type === "message_start" && event.message.role === "assistant") {
			setActivityState("streaming")
		}

		if (event.type === "message_update" && event.message.role === "assistant") {
			const content = event.message.content as unknown[]
			const text = extractText(content)
			const thinking = extractThinking(content)

			batch(() => {
				setCurrentText(text)
				if (thinking) {
					setCurrentThinking(thinking)
					if (!text) setActivityState("thinking")
				}
			})
		}

		if (event.type === "message_end" && event.message.role === "assistant") {
			const content = event.message.content as unknown[]
			const text = extractText(content)
			const thinking = extractThinking(content)

			batch(() => {
				if (text || thinking) {
					setMessages((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							role: "assistant",
							content: text,
							thinking: thinking || undefined,
						},
					])
				}
				setCurrentText("")
				setCurrentThinking(null)
			})

			// Update usage
			const msg = event.message as { usage?: { input: number; output: number; cacheRead: number; cacheWrite?: number } }
			if (msg.usage) {
				const tokens = msg.usage.input + msg.usage.output + msg.usage.cacheRead + (msg.usage.cacheWrite || 0)
				setContextTokens(tokens)
			}
		}

		if (event.type === "tool_execution_start") {
			setActivityState("tool")
			const newTool: ToolBlock = {
				id: event.toolCallId,
				name: event.toolName,
				args: event.args,
				isError: false,
				isComplete: false,
			}
			setToolBlocks((prev) => [...prev, newTool])
		}

		if (event.type === "tool_execution_update") {
			setToolBlocks((prev) =>
				prev.map((t) =>
					t.id === event.toolCallId
						? { ...t, output: getToolText(event.partialResult) }
						: t
				)
			)
		}

		if (event.type === "tool_execution_end") {
			setToolBlocks((prev) =>
				prev.map((t) =>
					t.id === event.toolCallId
						? {
								...t,
								output: getToolText(event.result),
								editDiff: getEditDiffText(event.result) || undefined,
								isError: event.isError,
								isComplete: true,
						  }
						: t
				)
			)
		}

		if (event.type === "turn_end" || event.type === "agent_end") {
			batch(() => {
				setIsResponding(false)
				setActivityState("idle")
			})
		}
	}

	const handleSubmit = async (text: string) => {
		if (!text.trim() || isResponding()) return

		batch(() => {
			setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }])
			setToolBlocks([])
			setIsResponding(true)
			setActivityState("thinking")
		})

		try {
			await agent.prompt(text)
		} catch (err) {
			batch(() => {
				setMessages((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						role: "assistant",
						content: `Error: ${err instanceof Error ? err.message : String(err)}`,
					},
				])
				setIsResponding(false)
				setActivityState("idle")
			})
		}
	}

	const handleAbort = () => {
		agent.abort()
		batch(() => {
			setIsResponding(false)
			setActivityState("idle")
		})
	}

	const toggleToolExpand = () => setToolOutputExpanded((v) => !v)
	const toggleThinking = () => setThinkingVisible((v) => !v)

	return (
		<ThemeProvider mode="dark">
			<MainView
				messages={messages()}
				toolBlocks={toolBlocks()}
				currentText={currentText()}
				currentThinking={currentThinking()}
				isResponding={isResponding()}
				activityState={activityState()}
				toolOutputExpanded={toolOutputExpanded()}
				thinkingVisible={thinkingVisible()}
				modelId={props.modelId}
				thinking={props.thinking}
				contextTokens={contextTokens()}
				contextWindow={props.model.contextWindow}
				onSubmit={handleSubmit}
				onAbort={handleAbort}
				onToggleToolExpand={toggleToolExpand}
				onToggleThinking={toggleThinking}
			/>
		</ThemeProvider>
	)
}

// ----- MainView Component -----

function MainView(props: {
	messages: Message[]
	toolBlocks: ToolBlock[]
	currentText: string
	currentThinking: { summary: string; full: string } | null
	isResponding: boolean
	activityState: ActivityState
	toolOutputExpanded: boolean
	thinkingVisible: boolean
	modelId: string
	thinking: ThinkingLevel
	contextTokens: number
	contextWindow: number
	onSubmit: (text: string) => void
	onAbort: () => void
	onToggleToolExpand: () => void
	onToggleThinking: () => void
}) {
	const { theme } = useTheme()
	let textareaRef: TextareaRenderable | undefined
	let lastCtrlC = 0

	// Git state
	const [branch, setBranch] = createSignal<string | null>(getCurrentBranch())
	const [gitStats, setGitStats] = createSignal<{ ins: number; del: number } | null>(null)
	let gitWatcher: FSWatcher | null = null
	let gitStatsInterval: ReturnType<typeof setInterval> | null = null

	// Spinner state
	const [spinnerFrame, setSpinnerFrame] = createSignal(0)
	let spinnerInterval: ReturnType<typeof setInterval> | null = null

	onMount(() => {
		textareaRef?.focus()

		// Watch git branch changes
		const gitHeadPath = findGitHeadPath()
		if (gitHeadPath) {
			try {
				gitWatcher = watch(gitHeadPath, () => {
					setBranch(getCurrentBranch())
				})
			} catch {}
		}

		// Poll git stats every 2s
		setGitStats(getGitDiffStats())
		gitStatsInterval = setInterval(() => {
			setGitStats(getGitDiffStats())
		}, 2000)
	})

	onCleanup(() => {
		if (gitWatcher) gitWatcher.close()
		if (gitStatsInterval) clearInterval(gitStatsInterval)
		if (spinnerInterval) clearInterval(spinnerInterval)
	})

	// Spinner effect
	createEffect(() => {
		if (props.activityState !== "idle") {
			if (!spinnerInterval) {
				spinnerInterval = setInterval(() => {
					setSpinnerFrame((f) => (f + 1) % 8)
				}, 80)
			}
		} else {
			if (spinnerInterval) {
				clearInterval(spinnerInterval)
				spinnerInterval = null
			}
		}
	})

	const handleKeyDown = (e: KeyEvent) => {
		// Ctrl+C - abort or exit
		if (e.ctrl && e.name === "c") {
			const now = Date.now()
			if (props.isResponding) {
				props.onAbort()
			} else if (now - lastCtrlC < 750) {
				process.exit(0)
			}
			lastCtrlC = now
			e.preventDefault()
			return
		}

		// Escape - abort if responding
		if (e.name === "escape" && props.isResponding) {
			props.onAbort()
			e.preventDefault()
			return
		}

		// Ctrl+O - toggle tool output expansion
		if (e.ctrl && e.name === "o") {
			props.onToggleToolExpand()
			e.preventDefault()
			return
		}

		// Ctrl+T - toggle thinking visibility
		if (e.ctrl && e.name === "t") {
			props.onToggleThinking()
			e.preventDefault()
			return
		}
	}



	// Footer helpers
	const getProjectBranch = () => {
		const cwd = process.cwd()
		const project = cwd.split("/").pop() || cwd
		const br = branch()
		return project + (br ? ` (${br})` : "")
	}

	const getContextPct = () => {
		if (props.contextWindow <= 0 || props.contextTokens <= 0) return null
		const pct = (props.contextTokens / props.contextWindow) * 100
		const pctStr = pct < 10 ? pct.toFixed(1) : Math.round(pct).toString()
		const color = pct > 90 ? "#e06c75" : pct > 70 ? "#ffcc00" : colors.dimmed
		return { text: `${pctStr}%`, color }
	}

	const getActivityData = () => {
		if (props.activityState === "idle") return null
		const spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"]
		const spinner = spinners[spinnerFrame()]
		const labels: Record<ActivityState, string> = {
			thinking: "thinking",
			streaming: "streaming",
			tool: "running",
			idle: "",
		}
		const stateColors: Record<ActivityState, string> = {
			thinking: "#b48ead",
			streaming: "#88c0d0",
			tool: "#ebcb8b",
			idle: colors.dimmed,
		}
		return {
			text: `${spinner} ${labels[props.activityState]}`,
			color: stateColors[props.activityState],
		}
	}

	return (
		<box flexDirection="column" flexGrow={1}>
			{/* Header */}
			<text fg={theme.textMuted}>marvin</text>

			{/* Messages */}
			<scrollbox flexGrow={1} stickyScroll={true} stickyStart="bottom">
				<box flexDirection="column">
					<For each={props.messages}>
						{(msg) => (
							<>
								{/* Show thinking block before assistant message if visible */}
								<Show when={msg.role === "assistant" && props.thinkingVisible && msg.thinking}>
									<box paddingLeft={1} paddingRight={1}>
										<text fg="#8a7040">
											{"thinking "}
											<span style={{ fg: theme.textMuted, attributes: TextAttributes.ITALIC }}>
												{msg.thinking?.summary || ""}
											</span>
										</text>
									</box>
								</Show>

								<box padding={1}>
									<Show when={msg.role === "user"}>
										<text fg={theme.textMuted}>{"› "}{msg.content}</text>
									</Show>
									<Show when={msg.role === "assistant"}>
										<text fg={theme.text}>{msg.content}</text>
									</Show>
								</box>
							</>
						)}
					</For>

					{/* Current thinking (streaming) */}
					<Show when={props.thinkingVisible && props.currentThinking}>
						<box paddingLeft={1} paddingRight={1}>
							<text fg="#8a7040">
								{"thinking "}
								<span style={{ fg: theme.textMuted, attributes: TextAttributes.ITALIC }}>
									{props.currentThinking?.summary || ""}
								</span>
							</text>
						</box>
					</Show>

					{/* Tool blocks */}
					<For each={props.toolBlocks}>
						{(tool) => (
							<box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
								<ToolBlockComponent
									name={tool.name}
									args={tool.args}
									output={tool.output || null}
									editDiff={tool.editDiff || null}
									isError={tool.isError}
									isComplete={tool.isComplete}
								/>
							</box>
						)}
					</For>

					{/* Streaming content */}
					<Show when={props.currentText}>
						<box padding={1}>
							<text fg={theme.text}>{props.currentText}</text>
						</box>
					</Show>
				</box>
			</scrollbox>

			{/* Input area */}
			<box border={["top"]} borderColor={theme.border} paddingTop={1}>
				<textarea
					ref={(r: TextareaRenderable) => {
						textareaRef = r
						r.focus()
					}}
					placeholder="Ask anything..."
					textColor={theme.text}
					focusedTextColor={theme.text}
					cursorColor={theme.text}
					minHeight={1}
					maxHeight={6}
					keyBindings={[
						{ name: "return", action: "submit" as const },
						{ name: "return", meta: true, action: "newline" as const },
						{ name: "left", action: "move-left" as const },
						{ name: "right", action: "move-right" as const },
						{ name: "up", action: "move-up" as const },
						{ name: "down", action: "move-down" as const },
						{ name: "backspace", action: "backspace" as const },
						{ name: "delete", action: "delete" as const },
						{ name: "a", ctrl: true, action: "line-home" as const },
						{ name: "e", ctrl: true, action: "line-end" as const },
						{ name: "k", ctrl: true, action: "delete-to-line-end" as const },
						{ name: "u", ctrl: true, action: "delete-to-line-start" as const },
						{ name: "w", ctrl: true, action: "delete-word-backward" as const },
					]}
					onKeyDown={handleKeyDown}
					onSubmit={() => {
						if (textareaRef) {
							const text = textareaRef.plainText
							props.onSubmit(text)
							textareaRef.clear()
						}
					}}
				/>
			</box>

			{/* Footer */}
			<box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
				<box flexDirection="row" gap={1}>
					<text fg={colors.dimmed}>{getProjectBranch()}</text>
					<text fg={colors.dimmed}>·</text>
					<text fg={theme.text}>{props.modelId}</text>
					<Show when={props.thinking !== "off"}>
						<text fg={colors.dimmed}>·</text>
						<text fg={theme.textMuted}>{props.thinking}</text>
					</Show>
					<Show when={getContextPct()}>
						<text fg={colors.dimmed}>·</text>
						<text fg={getContextPct()!.color}>{getContextPct()!.text}</text>
					</Show>
					<Show when={gitStats() && (gitStats()!.ins > 0 || gitStats()!.del > 0)}>
						<text fg={colors.dimmed}>·</text>
						<text fg="#a3be8c">+{gitStats()!.ins}</text>
						<text fg={colors.dimmed}>/</text>
						<text fg="#bf616a">-{gitStats()!.del}</text>
					</Show>
				</box>
				<Show when={getActivityData()}>
					<text fg={getActivityData()!.color}>{getActivityData()!.text}</text>
				</Show>
			</box>
		</box>
	)
}



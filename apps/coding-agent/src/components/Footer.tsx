/**
 * Footer component showing status bar with model, branch, context usage, etc.
 */

import { Show, createMemo } from "solid-js"
import { useTheme } from "@marvin-agents/open-tui"
import type { ThinkingLevel } from "@marvin-agents/agent-core"
import type { ActivityState } from "../types.js"

export interface FooterProps {
	modelId: string
	thinking: ThinkingLevel
	branch: string | null
	contextTokens: number
	contextWindow: number
	queueCount: number
	activityState: ActivityState
	retryStatus: string | null
	gitStats: { ins: number; del: number } | null
	spinnerFrame: number
}

export function Footer(props: FooterProps) {
	const { theme } = useTheme()

	const projectBranch = createMemo(() => {
		const cwd = process.cwd()
		const project = cwd.split("/").pop() || cwd
		return project + (props.branch ? ` (${props.branch})` : "")
	})

	const contextPct = createMemo(() => {
		if (props.contextWindow <= 0 || props.contextTokens <= 0) return null
		const pct = (props.contextTokens / props.contextWindow) * 100
		const pctStr = pct < 10 ? pct.toFixed(1) : Math.round(pct).toString()
		const color = pct > 90 ? theme.error : pct > 70 ? theme.warning : theme.textMuted
		return { text: `${pctStr}%`, color }
	})

	const activityData = createMemo(() => {
		if (props.activityState === "idle") return null
		const spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"]
		const spinner = spinners[props.spinnerFrame]
		const labels: Record<ActivityState, string> = {
			thinking: "thinking",
			streaming: "streaming",
			tool: "running",
			idle: "",
		}
		const stateColors: Record<ActivityState, typeof theme.text> = {
			thinking: theme.secondary,
			streaming: theme.info,
			tool: theme.warning,
			idle: theme.textMuted,
		}
		return {
			text: `${spinner} ${labels[props.activityState]}`,
			color: stateColors[props.activityState],
		}
	})

	const showGitStats = createMemo(() => {
		return props.gitStats && (props.gitStats.ins > 0 || props.gitStats.del > 0)
	})

	return (
		<box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} flexShrink={0} minHeight={1}>
			<box flexDirection="row" gap={1}>
				<text fg={theme.textMuted}>{projectBranch()}</text>
				<text fg={theme.textMuted}>·</text>
				<text fg={theme.text}>{props.modelId}</text>
				<Show when={props.thinking !== "off"}>
					<text fg={theme.textMuted}>·</text>
					<text fg={theme.textMuted}>{props.thinking}</text>
				</Show>
				<Show when={contextPct()}>
					<text fg={theme.textMuted}>·</text>
					<text fg={contextPct()!.color}>{contextPct()!.text}</text>
				</Show>
				<Show when={showGitStats()}>
					<text fg={theme.textMuted}>·</text>
					<text fg={theme.success}>+{props.gitStats!.ins}</text>
					<text fg={theme.textMuted}>/</text>
					<text fg={theme.error}>-{props.gitStats!.del}</text>
				</Show>
				<Show when={props.queueCount > 0}>
					<text fg={theme.textMuted}>·</text>
					<text fg={theme.warning}>{props.queueCount}q</text>
				</Show>
			</box>
			<Show when={props.retryStatus} fallback={
				<Show when={activityData()}>
					<text fg={activityData()!.color}>{activityData()!.text}</text>
				</Show>
			}>
				<text fg="#ebcb8b">{props.retryStatus}</text>
			</Show>
		</box>
	)
}

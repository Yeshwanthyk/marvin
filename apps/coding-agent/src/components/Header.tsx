/**
 * Header - Single row, minimal by default, click to expand.
 * Left: activity + model·thinking + progress bar + queue
 * Right: lane context
 */

import { Show, createMemo } from "solid-js"
import { truncateToWidth, useTheme, visibleWidth } from "@yeshwanthyk/open-tui"
import type { ThinkingLevel } from "@yeshwanthyk/agent-core"
import type { ActivityState } from "../types.js"
import { laneHeaderLine, type LaneHeaderState } from "../ui/app-shell/lane-header-state.js"
import type { LaneKeymapConfig } from "@yeshwanthyk/runtime-effect/config.js"

/** Robot face icons for each activity state */
const ACTIVITY_FACES: Record<ActivityState, { face: string; label: string }> = {
  idle: { face: "● ‿ ●", label: "ready" },
  thinking: { face: "● ≋ ●", label: "think" },
  streaming: { face: "● ◦ ●", label: "stream" },
  tool: { face: "● ⏅ ●", label: "run" },
  compacting: { face: "● ≡ ●", label: "pack" },
}

/** Animated faces for each active state */
const ANIMATED_FACES: Partial<Record<ActivityState, string[]>> = {
  streaming: ["● ◦ ●", "● ○ ●", "● ◦ ●", "● ∘ ●"],  // mouth moves (talking)
  thinking: ["● ≋ ●", "● ~ ●", "● ≈ ●", "● ~ ●"],   // squiggly (pondering)
  tool: ["● ⏅ ●", "● ⏆ ●", "● ⏅ ●", "● ⏆ ●"],      // steps running
  compacting: ["● ≡ ●", "● = ●", "● - ●", "● = ●"], // compress animation
}

/** Fixed width for activity section to prevent layout shift */
const ACTIVITY_WIDTH = 13

/** Progress bar characters */
const PROGRESS_FILLED = "━"
const PROGRESS_EMPTY = "┄"
const PROGRESS_BAR_LENGTH = 8

import type { QueueCounts } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"

export interface HeaderProps {
  modelId: string
  thinking: ThinkingLevel
  contextTokens: number
  contextWindow: number
  queueCounts: QueueCounts
  activityState: ActivityState
  retryStatus: string | null
  lane: LaneHeaderState
  laneKeymap: LaneKeymapConfig
  spinnerFrame: number
  width: number
}

export function Header(props: HeaderProps) {
  const { theme } = useTheme()

  // Model·thinking combined
  const modelThinking = createMemo(() => {
    const model = props.modelId.replace(/^claude-/, "").replace(/-latest$/, "")
    if (props.thinking === "off") return model
    // Abbreviate thinking level
    const thinkingAbbrev: Record<ThinkingLevel, string> = {
      off: "",
      minimal: "min",
      low: "low",
      medium: "med",
      high: "high",
      xhigh: "xhi",
    }
    return `${model}·${thinkingAbbrev[props.thinking]}`
  })

  // Activity with robot face
  const activity = createMemo(() => {
    if (props.retryStatus) {
      return { face: "● ! ●", label: "retry", color: theme.warning }
    }
    const state = props.activityState
    const base = ACTIVITY_FACES[state]
    
    // Animate face for active states
    let face = base.face
    const frames = ANIMATED_FACES[state]
    if (frames) {
      const frameIndex = props.spinnerFrame % frames.length
      face = frames[frameIndex] ?? base.face
    }
    
    const color = state === "idle" ? theme.textMuted : theme.accent
    return { face, label: base.label, color }
  })

  // Progress bar with percentage
  const progressBar = createMemo(() => {
    if (props.contextWindow <= 0) return null
    const pct = props.contextTokens > 0 
      ? Math.min(100, (props.contextTokens / props.contextWindow) * 100)
      : 0
    const filled = Math.round((pct / 100) * PROGRESS_BAR_LENGTH)
    const empty = PROGRESS_BAR_LENGTH - filled
    const bar = PROGRESS_FILLED.repeat(filled) + PROGRESS_EMPTY.repeat(empty)
    const color = pct > 90 ? theme.error : pct > 70 ? theme.warning : pct > 40 ? theme.text : theme.success
    return { bar, pct: Math.round(pct), color }
  })

  // Queue indicator
  const queueIndicator = createMemo(() => {
    const { steer, followUp } = props.queueCounts
    if (steer <= 0 && followUp <= 0) return null
    const parts: string[] = []
    if (steer > 0) {
      parts.push(`⚡${steer}`)
    }
    if (followUp > 0) {
      parts.push(`…${followUp}`)
    }
    return parts.join(" ")
  })

  const activityText = createMemo(() => `${activity().face} ${activity().label}`)
  const activityPadding = createMemo(() => " ".repeat(Math.max(0, ACTIVITY_WIDTH - visibleWidth(activityText()))))
  const progressText = createMemo(() => {
    const prog = progressBar()
    return prog ? `${prog.bar}  ${prog.pct}%` : ""
  })
  const laneActive = createMemo(() => props.lane.mode !== "off")
  const laneColor = createMemo(() => {
    if (props.lane.mode === "oneshot") return theme.warning
    if (props.lane.mode === "sticky") return theme.secondary
    if (props.lane.mode === "prefix") return theme.accent
    return theme.textMuted
  })
  const leftWidth = createMemo(() => {
    const parts = [ACTIVITY_WIDTH, visibleWidth(modelThinking())]
    const progress = progressText()
    if (progress) parts.push(visibleWidth(progress))
    const queue = queueIndicator()
    if (queue) parts.push(visibleWidth(queue))
    return parts.reduce((sum, part) => sum + part, 0) + Math.max(0, parts.length - 1)
  })
  const laneLine = createMemo(() => laneHeaderLine(props.lane, {
    width: props.width,
    leftWidth: leftWidth(),
    keymap: props.laneKeymap,
  }))
  const contentWidth = createMemo(() => Math.max(0, props.width - 6))
  const lanePrimary = createMemo(() => {
    const rightWidth = Math.max(0, contentWidth() - leftWidth() - 1)
    return truncateToWidth(laneLine().primary, rightWidth, "…")
  })
  const rowSpacer = createMemo(() => {
    const used = leftWidth() + visibleWidth(lanePrimary())
    if (lanePrimary().length === 0) return ""
    return " ".repeat(Math.max(1, contentWidth() - used))
  })

  return (
<box
      flexDirection="column"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      border={["top", "bottom", "left", "right"]}
      borderStyle="rounded"
      borderColor={laneActive() ? theme.borderActive : theme.border}
    >
      <text>
        <span style={{ fg: activity().color }}>{activity().face}</span>
        <span style={{ fg: theme.textMuted }}> {activity().label}{activityPadding()}</span>
        <span> </span>
        <span style={{ fg: theme.text }}>{modelThinking()}</span>
        <Show when={progressBar()} keyed>
          {(prog) => (
            <span style={{ fg: prog.color }}> {prog.bar}  {prog.pct}%</span>
          )}
        </Show>
        <Show when={queueIndicator()}>
          <span style={{ fg: theme.warning }}> {queueIndicator()}</span>
        </Show>
        <span>{rowSpacer()}</span>
        <Show when={lanePrimary().length > 0}>
          <span style={{ fg: laneActive() ? laneColor() : theme.textMuted }}>{lanePrimary()}</span>
        </Show>
      </text>

      <Show when={laneLine().navHelp.length > 0}>
        <text fg={theme.textMuted}>{laneLine().navHelp}</text>
      </Show>
    </box>
  )
}

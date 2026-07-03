/**
 * Header - Single row, minimal by default, click to expand.
 * Left: activity + model·thinking + progress bar + queue
 * Right: lane context
 */

import { Show, createMemo } from "solid-js"
import { truncateToWidth, useTheme } from "@yeshwanthyk/open-tui"
import type { ThinkingLevel } from "@yeshwanthyk/agent-core"
import type { ActivityState } from "../types.js"
import { laneHeaderDisplay, type LaneHeaderState } from "../ui/app-shell/lane-header-state.js"

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
const LANE_SESSION_MAX_WIDTH = 26
const LANE_ADJACENT_MAX_WIDTH = 30

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


  const laneDisplay = createMemo(() => laneHeaderDisplay(props.lane))
  const laneActive = createMemo(() => laneDisplay().active)
  const laneColor = createMemo(() => {
    if (props.lane.mode === "oneshot") return theme.warning
    if (props.lane.mode === "sticky") return theme.secondary
    if (props.lane.mode === "prefix") return theme.accent
    return theme.textMuted
  })
  const showSessionTitle = createMemo(() => props.width >= 84)
  const showAdjacent = createMemo(() => props.width >= 96 && props.lane.mode !== "prefix")
  const showHint = createMemo(() => props.width >= 110 || props.lane.mode === "prefix")
  const laneBadge = createMemo(() => laneDisplay().badge)
  const lanePosition = createMemo(() => laneDisplay().position)
  const laneSessionTitle = createMemo(() => {
    const title = props.lane.current?.sessionTitle ?? ""
    return title.length > 0 ? truncateToWidth(title, LANE_SESSION_MAX_WIDTH, "…") : ""
  })
  const laneAdjacent = createMemo(() => truncateToWidth(laneDisplay().adjacent, LANE_ADJACENT_MAX_WIDTH, "…"))
  const laneActivityBadges = createMemo(() => laneDisplay().activityBadges)
  const laneHint = createMemo(() => laneDisplay().hint)
  const laneSummary = createMemo(() => {
    const position = lanePosition()
    if (!position) return laneDisplay().summary
    if (!showSessionTitle() || laneSessionTitle().length === 0) return position
    return `${position} · ${laneSessionTitle()}`
  })

  return (
<box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      border={["top", "bottom", "left", "right"]}
      borderStyle="rounded"
      borderColor={laneActive() ? theme.borderActive : theme.border}
    >
      {/* Left section: Activity + Model·Thinking + Progress + Queue */}
      <box flexDirection="row" flexShrink={0} gap={1}>
        {/* Activity (fixed width) */}
        <box minWidth={ACTIVITY_WIDTH}>
          <text>
            <span style={{ fg: activity().color }}>{activity().face}</span>
            <span style={{ fg: theme.textMuted }}> {activity().label}</span>
          </text>
        </box>

        {/* Model·Thinking */}
        <text fg={theme.text}>{modelThinking()}</text>

        {/* Progress bar */}
        <Show when={progressBar()} keyed>
          {(prog) => (
            <text>
              <span style={{ fg: prog.color }}>{prog.bar}</span>
              <span style={{ fg: theme.textMuted }}>  {prog.pct}%</span>
            </text>
          )}
        </Show>

        {/* Queue */}
        <Show when={queueIndicator()}>
          <text fg={theme.warning}>{queueIndicator()}</text>
        </Show>
      </box>

      {/* Spacer */}
      <box flexGrow={1} />

      {/* Right section: lane context */}
      <box flexDirection="row" flexShrink={1} paddingLeft={1} gap={1}>
        <Show when={laneSummary().length > 0}>
          <text>
            <Show when={laneBadge()}>
              <span style={{ fg: laneColor() }}>{laneBadge()}</span>
              <span style={{ fg: theme.textMuted }}>  </span>
            </Show>
            <span style={{ fg: laneActive() ? theme.text : theme.textMuted }}>{laneSummary()}</span>
            <Show when={laneActivityBadges()}>
              <span style={{ fg: theme.warning }}>  {laneActivityBadges()}</span>
            </Show>
            <Show when={showAdjacent() && laneAdjacent()}>
              <span style={{ fg: theme.textMuted }}>  {laneAdjacent()}</span>
            </Show>
            <Show when={showHint() && laneHint()}>
              <span style={{ fg: theme.textMuted }}>  {laneHint()}</span>
            </Show>
          </text>
        </Show>
      </box>
    </box>
  )
}

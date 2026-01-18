/**
 * Header - Single row, minimal by default, click to expand.
 * Left: activity + model·thinking + progress bar + queue
 * Right (expanded): branch + LSP
 */

import { Show, createMemo, createSignal } from "solid-js"
import { useTheme } from "@marvin-agents/open-tui"
import type { ThinkingLevel } from "@marvin-agents/agent-core"
import type { LspManager, LspServerId } from "@marvin-agents/lsp"
import type { ActivityState } from "../types.js"

const LSP_SYMBOLS: Record<LspServerId, [string, string]> = {
  typescript: ["⬡", "⬢"],
  biome: ["✧", "✦"],
  basedpyright: ["ψ", "Ψ"],
  ruff: ["△", "▲"],
  ty: ["τ", "Τ"],
  gopls: ["◎", "◉"],
  "rust-analyzer": ["⛭", "⚙"],
}

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

import type { QueueCounts } from "../runtime/session/prompt-queue.js"

export interface HeaderProps {
  modelId: string
  thinking: ThinkingLevel
  contextTokens: number
  contextWindow: number
  queueCounts: QueueCounts
  activityState: ActivityState
  retryStatus: string | null
  lspActive: boolean
  spinnerFrame: number
  lsp: LspManager
}

export function Header(props: HeaderProps) {
  const { theme } = useTheme()
  const [expanded, setExpanded] = createSignal(false)

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


  // LSP status
  const lspStatus = createMemo(() => {
    const servers = props.lsp.activeServers()
    if (servers.length === 0) return null
    const uniqueIds = [...new Set(servers.map((s) => s.serverId))]
    const symbolIndex = props.lspActive ? 1 : 0
    const symbols = uniqueIds.map((id) => LSP_SYMBOLS[id]?.[symbolIndex] ?? id).join("")
    const counts = props.lsp.diagnosticCounts()
    return { symbols, errors: counts.errors, warnings: counts.warnings }
  })

  const toggleExpanded = () => setExpanded((v) => !v)

  return (
<box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      border={["top", "bottom", "left", "right"]}
      borderStyle="rounded"
      borderColor={theme.border}
      onMouseUp={(e: { isSelecting?: boolean }) => {
        if (e.isSelecting) return
        toggleExpanded()
      }}
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

      {/* Right section (only when expanded): Branch + LSP */}
      <Show when={expanded()}>
        <box flexDirection="row" flexShrink={0} gap={1}>

          {/* LSP */}
          <Show when={lspStatus()} keyed>
            {(lsp) => (
              <text>
                <span style={{ fg: props.lspActive ? theme.accent : theme.success }}>{lsp.symbols}</span>
                <Show when={lsp.errors > 0 || lsp.warnings > 0}>
                  <span style={{ fg: theme.textMuted }}> </span>
                  <Show when={lsp.errors > 0}>
                    <span style={{ fg: theme.error }}>{lsp.errors}</span>
                  </Show>
                  <Show when={lsp.errors > 0 && lsp.warnings > 0}>
                    <span style={{ fg: theme.textMuted }}>/</span>
                  </Show>
                  <Show when={lsp.warnings > 0}>
                    <span style={{ fg: theme.warning }}>{lsp.warnings}</span>
                  </Show>
                </Show>
              </text>
            )}
          </Show>
        </box>
      </Show>
    </box>
  )
}

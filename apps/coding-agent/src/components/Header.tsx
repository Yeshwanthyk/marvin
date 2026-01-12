/**
 * Header - Single row, minimal by default, click to expand.
 * Left: activity + model·thinking + context + queue
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

/** Activity state labels */
const ACTIVITY_LABELS: Record<ActivityState, string> = {
  idle: "ready",
  thinking: "think",
  streaming: "stream",
  tool: "run",
  compacting: "pack",
}

export interface HeaderProps {
  modelId: string
  thinking: ThinkingLevel
  branch: string | null
  contextTokens: number
  contextWindow: number
  queueCount: number
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

  // Activity indicator
  const activity = createMemo(() => {
    if (props.retryStatus) {
      return { indicator: "!", label: "retry", color: theme.warning }
    }
    const state = props.activityState
    const pulse = ["·", "•", "●", "•"]
    const indicator = state === "idle" ? "●" : pulse[props.spinnerFrame % pulse.length]
    const color = state === "idle" ? theme.textMuted : theme.accent
    return { indicator, label: ACTIVITY_LABELS[state], color }
  })

  // Context as tokens
  const contextInfo = createMemo(() => {
    if (props.contextWindow <= 0 || props.contextTokens <= 0) return null
    const pct = (props.contextTokens / props.contextWindow) * 100
    const fmt = (n: number) => n >= 1000 ? Math.round(n / 1000) + "k" : n.toString()
    const display = `${fmt(props.contextTokens)}/${fmt(props.contextWindow)}`
    const color = pct > 90 ? theme.error : pct > 70 ? theme.warning : pct > 40 ? theme.text : theme.success
    return { display, color }
  })

  // Queue indicator
  const queueIndicator = createMemo(() => {
    if (props.queueCount <= 0) return null
    return "▸".repeat(Math.min(props.queueCount, 5))
  })

  // Shortened branch (last 2 segments)
  const shortBranch = createMemo(() => {
    const branch = props.branch
    if (!branch) return null
    const parts = branch.split(/[/-]/).filter(p => p.length > 0)
    if (parts.length <= 2) return branch
    return parts.slice(-2).join("-")
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
      {/* Left section: Activity + Model·Thinking + Context + Queue */}
      <box flexDirection="row" flexShrink={0} gap={1}>
        {/* Activity */}
        <text>
          <span style={{ fg: activity().color }}>{activity().indicator}</span>
          <span style={{ fg: theme.textMuted }}> {activity().label}</span>
        </text>

        {/* Model·Thinking */}
        <text fg={theme.text}>{modelThinking()}</text>

        {/* Context */}
        <Show when={contextInfo()} keyed>
          {(ctx) => <text fg={ctx.color}>{ctx.display}</text>}
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
          {/* Branch */}
          <Show when={shortBranch()}>
            <text fg={theme.secondary}>{shortBranch()}</text>
          </Show>

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

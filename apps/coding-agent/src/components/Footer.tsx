/**
 * Footer component showing status bar with model, branch, context usage, etc.
 */

import { Show, createMemo } from "solid-js"
import { useTheme } from "@marvin-agents/open-tui"
import type { ThinkingLevel } from "@marvin-agents/agent-core"
import type { LspManager, LspServerId } from "@marvin-agents/lsp"
import type { ActivityState } from "../types.js"

/** Short display labels for LSP servers */
const LSP_LABELS: Record<LspServerId, string> = {
  typescript: "TS",
  biome: "BIO",
  basedpyright: "PY",
  ruff: "RUFF",
  ty: "TY",
  gopls: "GO",
  "rust-analyzer": "RS",
}

export interface FooterProps {
  modelId: string
  thinking: ThinkingLevel
  branch: string | null
  contextTokens: number
  contextWindow: number
  cacheStats: { cacheRead: number; input: number } | null
  queueCount: number
  activityState: ActivityState
  retryStatus: string | null
  lspIterationCount: number
  spinnerFrame: number
  lsp: LspManager
}

export function Footer(props: FooterProps) {
  const { theme } = useTheme()

  const projectBranch = createMemo(() => {
    const cwd = process.cwd()
    const project = cwd.split("/").pop() || cwd
    return project + (props.branch ? ` ⎇${props.branch}` : "")
  })

  const shortModel = createMemo(() => {
    // claude-opus-4-5 → opus-4-5
    return props.modelId.replace(/^claude-/, "")
  })

  const contextBar = createMemo(() => {
    if (props.contextWindow <= 0 || props.contextTokens <= 0) return null
    const pct = (props.contextTokens / props.contextWindow) * 100
    const pctStr = pct < 10 ? pct.toFixed(1) : Math.round(pct).toString()
    const color = pct > 90 ? theme.error : pct > 70 ? theme.warning : theme.success
    // 5 segments, each = 20% - round for visual accuracy
    const filled = Math.min(5, Math.round(pct / 20))
    const filledBar = "▰".repeat(filled)
    const emptyBar = "▱".repeat(5 - filled)
    return { filledBar, emptyBar, pct: pctStr, color }
  })

  const queueIndicator = createMemo(() => {
    if (props.queueCount <= 0) return null
    return "▸".repeat(props.queueCount)
  })

  const activityData = createMemo(() => {
    if (props.activityState === "idle") return null
    const spinners = ["·", "•", "·", "•"]
    const spinner = spinners[props.spinnerFrame % spinners.length]
    const labels: Record<ActivityState, string> = {
      thinking: "thinking",
      streaming: "streaming",
      tool: "running",
      compacting: "compacting",
      idle: "",
    }
    const stateColors: Record<ActivityState, typeof theme.text> = {
      thinking: theme.secondary,
      streaming: theme.info,
      tool: theme.warning,
      compacting: theme.warning,
      idle: theme.textMuted,
    }
    return {
      text: `${spinner} ${labels[props.activityState]}`,
      color: stateColors[props.activityState],
    }
  })

  // Cache efficiency indicator - show ⚡ when cache is effective (>50% hit rate)
  const cacheIndicator = createMemo(() => {
    const stats = props.cacheStats
    if (!stats || stats.input === 0) return null
    // cacheRead / (cacheRead + uncached input) = hit rate
    // input in usage is uncached input tokens only
    const total = stats.cacheRead + stats.input
    if (total === 0) return null
    const hitRate = stats.cacheRead / total
    if (hitRate < 0.5) return null
    return { hitRate, display: "⚡" }
  })

  // LSP status: show active servers and diagnostic counts
  // Track spinnerFrame (ticks during activity) + activityState (catches idle transition)
  const lspStatus = createMemo(() => {
    void props.spinnerFrame
    void props.activityState
    const servers = props.lsp.activeServers()
    if (servers.length === 0) return null

    // Unique server IDs
    const uniqueIds = [...new Set(servers.map((s) => s.serverId))]
    const labels = uniqueIds.map((id) => LSP_LABELS[id] || id).join(" ")

    // Diagnostic counts
    const counts = props.lsp.diagnosticCounts()
    const hasIssues = counts.errors > 0 || counts.warnings > 0

    return { labels, errors: counts.errors, warnings: counts.warnings, hasIssues }
  })

  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} flexShrink={0} minHeight={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>{projectBranch()}</text>
        <text fg={theme.textMuted}>·</text>
        <text fg={theme.text}>{shortModel()}</text>
        <Show when={props.thinking !== "off"}>
          <text fg={theme.textMuted}>{props.thinking}</text>
        </Show>
        <Show when={contextBar()}>
          <text fg={theme.textMuted}>·</text>
          <text>
            <span style={{ fg: contextBar()!.color }}>{contextBar()!.filledBar}</span>
            <span style={{ fg: theme.textMuted }}>{contextBar()!.emptyBar}</span>
            <span style={{ fg: theme.textMuted }}>{`  ${contextBar()!.pct}%`}</span>
          </text>
        </Show>
        <Show when={queueIndicator()}>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.warning}>{queueIndicator()}</text>
        </Show>
        <Show when={lspStatus()}>
          <text fg={theme.textMuted}>·</text>
          <Show when={lspStatus()!.hasIssues} fallback={
            <text fg={theme.success}>{lspStatus()!.labels}</text>
          }>
            <text>
              <span style={{ fg: theme.success }}>{lspStatus()!.labels}</span>
              <span style={{ fg: theme.textMuted }}>(</span>
              <Show when={lspStatus()!.errors > 0}>
                <span style={{ fg: theme.error }}>{lspStatus()!.errors}</span>
              </Show>
              <Show when={lspStatus()!.errors > 0 && lspStatus()!.warnings > 0}>
                <span style={{ fg: theme.textMuted }}>/</span>
              </Show>
              <Show when={lspStatus()!.warnings > 0}>
                <span style={{ fg: theme.warning }}>{lspStatus()!.warnings}</span>
              </Show>
              <span style={{ fg: theme.textMuted }}>)</span>
            </text>
          </Show>
        </Show>
        <Show when={props.lspIterationCount > 0}>
          <text fg={theme.accent}>⟳{props.lspIterationCount}</text>
        </Show>
        <Show when={cacheIndicator()}>
          <text fg={theme.success}>{cacheIndicator()!.display}</text>
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

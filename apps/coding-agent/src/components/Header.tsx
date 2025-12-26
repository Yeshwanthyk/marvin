/**
 * Header - 3 section layout.
 * Left: activity+label / context%
 * Center: project / scrolling branch + model / thinking
 * Right: LSP / queue
 */

import { Show, createMemo } from "solid-js"
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

const BRANCH_MAX_WIDTH = 14

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

  const project = createMemo(() => {
    const cwd = process.cwd()
    return cwd.split("/").pop() || cwd
  })

  const shortModel = createMemo(() => {
    return props.modelId.replace(/^claude-/, "").replace(/-latest$/, "")
  })

  const thinkingLabel = createMemo(() => {
    if (props.thinking === "off") return null
    return props.thinking
  })

  // Context as tokens - color shifts with usage
  const contextInfo = createMemo(() => {
    if (props.contextWindow <= 0 || props.contextTokens <= 0) return null
    const pct = (props.contextTokens / props.contextWindow) * 100
    const fmt = (n: number) => n >= 1000 ? Math.round(n / 1000) + "k" : n.toString()
    const display = `${fmt(props.contextTokens)}/${fmt(props.contextWindow)}`
    const color = pct > 90 ? theme.error : pct > 70 ? theme.warning : pct > 40 ? theme.text : theme.success
    return { display, color }
  })

  // Scrolling branch name (airport terminal style)
  const scrollingBranch = createMemo(() => {
    const branch = props.branch
    if (!branch) return null
    if (branch.length <= BRANCH_MAX_WIDTH) return branch
    
    // Add padding for smooth loop
    const padded = branch + "   " + branch
    const scrollPos = Math.floor(props.spinnerFrame / 2) % (branch.length + 3)
    return padded.slice(scrollPos, scrollPos + BRANCH_MAX_WIDTH)
  })

  const queueIndicator = createMemo(() => {
    if (props.queueCount <= 0) return null
    return "▸".repeat(props.queueCount)
  })

  const lspStatus = createMemo(() => {
    void props.spinnerFrame
    const servers = props.lsp.activeServers()
    if (servers.length === 0) return null
    const uniqueIds = [...new Set(servers.map((s) => s.serverId))]
    const symbolIndex = props.lspActive ? 1 : 0
    const symbols = uniqueIds.map((id) => LSP_SYMBOLS[id]?.[symbolIndex] ?? id).join("")
    const counts = props.lsp.diagnosticCounts()
    return { symbols, errors: counts.errors, warnings: counts.warnings }
  })

  // Activity with pulsing dot + label
  const activity = createMemo(() => {
    if (props.activityState === "idle") return null
    const pulse = ["·", "•", "●", "•"]
    const dot = pulse[props.spinnerFrame % pulse.length]
    const labels: Record<ActivityState, string> = {
      thinking: "thinking",
      streaming: "streaming",
      tool: "running",
      compacting: "compacting",
      idle: "",
    }
    return { dot, label: labels[props.activityState] }
  })

  return (
    <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1} border={["bottom"]} borderColor={theme.border}>
      {/* Left: Activity / Context% */}
      <box flexDirection="column" flexShrink={0} minWidth={12}>
        <Show when={props.retryStatus} fallback={
          <Show when={activity()} keyed fallback={<text> </text>}>
            {(act) => (
              <text>
                <span style={{ fg: theme.accent }}>{act.dot}</span>
                <span style={{ fg: theme.textMuted }}> {act.label}</span>
              </text>
            )}
          </Show>
        }>
          <text fg={theme.warning}>! retry</text>
        </Show>
        <Show when={contextInfo()} keyed fallback={<text> </text>}>
          {(ctx) => <text fg={ctx.color}>{ctx.display}</text>}
        </Show>
      </box>

      {/* Center: Project/Branch + Model/Thinking */}
      <box flexGrow={1} flexDirection="row" justifyContent="center" gap={4}>
        {/* Project / Branch */}
        <box flexDirection="column" minWidth={BRANCH_MAX_WIDTH}>
          <text fg={theme.text}>{project()}</text>
          <Show when={scrollingBranch()} fallback={<text> </text>}>
            <text fg={theme.secondary}>{scrollingBranch()}</text>
          </Show>
        </box>

        {/* Model / Thinking */}
        <box flexDirection="column">
          <text fg={theme.text}>{shortModel()}</text>
          <Show when={thinkingLabel()} fallback={<text> </text>}>
            <text fg={theme.textMuted}>{thinkingLabel()}</text>
          </Show>
        </box>
      </box>

      {/* Right: LSP / Cache */}
      <box flexDirection="column" flexShrink={0} alignItems="flex-end" minWidth={6}>
        <Show when={lspStatus()} keyed fallback={<text> </text>}>
          {(lsp) => (
            <text>
              <span style={{ fg: props.lspActive ? theme.accent : theme.success }}>{lsp.symbols}</span>
              <Show when={lsp.errors > 0 || lsp.warnings > 0}>
                <span style={{ fg: theme.textMuted }}>(</span>
                <Show when={lsp.errors > 0}>
                  <span style={{ fg: theme.error }}>{lsp.errors}</span>
                </Show>
                <Show when={lsp.errors > 0 && lsp.warnings > 0}>
                  <span style={{ fg: theme.textMuted }}>/</span>
                </Show>
                <Show when={lsp.warnings > 0}>
                  <span style={{ fg: theme.warning }}>{lsp.warnings}</span>
                </Show>
                <span style={{ fg: theme.textMuted }}>)</span>
              </Show>
            </text>
          )}
        </Show>
        <Show when={queueIndicator()} fallback={<text> </text>}>
          <text fg={theme.warning}>{queueIndicator()}</text>
        </Show>
      </box>
    </box>
  )
}

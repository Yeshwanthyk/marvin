import { Show, createMemo, createSignal, onMount, onCleanup } from "solid-js"
import { useAgent } from "../context/agent.js"
import { useTheme } from "../context/theme.js"
import { formatTokens } from "../utils/text.js"
import { readFile } from "node:fs/promises"

export interface FooterProps {
  /** Override project name */
  project?: string
}

export function Footer(props: FooterProps) {
  const agent = useAgent()
  const theme = useTheme()

  // Project name from cwd
  const project = createMemo(() => {
    if (props.project) return props.project
    return process.cwd().split("/").pop() ?? ""
  })

  // Git branch (simple implementation)
  const [branch, setBranch] = createSignal<string | null>(null)

  onMount(() => {
    // Try to read git branch
    const watchGitHead = async () => {
      try {
        const content = await readFile(".git/HEAD", "utf8")
        const match = content.match(/ref: refs\/heads\/(.+)/)
        if (match) setBranch(match[1]?.trim() ?? null)
      } catch {
        // Ignore errors
      }
    }

    watchGitHead()
    const interval = setInterval(watchGitHead, 5000)
    onCleanup(() => clearInterval(interval))
  })

  // Usage stats
  const stats = createMemo(() => {
    const u = agent.state.totalUsage
    const model = agent.state.model
    const contextWindow = model?.contextWindow ?? 128000
    const contextPct = Math.round((u.lastContext / contextWindow) * 100)
    return {
      ...u,
      contextPct,
      contextWindow,
    }
  })

  const contextColor = createMemo(() => {
    const pct = stats().contextPct
    if (pct > 90) return theme.colors.error
    if (pct > 75) return theme.colors.warning
    return theme.colors.text
  })

  return (
    <box height={1} flexDirection="row" justifyContent="space-between">
      {/* Left side: project + branch */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.colors.textDim}>{project()}</text>
        <Show when={branch()}>
          <text fg={theme.colors.textDim}>({branch()})</text>
        </Show>
      </box>

      {/* Right side: queue + context + model */}
      <box flexDirection="row" gap={2}>
        <Show when={agent.state.queuedMessages.length > 0}>
          <text fg={theme.colors.info}>
            [{agent.state.queuedMessages.length} queued]
          </text>
        </Show>

        <text>
          <span style={{ fg: contextColor() }}>
            {stats().contextPct}%/{formatTokens(stats().contextWindow)}
          </span>
        </text>

        <text fg={theme.colors.text}>
          {agent.state.model?.id ?? "no model"}
          <Show when={agent.state.thinking !== "off"}>
            <span style={{ fg: theme.colors.textDim }}> · {agent.state.thinking}</span>
          </Show>
        </text>
      </box>
    </box>
  )
}

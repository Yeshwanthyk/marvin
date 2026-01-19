/**
 * Footer - Subtle dashed line with dir · branch on right.
 */

import { createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@yeshwanthyk/open-tui"

export interface FooterProps {
  branch: string | null
  bashMode?: boolean
}

export function Footer(props: FooterProps) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()

  const dirName = createMemo(() => process.cwd().split("/").pop() || "")

  const shortBranch = createMemo(() => {
    const branch = props.branch
    if (!branch) return null
    const parts = branch.split(/[/-]/).filter(p => p.length > 0)
    return parts.length > 2 ? parts.slice(-2).join("-") : branch
  })

  const rightText = createMemo(() => {
    const dir = dirName()
    const branch = shortBranch()
    return branch ? `${dir} · ${branch}` : dir
  })

  const dashedLine = createMemo(() => {
    const textLen = rightText().length + 2
    const lineLen = Math.max(0, dims().width - textLen - 1)
    return "┄".repeat(lineLen)
  })

  const lineColor = () => props.bashMode ? theme.warning : theme.border

  return (
    <box flexShrink={0} height={1} marginTop={0} paddingTop={0}>
      <text>
        <span style={{ fg: lineColor() }}>{dashedLine()}</span>
        <span style={{ fg: theme.textMuted }}>  {rightText()}</span>
      </text>
    </box>
  )
}

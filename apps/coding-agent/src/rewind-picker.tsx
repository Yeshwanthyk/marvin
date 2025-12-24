import * as path from "node:path"
import { render, useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { SelectList, ThemeProvider, useTheme, type SelectItem, type SelectListRef } from "@marvin-agents/open-tui"
import type { FileChange } from "./rewind.js"

export interface RewindItem {
  ref: string
  label: string
  timestamp: number
  changes: FileChange[]
}

interface RewindPickerProps {
  items: RewindItem[]
  onSelect: (ref: string) => void
  onCancel: () => void
}

function RewindPickerApp(props: RewindPickerProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  let listRef: SelectListRef | undefined

  const items: SelectItem[] = props.items.map((s) => ({
    value: s.ref,
    label: s.label,
    description: formatDescription(s),
  }))

  useKeyboard((e: { name: string; ctrl?: boolean }) => {
    if (e.name === "up" || (e.ctrl && e.name === "p")) listRef?.moveUp()
    else if (e.name === "down" || (e.ctrl && e.name === "n")) listRef?.moveDown()
    else if (e.name === "return") listRef?.select()
    else if (e.name === "escape" || (e.ctrl && e.name === "c")) props.onCancel()
  })

  return (
    <box flexDirection="column" width={dimensions().width} height={dimensions().height}>
      <text fg={theme.textMuted}>Rewind to Snapshot</text>
      <box height={1} />
      <SelectList
        ref={(r) => { listRef = r }}
        items={items}
        maxVisible={Math.min(10, dimensions().height - 4)}
        width={dimensions().width - 2}
        onSelect={(item) => props.onSelect(item.value)}
        onCancel={props.onCancel}
      />
      <box flexGrow={1} />
      <text fg={theme.textMuted}>↑/↓ navigate · Enter select · Esc cancel</text>
    </box>
  )
}

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDescription(item: RewindItem): string {
  const timeAgo = formatRelativeTime(item.timestamp)
  
  if (item.changes.length === 0) {
    return `${timeAgo} · no changes`
  }
  
  // Count by status
  const counts = { A: 0, M: 0, D: 0, other: 0 }
  for (const c of item.changes) {
    if (c.status === "A") counts.A++
    else if (c.status === "M") counts.M++
    else if (c.status === "D") counts.D++
    else counts.other++
  }
  
  const parts: string[] = []
  if (counts.M > 0) parts.push(`M:${counts.M}`)
  if (counts.A > 0) parts.push(`A:${counts.A}`)
  if (counts.D > 0) parts.push(`D:${counts.D}`)
  if (counts.other > 0) parts.push(`?:${counts.other}`)
  
  // Show first few file names
  const filePreview = item.changes
    .slice(0, 2)
    .map(c => path.basename(c.path))
    .join(", ")
  const more = item.changes.length > 2 ? "…" : ""
  
  return `${timeAgo} · ${item.changes.length} files (${parts.join(" ")}) · ${filePreview}${more}`
}

export async function selectRewind(items: RewindItem[]): Promise<string | null> {
  if (items.length === 0) return null
  if (items.length === 1) return items[0]!.ref

  return new Promise((resolve) => {
    let resolved = false
    const doResolve = (value: string | null) => {
      if (resolved) return
      resolved = true
      resolve(value)
    }

    render(
      () => (
        <ThemeProvider mode="dark">
          <RewindPickerApp items={items} onSelect={(ref) => doResolve(ref)} onCancel={() => doResolve(null)} />
        </ThemeProvider>
      ),
      { targetFps: 30, exitOnCtrlC: false, useKittyKeyboard: {} }
    )
  })
}

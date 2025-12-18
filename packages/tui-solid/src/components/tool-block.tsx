import { Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme.js"
import type { ToolBlock as ToolBlockType } from "../context/agent.js"
import { renderToolHeader, renderToolBody, getToolColor, getStatusBg } from "../utils/tool-render.js"

export interface ToolBlockProps {
  block: ToolBlockType
  expanded: boolean
  width?: number
}

export function ToolBlock(props: ToolBlockProps) {
  const theme = useTheme()

  const bgColor = createMemo(() => getStatusBg(props.block.status))
  const toolColor = createMemo(() => getToolColor(props.block.name))

  const header = createMemo(() =>
    renderToolHeader(props.block.name, props.block.args, props.width)
  )

  const body = createMemo(() => {
    if (!props.block.output) return ""
    // Only show output if expanded or completed (success/error)
    if (!props.expanded && props.block.status === "pending") return ""
    return renderToolBody(
      props.block.name,
      props.block.args,
      props.block.output,
      props.expanded
    )
  })

  const statusIcon = createMemo(() => {
    switch (props.block.status) {
      case "pending":
        return "◐"
      case "success":
        return "✓"
      case "error":
        return "✗"
    }
  })

  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      marginTop={1}
      backgroundColor={bgColor()}
      flexDirection="column"
    >
      {/* Header with tool name and status */}
      <box flexDirection="row">
        <text>
          <span style={{ fg: props.block.status === "error" ? theme.colors.error : toolColor() }}>
            {statusIcon()}
          </span>
          <span style={{ fg: toolColor() }}> {header()}</span>
        </text>
      </box>

      {/* Output body */}
      <Show when={body()}>
        <box paddingTop={1}>
          <text fg={props.block.isError ? theme.colors.error : theme.colors.text}>
            {body()}
          </text>
        </box>
      </Show>
    </box>
  )
}

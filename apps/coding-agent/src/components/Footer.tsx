/**
 * Footer - visual separator above input area.
 */

import type { RGBA } from "@opentui/core"
import { useTheme } from "@marvin-agents/open-tui"

export interface FooterProps {
  borderColor?: RGBA
}

export function Footer(props: FooterProps) {
  const { theme } = useTheme()
  const borderColor = () => props.borderColor ?? theme.border

  return (
    <box flexShrink={0} border={["top"]} borderColor={borderColor()} />
  )
}

/**
 * Footer - visual separator above input area.
 */

import { useTheme } from "@marvin-agents/open-tui"

export function Footer() {
  const { theme } = useTheme()

  return (
    <box flexShrink={0} border={["top"]} borderColor={theme.border} />
  )
}

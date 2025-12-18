import { colors } from "./colors.js"
import { truncateToWidth } from "./text.js"

/**
 * Get display color for a tool type
 */
export function getToolColor(name: string): string {
  switch (name) {
    case "bash":
    case "execute_command":
      return colors.toolBash
    case "read":
    case "read_file":
      return colors.toolRead
    case "write":
    case "write_file":
      return colors.toolWrite
    case "edit":
    case "edit_file":
    case "patch":
      return colors.toolEdit
    default:
      return colors.text
  }
}

/**
 * Get background color based on tool status
 */
export function getStatusBg(status: "pending" | "success" | "error"): string {
  switch (status) {
    case "pending":
      return colors.toolPending
    case "success":
      return colors.toolSuccess
    case "error":
      return colors.toolError
  }
}

/**
 * Render tool header with appropriate formatting
 */
export function renderToolHeader(
  name: string,
  args: Record<string, unknown>,
  width?: number
): string {
  const maxWidth = width ?? 80
  let header: string

  switch (name) {
    case "bash":
    case "execute_command": {
      const cmd = String(args.command ?? args.cmd ?? "")
      header = `$ ${cmd}`
      break
    }
    case "read":
    case "read_file": {
      const path = String(args.path ?? args.file ?? "")
      header = `read ${path}`
      break
    }
    case "write":
    case "write_file": {
      const path = String(args.path ?? args.file ?? "")
      header = `write ${path}`
      break
    }
    case "edit":
    case "edit_file": {
      const path = String(args.path ?? args.file ?? "")
      header = `edit ${path}`
      break
    }
    case "patch": {
      const path = String(args.path ?? args.file ?? "")
      header = `patch ${path}`
      break
    }
    default: {
      // Generic tool display
      const argsStr = Object.entries(args)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ")
      header = `${name}(${argsStr})`
    }
  }

  return truncateToWidth(header, maxWidth)
}

/**
 * Render tool output body with appropriate formatting
 */
export function renderToolBody(
  name: string,
  _args: Record<string, unknown>,
  output: string,
  expanded: boolean,
  maxLines = 10
): string {
  if (!output) return ""

  const lines = output.split("\n")

  // For edit/patch, try to color the diff
  if ((name === "edit" || name === "patch") && output.includes("@@")) {
    return colorDiff(output, expanded ? undefined : maxLines)
  }

  // Truncate if not expanded
  if (!expanded && lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines).join("\n")
    return truncated + `\n... (${lines.length - maxLines} more lines)`
  }

  return output
}

/**
 * Color diff output with ANSI codes
 */
export function colorDiff(diff: string, maxLines?: number): string {
  const lines = diff.split("\n")
  const limit = maxLines ?? lines.length
  const result: string[] = []

  for (let i = 0; i < Math.min(lines.length, limit); i++) {
    const line = lines[i]!
    if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push(`\x1b[32m${line}\x1b[0m`) // Green for additions
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      result.push(`\x1b[31m${line}\x1b[0m`) // Red for deletions
    } else if (line.startsWith("@@")) {
      result.push(`\x1b[36m${line}\x1b[0m`) // Cyan for hunk headers
    } else {
      result.push(line)
    }
  }

  if (maxLines && lines.length > maxLines) {
    result.push(`... (${lines.length - maxLines} more lines)`)
  }

  return result.join("\n")
}

/**
 * Extract a summary from tool output
 */
export function getToolSummary(
  name: string,
  args: Record<string, unknown>,
  output: string
): string {
  const lines = output.split("\n").filter((l) => l.trim())

  switch (name) {
    case "bash":
    case "execute_command":
      // Show exit code or first line of output
      if (lines.length === 0) return "(no output)"
      if (lines.length === 1) return lines[0]!
      return `${lines.length} lines of output`

    case "read":
    case "read_file":
      return `${lines.length} lines`

    case "write":
    case "write_file":
      return "written"

    case "edit":
    case "edit_file":
    case "patch":
      // Count additions/deletions
      const additions = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length
      const deletions = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length
      if (additions || deletions) {
        return `+${additions}/-${deletions}`
      }
      return "applied"

    default:
      if (lines.length === 0) return "(no output)"
      return `${lines.length} lines`
  }
}

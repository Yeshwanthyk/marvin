import type { AgentTool, AgentToolResult } from "@marvin-agents/ai"
import path from "node:path"
import type { LspManager, LspDiagnosticCaps } from "./types.js"
import { summarizeDiagnostics } from "./diagnostics.js"

export type LspDiagnosticsInjectedInfo = {
  filePath: string
  errors: number
  warnings: number
}

export type WrapToolsOptions = {
  cwd: string
  caps?: Partial<LspDiagnosticCaps>
  /** Called when LSP starts checking diagnostics */
  onCheckStart?: () => void
  /** Called when LSP finishes checking (whether diagnostics were injected or not) */
  onCheckEnd?: () => void
  /** Called when LSP diagnostics are injected into a tool result */
  onDiagnosticsInjected?: (info: LspDiagnosticsInjectedInfo) => void
}

export function wrapToolsWithLspDiagnostics(
  tools: AgentTool<any, any>[],
  lsp: LspManager,
  opts: WrapToolsOptions
): AgentTool<any, any>[] {
  return tools.map((tool) => {
    if (tool.name !== "write" && tool.name !== "edit") return tool

    return {
      ...tool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const result = await tool.execute(toolCallId, params, signal, onUpdate)

        const rawPath = (params as any)?.path
        if (typeof rawPath !== "string") return result

        const absPath = path.resolve(opts.cwd, rawPath)

        opts.onCheckStart?.()
        try {
          await lsp.touchFile(absPath, { waitForDiagnostics: true, signal }).catch(() => {})
        } finally {
          opts.onCheckEnd?.()
        }
        const diagnosticsByFile = await lsp.diagnostics().catch(() => ({}))

        const summary = summarizeDiagnostics({ diagnosticsByFile, filePath: absPath, caps: opts.caps })
        const extra = [summary.fileText, summary.projectText].filter(Boolean).join("\n")

        if (!extra) return result

        // Notify callback that diagnostics were injected
        opts.onDiagnosticsInjected?.({
          filePath: absPath,
          errors: summary.fileCounts.errors + summary.projectCounts.errors,
          warnings: summary.fileCounts.warnings + summary.projectCounts.warnings,
        })

        return {
          content: [...result.content, { type: "text", text: extra }],
          details: result.details,
        } satisfies AgentToolResult<any>
      },
    }
  })
}

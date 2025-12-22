import type { AgentTool, AgentToolResult } from "@marvin-agents/ai"
import path from "node:path"
import type { LspManager, LspDiagnosticCaps } from "./types.js"
import { summarizeDiagnostics } from "./diagnostics.js"

export function wrapToolsWithLspDiagnostics(
  tools: AgentTool<any, any>[],
  lsp: LspManager,
  opts: { cwd: string; caps?: Partial<LspDiagnosticCaps> }
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

        await lsp.touchFile(absPath, { waitForDiagnostics: true, signal }).catch(() => {})
        const diagnosticsByFile = await lsp.diagnostics().catch(() => ({}))

        const summary = summarizeDiagnostics({ diagnosticsByFile, filePath: absPath, caps: opts.caps })
        const extra = [summary.fileText, summary.projectText].filter(Boolean).join("\n")

        if (!extra) return result

        return {
          content: [...result.content, { type: "text", text: extra }],
          details: result.details,
        } satisfies AgentToolResult<any>
      },
    }
  })
}

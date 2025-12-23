import type { Diagnostic } from "vscode-languageserver-types"
import type { LspDiagnosticCaps } from "./types.js"

const DEFAULT_CAPS: LspDiagnosticCaps = {
  maxDiagnosticsPerFile: 20,
  maxProjectFiles: 5,
  maxTotalLines: 60,
}

function severityLabel(sev: number | undefined): "ERROR" | "WARN" | "INFO" | "HINT" {
  switch (sev) {
    case 1: return "ERROR"
    case 2: return "WARN"
    case 3: return "INFO"
    case 4: return "HINT"
    default: return "ERROR"
  }
}

export function prettyDiagnostic(d: Diagnostic): string {
  const sev = severityLabel(d.severity)
  const line = (d.range?.start?.line ?? 0) + 1
  const col = (d.range?.start?.character ?? 0) + 1
  return `${sev} [${line}:${col}] ${d.message}`
}

export type DiagnosticSummary = {
  fileText?: string
  projectText?: string
  fileCounts: { errors: number; warnings: number }
  projectCounts: { errors: number; warnings: number }
}

export function summarizeDiagnostics(input: {
  diagnosticsByFile: Record<string, Diagnostic[]>
  filePath: string
  caps?: Partial<LspDiagnosticCaps>
}): DiagnosticSummary {
  const caps: LspDiagnosticCaps = { ...DEFAULT_CAPS, ...(input.caps ?? {}) }

  const byFile = input.diagnosticsByFile
  const target = byFile[input.filePath] ?? []

  const prioritize = (d: Diagnostic) => d.severity ?? 4
  const filter = (ds: Diagnostic[]) => ds
    .filter((d) => d.severity === 1 || d.severity === 2)
    .sort((a, b) => prioritize(a) - prioritize(b))

  const countDiagnostics = (ds: Diagnostic[]) => ({
    errors: ds.filter((d) => d.severity === 1).length,
    warnings: ds.filter((d) => d.severity === 2).length,
  })

  const targetFiltered = filter(target)
  const fileCounts = countDiagnostics(targetFiltered)

  let linesBudget = caps.maxTotalLines

  let fileText: string | undefined
  if (targetFiltered.length > 0 && linesBudget > 0) {
    const limited = targetFiltered.slice(0, Math.min(caps.maxDiagnosticsPerFile, linesBudget))
    linesBudget -= limited.length
    fileText = [
      "\nThis file has errors, please fix",
      "<file_diagnostics>",
      ...limited.map(prettyDiagnostic),
      "</file_diagnostics>",
      "",
    ].join("\n")
  }

  // Project spillover (bounded)
  const otherFiles = Object.entries(byFile)
    .filter(([p, ds]) => p !== input.filePath && ds.length > 0)
    .slice(0, caps.maxProjectFiles)

  const projectBlocks: string[] = []
  for (const [p, ds] of otherFiles) {
    if (linesBudget <= 0) break
    const filtered = filter(ds)
    if (filtered.length === 0) continue
    const limited = filtered.slice(0, Math.min(caps.maxDiagnosticsPerFile, linesBudget))
    linesBudget -= limited.length

    projectBlocks.push(
      "<project_diagnostics>",
      p,
      ...limited.map(prettyDiagnostic),
      "</project_diagnostics>",
      "",
    )
  }

  const projectText = projectBlocks.length ? "\n" + projectBlocks.join("\n") : undefined

  // Count project diagnostics
  let projectErrors = 0
  let projectWarnings = 0
  for (const [p, ds] of Object.entries(byFile)) {
    if (p === input.filePath) continue
    const counts = countDiagnostics(filter(ds))
    projectErrors += counts.errors
    projectWarnings += counts.warnings
  }

  return { fileText, projectText, fileCounts, projectCounts: { errors: projectErrors, warnings: projectWarnings } }
}

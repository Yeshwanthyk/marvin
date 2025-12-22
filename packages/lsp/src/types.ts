import type { Diagnostic } from "vscode-languageserver-types"

export type LspServerId = "typescript" | "basedpyright" | "gopls" | "rust-analyzer"

export type LspDiagnosticCaps = {
  maxDiagnosticsPerFile: number
  maxProjectFiles: number
  maxTotalLines: number
}

export type LspManagerOptions = {
  cwd: string
  configDir: string
  enabled: boolean
  autoInstall: boolean
  caps?: Partial<LspDiagnosticCaps>
}

/** Counts of errors and warnings across all files */
export type LspDiagnosticCounts = {
  errors: number
  warnings: number
}

/** Status of an active LSP server */
export type LspServerStatus = {
  serverId: LspServerId
  root: string
}

export interface LspManager {
  touchFile(filePath: string, opts: { waitForDiagnostics: boolean; signal?: AbortSignal }): Promise<void>
  diagnostics(): Promise<Record<string, Diagnostic[]>>
  shutdown(): Promise<void>
  /** Get list of currently active LSP servers */
  activeServers(): LspServerStatus[]
  /** Get current diagnostic counts (errors + warnings) */
  diagnosticCounts(): LspDiagnosticCounts
}

export type LspSpawnSpec = {
  serverId: LspServerId
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  initializationOptions?: Record<string, unknown>
}

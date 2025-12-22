import { spawn } from "node:child_process"
import path from "node:path"
import type { Diagnostic } from "vscode-languageserver-types"
import type { LspManager, LspManagerOptions, LspSpawnSpec, LspServerStatus, LspDiagnosticCounts, LspServerId } from "./types.js"
import { serversForFile, languageIdForFile } from "./registry.js"
import { isWithinDir } from "./path.js"
import { ensureSpawnSpec } from "./install.js"
import { LspClient } from "./client.js"

const BROKEN_COOLDOWN_MS = 60_000

export function createLspManager(options: LspManagerOptions): LspManager {
  const cwd = path.resolve(options.cwd)
  const configDir = options.configDir
  const enabled = options.enabled
  const autoInstall = options.autoInstall

  const clients = new Map<string, LspClient>()
  const spawning = new Map<string, Promise<LspClient | undefined>>()
  const brokenUntil = new Map<string, number>()

  const keyFor = (serverId: string, root: string) => `${serverId}::${root}`

  const isBroken = (key: string) => {
    const until = brokenUntil.get(key)
    if (!until) return false
    return Date.now() < until
  }

  async function getClientFor(spec: LspSpawnSpec, root: string): Promise<LspClient | undefined> {
    const key = keyFor(spec.serverId, root)
    if (isBroken(key)) return undefined

    const existing = clients.get(key)
    if (existing) return existing

    const inflight = spawning.get(key)
    if (inflight) return inflight

    const task = (async () => {
      try {
        const proc = spawn(spec.command, spec.args, {
          cwd: root,
          env: spec.env ?? process.env,
          stdio: ["pipe", "pipe", "pipe"],
        })

        const client = await LspClient.create({
          serverId: spec.serverId,
          root,
          proc,
          initializationOptions: spec.initializationOptions,
        })

        clients.set(key, client)
        return client
      } catch {
        brokenUntil.set(key, Date.now() + BROKEN_COOLDOWN_MS)
        return undefined
      } finally {
        spawning.delete(key)
      }
    })()

    spawning.set(key, task)
    return task
  }

  async function touchFile(filePath: string, opts: { waitForDiagnostics: boolean; signal?: AbortSignal }): Promise<void> {
    if (!enabled) return

    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
    if (!isWithinDir(cwd, abs)) return

    const defs = serversForFile(abs)
    if (defs.length === 0) return

    const languageId = languageIdForFile(abs)

    // For now: allow multiple servers per file type (future-proof). With current registry it's 1.
    await Promise.all(defs.map(async (def) => {
      const root = await def.detectRoot(abs, cwd)
      const key = keyFor(def.id, root)
      if (isBroken(key)) return

      let spec: LspSpawnSpec | undefined
      if (autoInstall) {
        spec = await ensureSpawnSpec(def.id, { configDir, root, signal: opts.signal }).catch(() => undefined)
      } else {
        spec = await ensureSpawnSpec(def.id, { configDir, root, signal: opts.signal }).catch(() => undefined)
      }
      if (!spec) {
        brokenUntil.set(key, Date.now() + BROKEN_COOLDOWN_MS)
        return
      }

      const client = await getClientFor(spec, root)
      if (!client) return

      await client.openOrChangeFile(abs, languageId)

      if (opts.waitForDiagnostics) {
        await client.waitForDiagnostics(abs)
      }
    }))
  }

  async function diagnostics(): Promise<Record<string, Diagnostic[]>> {
    const out: Record<string, Diagnostic[]> = {}
    for (const client of clients.values()) {
      for (const [filePath, ds] of client.diagnostics.entries()) {
        const arr = out[filePath] ?? []
        arr.push(...ds)
        out[filePath] = arr
      }
    }
    return out
  }

  async function shutdown(): Promise<void> {
    const all = [...clients.values()]
    clients.clear()
    await Promise.all(all.map((c) => c.shutdown().catch(() => {})))
  }

  function activeServers(): LspServerStatus[] {
    const result: LspServerStatus[] = []
    for (const [key, client] of clients.entries()) {
      result.push({ serverId: client.serverId as LspServerId, root: client.root })
    }
    return result
  }

  function diagnosticCounts(): LspDiagnosticCounts {
    let errors = 0
    let warnings = 0
    for (const client of clients.values()) {
      for (const ds of client.diagnostics.values()) {
        for (const d of ds) {
          if (d.severity === 1) errors++
          else if (d.severity === 2) warnings++
        }
      }
    }
    return { errors, warnings }
  }

  // Ensure cleanup on exit
  const exitHandler = () => { void shutdown() }
  process.once("exit", exitHandler)
  process.once("SIGINT", exitHandler)
  process.once("SIGTERM", exitHandler)

  return { touchFile, diagnostics, shutdown, activeServers, diagnosticCounts }
}

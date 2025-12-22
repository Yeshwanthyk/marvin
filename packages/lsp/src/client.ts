import path from "node:path"
import { readFile } from "node:fs/promises"
import { EventEmitter } from "node:events"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from "vscode-jsonrpc/lib/node/main.js"
import type { Diagnostic } from "vscode-languageserver-types"

const DIAGNOSTICS_DEBOUNCE_MS = 150

export class LspClient {
  static async create(input: {
    serverId: string
    root: string
    proc: ChildProcessWithoutNullStreams
    initializationOptions?: Record<string, unknown>
  }): Promise<LspClient> {
    const client = new LspClient(input.serverId, input.root, input.proc, input.initializationOptions)
    await client.initialize()
    return client
  }

  private connection: MessageConnection
  private diagnosticsByPath = new Map<string, Diagnostic[]>()
  private versionsByPath = new Map<string, number>()
  private events = new EventEmitter()

  private constructor(
    public readonly serverId: string,
    public readonly root: string,
    private readonly proc: ChildProcessWithoutNullStreams,
    private readonly initializationOptions?: Record<string, unknown>
  ) {
    this.connection = createMessageConnection(
      new StreamMessageReader(this.proc.stdout as any),
      new StreamMessageWriter(this.proc.stdin as any),
    )

    this.connection.onNotification("textDocument/publishDiagnostics", (params: any) => {
      const filePath = fileURLToPath(params.uri)
      this.diagnosticsByPath.set(filePath, params.diagnostics ?? [])
      this.events.emit("diagnostics", { filePath })
    })

    this.connection.onRequest("window/workDoneProgress/create", async () => null)
    this.connection.onRequest("workspace/configuration", async () => [this.initializationOptions ?? {}])
    this.connection.onRequest("workspace/workspaceFolders", async () => [
      { name: "workspace", uri: pathToFileURL(this.root).href },
    ])

    this.connection.listen()
  }

  private async initialize() {
    await this.connection.sendRequest("initialize", {
      rootUri: pathToFileURL(this.root).href,
      processId: this.proc.pid,
      workspaceFolders: [{ name: "workspace", uri: pathToFileURL(this.root).href }],
      initializationOptions: this.initializationOptions ?? {},
      capabilities: {
        workspace: { configuration: true },
        textDocument: {
          synchronization: { didOpen: true, didChange: true },
          publishDiagnostics: { versionSupport: true },
        },
      },
    })

    await this.connection.sendNotification("initialized", {})

    if (this.initializationOptions) {
      await this.connection.sendNotification("workspace/didChangeConfiguration", { settings: this.initializationOptions })
    }
  }

  get diagnostics(): Map<string, Diagnostic[]> {
    return this.diagnosticsByPath
  }

  async openOrChangeFile(filePath: string, languageId: string) {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(this.root, filePath)
    const text = await readFile(abs, "utf8")

    const current = this.versionsByPath.get(abs)
    if (current != null) {
      const next = current + 1
      this.versionsByPath.set(abs, next)
      await this.connection.sendNotification("textDocument/didChange", {
        textDocument: { uri: pathToFileURL(abs).href, version: next },
        contentChanges: [{ text }],
      })
      return
    }

    this.diagnosticsByPath.delete(abs)
    this.versionsByPath.set(abs, 0)

    await this.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri: pathToFileURL(abs).href, languageId, version: 0, text },
    })
  }

  async waitForDiagnostics(filePath: string, timeoutMs = 3000): Promise<void> {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(this.root, filePath)

    return await new Promise<void>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      let debounce: ReturnType<typeof setTimeout> | undefined

      const onDiag = (e: { filePath: string }) => {
        if (e.filePath !== abs) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          cleanup()
          resolve()
        }, DIAGNOSTICS_DEBOUNCE_MS)
      }

      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        if (debounce) clearTimeout(debounce)
        this.events.removeListener("diagnostics", onDiag)
      }

      this.events.on("diagnostics", onDiag)
      timeout = setTimeout(() => {
        cleanup()
        resolve()
      }, timeoutMs)
    })
  }

  async shutdown(): Promise<void> {
    try {
      this.connection.end()
      this.connection.dispose()
    } catch {}

    try {
      this.proc.kill()
    } catch {}
  }
}

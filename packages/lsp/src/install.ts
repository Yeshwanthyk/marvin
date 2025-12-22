import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { fileExists } from "./path.js"
import type { LspServerId, LspSpawnSpec } from "./types.js"

type RunResult = { code: number; stdout: string; stderr: string }

async function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env, shell: false })
    let stdout = ""
    let stderr = ""

    const kill = () => {
      try { proc.kill("SIGTERM") } catch {}
      setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 5000)
    }

    if (signal) {
      if (signal.aborted) kill()
      else signal.addEventListener("abort", kill, { once: true })
    }

    proc.stdout?.on("data", (d) => { stdout += d.toString() })
    proc.stderr?.on("data", (d) => { stderr += d.toString() })

    proc.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", kill)
      resolve({ code: code ?? 1, stdout, stderr })
    })

    proc.on("error", () => {
      if (signal) signal.removeEventListener("abort", kill)
      resolve({ code: 1, stdout, stderr })
    })
  })
}

async function ensureDir(p: string) {
  await mkdir(p, { recursive: true })
}

async function which(cmd: string): Promise<string | undefined> {
  const pathEnv = process.env["PATH"] ?? ""
  const parts = pathEnv.split(path.delimiter).filter(Boolean)
  const exts = process.platform === "win32"
    ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""]

  for (const dir of parts) {
    for (const ext of exts) {
      const candidate = path.join(dir, process.platform === "win32" ? cmd + ext : cmd)
      if (await fileExists(candidate)) return candidate
    }
  }

  return undefined
}

async function resolvePackageBin(nodeDir: string, packageName: string, binName: string): Promise<string | undefined> {
  const pkgPath = path.join(nodeDir, "node_modules", packageName, "package.json")
  if (!(await fileExists(pkgPath))) return undefined
  const raw = JSON.parse(await readFile(pkgPath, "utf8")) as any
  const bin = raw.bin
  const rel = typeof bin === "string" ? bin : bin?.[binName]
  if (!rel) return undefined
  return path.join(nodeDir, "node_modules", packageName, rel)
}

async function ensureNodeDeps(nodeDir: string, signal?: AbortSignal): Promise<void> {
  await ensureDir(nodeDir)

  const pkgJsonPath = path.join(nodeDir, "package.json")
  const pkgJson = {
    private: true,
    name: "marvin-lsp",
    version: "0.0.0",
    dependencies: {
      typescript: "^5.8.0",
      "typescript-language-server": "^4.4.0",
      basedpyright: "^1.23.0"
    }
  }

  await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf8")

  const nodeModules = path.join(nodeDir, "node_modules")
  if (await fileExists(nodeModules)) return

  const bun = process.execPath
  const res = await run(bun, ["install"], nodeDir, { ...process.env, BUN_BE_BUN: "1" }, signal)
  if (res.code !== 0) throw new Error(`bun install failed: ${res.stderr || res.stdout}`)
}

function detectPythonPath(root: string): Promise<string | undefined> {
  // Best-effort: prefer VIRTUAL_ENV, then .venv, then venv
  const candidates = [
    process.env["VIRTUAL_ENV"],
    path.join(root, ".venv"),
    path.join(root, "venv"),
  ].filter(Boolean) as string[]

  const isWin = process.platform === "win32"

  return (async () => {
    for (const venv of candidates) {
      const python = isWin ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python")
      if (await fileExists(python)) return python
    }
    return undefined
  })()
}

export async function ensureSpawnSpec(serverId: LspServerId, opts: { configDir: string; root: string; signal?: AbortSignal }): Promise<LspSpawnSpec | undefined> {
  const binDir = path.join(opts.configDir, "lsp", "bin")
  const nodeDir = path.join(opts.configDir, "lsp", "node")

  await ensureDir(binDir)

  switch (serverId) {
    case "typescript": {
      await ensureNodeDeps(nodeDir, opts.signal)
      const bin = await resolvePackageBin(nodeDir, "typescript-language-server", "typescript-language-server")
      const tsserver = path.join(nodeDir, "node_modules", "typescript", "lib", "tsserver.js")
      if (!bin || !(await fileExists(tsserver))) return undefined

      return {
        serverId,
        command: process.execPath,
        args: [bin, "--stdio"],
        env: { ...process.env, BUN_BE_BUN: "1" },
        initializationOptions: { tsserver: { path: tsserver } },
      }
    }

    case "basedpyright": {
      await ensureNodeDeps(nodeDir, opts.signal)
      const bin = await resolvePackageBin(nodeDir, "basedpyright", "basedpyright-langserver")
      if (!bin) return undefined

      const pythonPath = await detectPythonPath(opts.root)

      return {
        serverId,
        command: process.execPath,
        args: [bin, "--stdio"],
        env: { ...process.env, BUN_BE_BUN: "1" },
        initializationOptions: pythonPath ? { pythonPath } : {},
      }
    }

    case "gopls": {
      const goplsInBin = path.join(binDir, process.platform === "win32" ? "gopls.exe" : "gopls")
      const fromBin = await fileExists(goplsInBin)
      const fromPath = fromBin ? goplsInBin : await which("gopls")

      let bin = fromPath
      if (!bin) {
        const go = await which("go")
        if (!go) return undefined
        const res = await run(go, ["install", "golang.org/x/tools/gopls@latest"], opts.root, { ...process.env, GOBIN: binDir }, opts.signal)
        if (res.code !== 0) return undefined
        if (!(await fileExists(goplsInBin))) return undefined
        bin = goplsInBin
      }

      return { serverId, command: bin, args: [], env: { ...process.env } }
    }

    case "rust-analyzer": {
      const ra = await which("rust-analyzer")
      if (ra) return { serverId, command: ra, args: [], env: { ...process.env } }

      const rustup = await which("rustup")
      if (!rustup) return undefined

      // Try stable component name, then preview name
      const env = { ...process.env }
      const ok1 = await run(rustup, ["component", "add", "rust-analyzer"], opts.root, env, opts.signal)
      if (ok1.code !== 0) {
        await run(rustup, ["component", "add", "rust-analyzer-preview"], opts.root, env, opts.signal)
      }

      const ra2 = await which("rust-analyzer")
      if (!ra2) return undefined
      return { serverId, command: ra2, args: [], env }
    }
  }
}

import path from "node:path"
import { mkdir, readFile, writeFile, chmod, stat, rename, rm } from "node:fs/promises"
import { spawn, execSync } from "node:child_process"
import { createGunzip } from "node:zlib"
import { pipeline } from "node:stream/promises"
import { createWriteStream } from "node:fs"
import { Readable } from "node:stream"
import { fileExists } from "./path.js"
import type { LspServerId, LspSpawnSpec } from "./types.js"

const STALE_DAYS = 7
const MS_PER_DAY = 86400000
const checkedStale = new Set<string>() // only check once per session

type GHAsset = { name: string; browser_download_url: string }
type GHRelease = { tag_name: string; assets: GHAsset[] }

async function isStale(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath)
    return Date.now() - s.mtimeMs > STALE_DAYS * MS_PER_DAY
  } catch {
    return true
  }
}

async function downloadGitHubRelease(
  repo: string,
  assetMatch: (name: string) => boolean,
  destPath: string,
  opts?: { signal?: AbortSignal; extractBin?: string }
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { signal: opts?.signal })
    if (!res.ok) return false
    const release = await res.json() as GHRelease
    const asset = release.assets.find((a) => assetMatch(a.name))
    if (!asset) return false

    const dlRes = await fetch(asset.browser_download_url, { signal: opts?.signal })
    if (!dlRes.ok || !dlRes.body) return false

    const destDir = path.dirname(destPath)
    await mkdir(destDir, { recursive: true })

    const tmpPath = destPath + ".tmp"
    const isTarGz = asset.name.endsWith(".tar.gz")
    const isGz = !isTarGz && asset.name.endsWith(".gz")

    if (isTarGz) {
      // Download tar.gz, extract specific binary
      const tarPath = path.join(destDir, asset.name)
      const out = createWriteStream(tarPath)
      await pipeline(Readable.fromWeb(dlRes.body as any), out)
      
      const binName = opts?.extractBin ?? path.basename(destPath)
      const extractDir = path.join(destDir, "_extract_" + Date.now())
      await mkdir(extractDir, { recursive: true })
      execSync(`tar -xzf "${tarPath}" -C "${extractDir}"`, { stdio: "ignore" })
      
      // Find the binary (might be in root or subdirectory)
      const findBin = execSync(`find "${extractDir}" -name "${binName}" -type f`, { encoding: "utf8" }).trim()
      if (findBin) {
        await chmod(findBin, 0o755)
        await rename(findBin, destPath)
      }
      await rm(extractDir, { recursive: true, force: true })
      await rm(tarPath, { force: true })
    } else if (isGz) {
      const gunzip = createGunzip()
      const out = createWriteStream(tmpPath)
      await pipeline(Readable.fromWeb(dlRes.body as any), gunzip, out)
      await chmod(tmpPath, 0o755)
      await rename(tmpPath, destPath)
    } else {
      // Plain binary
      const out = createWriteStream(tmpPath)
      await pipeline(Readable.fromWeb(dlRes.body as any), out)
      await chmod(tmpPath, 0o755)
      await rename(tmpPath, destPath)
    }

    await chmod(destPath, 0o755)
    return true
  } catch {
    return false
  }
}

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
      const env = { ...process.env }
      const localBin = path.join(binDir, "rust-analyzer")

      const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
      const platform = process.platform === "darwin" ? "apple-darwin"
        : process.platform === "linux" ? "unknown-linux-gnu"
        : null

      const download = () => platform ? downloadGitHubRelease(
        "rust-lang/rust-analyzer",
        (name) => name.startsWith(`rust-analyzer-${arch}-${platform}`) && name.endsWith(".gz"),
        localBin,
        { signal: opts.signal }
      ) : Promise.resolve(false)

      // 1. Use cached binary, update in background if stale (check once per session)
      if (await fileExists(localBin)) {
        if (!checkedStale.has(localBin)) {
          checkedStale.add(localBin)
          if (await isStale(localBin)) {
            download() // fire and forget
          }
        }
        return { serverId, command: localBin, args: [], env }
      }

      // 2. Download (first run)
      if (await download()) {
        return { serverId, command: localBin, args: [], env }
      }

      // 3. Fall back to system PATH
      const raPath = await which("rust-analyzer")
      if (raPath) return { serverId, command: raPath, args: [], env }

      return undefined
    }

    case "biome": {
      const env = { ...process.env }
      const localBin = path.join(binDir, "biome")

      const arch = process.arch === "arm64" ? "arm64" : "x64"
      const platform = process.platform === "darwin" ? "darwin"
        : process.platform === "linux" ? "linux"
        : null

      const download = () => platform ? downloadGitHubRelease(
        "biomejs/biome",
        (name) => name === `biome-${platform}-${arch}`,
        localBin,
        { signal: opts.signal }
      ) : Promise.resolve(false)

      if (await fileExists(localBin)) {
        if (!checkedStale.has(localBin)) {
          checkedStale.add(localBin)
          if (await isStale(localBin)) download()
        }
        return { serverId, command: localBin, args: ["lsp-proxy"], env }
      }

      if (await download()) {
        return { serverId, command: localBin, args: ["lsp-proxy"], env }
      }

      const biomePath = await which("biome")
      if (biomePath) return { serverId, command: biomePath, args: ["lsp-proxy"], env }

      return undefined
    }

    case "ruff": {
      const env = { ...process.env }
      const localBin = path.join(binDir, "ruff")

      const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
      const platform = process.platform === "darwin" ? "apple-darwin"
        : process.platform === "linux" ? "unknown-linux-gnu"
        : null

      const download = () => platform ? downloadGitHubRelease(
        "astral-sh/ruff",
        (name) => name === `ruff-${arch}-${platform}.tar.gz`,
        localBin,
        { signal: opts.signal, extractBin: "ruff" }
      ) : Promise.resolve(false)

      if (await fileExists(localBin)) {
        if (!checkedStale.has(localBin)) {
          checkedStale.add(localBin)
          if (await isStale(localBin)) download()
        }
        return { serverId, command: localBin, args: ["server"], env }
      }

      if (await download()) {
        return { serverId, command: localBin, args: ["server"], env }
      }

      const ruffPath = await which("ruff")
      if (ruffPath) return { serverId, command: ruffPath, args: ["server"], env }

      return undefined
    }

    case "ty": {
      const env = { ...process.env }
      const localBin = path.join(binDir, "ty")

      const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
      const platform = process.platform === "darwin" ? "apple-darwin"
        : process.platform === "linux" ? "unknown-linux-gnu"
        : null

      const download = () => platform ? downloadGitHubRelease(
        "astral-sh/ty",
        (name) => name === `ty-${arch}-${platform}.tar.gz`,
        localBin,
        { signal: opts.signal, extractBin: "ty" }
      ) : Promise.resolve(false)

      if (await fileExists(localBin)) {
        if (!checkedStale.has(localBin)) {
          checkedStale.add(localBin)
          if (await isStale(localBin)) download()
        }
        return { serverId, command: localBin, args: ["server"], env }
      }

      if (await download()) {
        return { serverId, command: localBin, args: ["server"], env }
      }

      const tyPath = await which("ty")
      if (tyPath) return { serverId, command: tyPath, args: ["server"], env }

      return undefined
    }
  }
}

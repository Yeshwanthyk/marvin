import path from "node:path"
import type { LspServerId } from "./types.js"
import { findUp } from "./path.js"

export const LANGUAGE_ID_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
}

export type LspServerDefinition = {
  id: LspServerId
  extensions: string[]
  rootMarkers: string[]
  priority: number
  detectRoot: (filePath: string, cwd: string) => Promise<string>
}

export async function detectRootByMarkers(filePath: string, cwd: string, markers: string[]): Promise<string> {
  const start = path.dirname(filePath)
  const hit = await findUp(start, cwd, markers)
  return hit ? path.dirname(hit) : cwd
}

export const SERVERS: LspServerDefinition[] = [
  {
    id: "typescript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    rootMarkers: [
      "package.json",
      "tsconfig.json",
      "jsconfig.json",
      "bun.lockb",
      "bun.lock",
      "pnpm-lock.yaml",
      "yarn.lock",
      "package-lock.json",
    ],
    priority: 10,
    detectRoot: (filePath, cwd) => detectRootByMarkers(filePath, cwd, [
      "package.json",
      "tsconfig.json",
      "jsconfig.json",
      "bun.lockb",
      "bun.lock",
      "pnpm-lock.yaml",
      "yarn.lock",
      "package-lock.json",
    ]),
  },
  {
    id: "basedpyright",
    extensions: [".py", ".pyi"],
    rootMarkers: [
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "Pipfile",
      "basedpyrightconfig.json",
      "pyrightconfig.json",
    ],
    priority: 10,
    detectRoot: (filePath, cwd) => detectRootByMarkers(filePath, cwd, [
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "Pipfile",
      "basedpyrightconfig.json",
      "pyrightconfig.json",
    ]),
  },
  {
    id: "gopls",
    extensions: [".go"],
    rootMarkers: ["go.work", "go.mod", "go.sum"],
    priority: 10,
    detectRoot: async (filePath, cwd) => {
      const start = path.dirname(filePath)
      const work = await findUp(start, cwd, ["go.work"])
      if (work) return path.dirname(work)
      const mod = await findUp(start, cwd, ["go.mod", "go.sum"])
      return mod ? path.dirname(mod) : cwd
    },
  },
  {
    id: "rust-analyzer",
    extensions: [".rs"],
    rootMarkers: ["Cargo.toml", "Cargo.lock"],
    priority: 10,
    detectRoot: (filePath, cwd) => detectRootByMarkers(filePath, cwd, ["Cargo.toml", "Cargo.lock"]),
  },
]

export function serversForFile(filePath: string): LspServerDefinition[] {
  const ext = path.extname(filePath)
  return SERVERS
    .filter((s) => s.extensions.includes(ext))
    .sort((a, b) => b.priority - a.priority)
}

export function languageIdForFile(filePath: string): string {
  const ext = path.extname(filePath)
  return LANGUAGE_ID_BY_EXT[ext] ?? "plaintext"
}

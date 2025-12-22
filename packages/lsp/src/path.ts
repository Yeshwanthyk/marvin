import path from "node:path"
import { access } from "node:fs/promises"

export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function findUp(startDir: string, stopDir: string, targets: string[]): Promise<string | undefined> {
  let dir = path.resolve(startDir)
  const stop = path.resolve(stopDir)

  while (true) {
    for (const t of targets) {
      const candidate = path.join(dir, t)
      if (await fileExists(candidate)) return candidate
    }

    if (dir === stop) return undefined
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export function isWithinDir(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return !rel.startsWith("..") && !path.isAbsolute(rel)
}

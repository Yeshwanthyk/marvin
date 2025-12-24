import * as os from "node:os"
import * as path from "node:path"
import crypto from "node:crypto"
import { spawn } from "node:child_process"

const REF_PREFIX = "refs/marvin-checkpoints/"

export type SnapshotRef = {
  ref: string
  label: string      // Human-readable: "Turn 3", "Session start"
  rawLabel: string   // Original: "checkpoint-turn-3-1234567890"
  kind: "turn" | "resume" | "before-rewind" | "latest" | "other"
  turnIndex?: number
  timestamp: number
}

export type FileChange = {
  status: "A" | "M" | "D" | "R" | "T" | "U" | "X"
  path: string
}

export async function listSnapshots(cwd: string): Promise<SnapshotRef[]> {
  const root = await gitRoot(cwd)
  if (!root) return []
  const gitDir = await snapshotGitDir(root, cwd)
  if (!gitDir) return []

  const refs = await gitLines(["--git-dir", gitDir, "for-each-ref", "--format=%(refname)", REF_PREFIX], cwd)
  return refs
    .filter((r) => r.startsWith(REF_PREFIX))
    .map((r) => toSnapshotRef(r))
    .filter((r): r is SnapshotRef => r !== null)
    .sort((a, b) => b.timestamp - a.timestamp)
}

export async function createSafetySnapshot(cwd: string): Promise<void> {
  const root = await gitRoot(cwd)
  if (!root) throw new Error("not a git repo")
  const gitDir = await snapshotGitDir(root, cwd)
  if (!gitDir) throw new Error("snapshot repo missing")

  await git(["-C", root, "--git-dir", gitDir, "--work-tree", root, "add", "-A", "."], cwd)
  const tree = await gitLine(["-C", root, "--git-dir", gitDir, "--work-tree", root, "write-tree"], cwd)
  const ts = Date.now()
  await git(["--git-dir", gitDir, "update-ref", "-m", "marvin checkpoint (before-rewind)", `${REF_PREFIX}before-rewind-${ts}`, tree], cwd)
  await git(["--git-dir", gitDir, "update-ref", "-m", "marvin checkpoint (latest)", `${REF_PREFIX}latest`, tree], cwd)
}

export async function restoreSnapshot(cwd: string, ref: string): Promise<void> {
  const root = await gitRoot(cwd)
  if (!root) throw new Error("not a git repo")
  const gitDir = await snapshotGitDir(root, cwd)
  if (!gitDir) throw new Error("snapshot repo missing")

  await git(["--git-dir", gitDir, "--work-tree", root, "read-tree", ref], cwd)
  await git(["--git-dir", gitDir, "--work-tree", root, "checkout-index", "-a", "-f"], cwd)
}

export async function getChangedFiles(cwd: string, targetRef: string): Promise<FileChange[]> {
  const root = await gitRoot(cwd)
  if (!root) return []
  const gitDir = await snapshotGitDir(root, cwd)
  if (!gitDir) return []

  try {
    // Create tree from current working state
    await git(["-C", root, "--git-dir", gitDir, "--work-tree", root, "add", "-A", "."], cwd)
    const currentTree = await gitLine(["-C", root, "--git-dir", gitDir, "--work-tree", root, "write-tree"], cwd)

    // Compare: current → target (what changes if we rewind to target)
    const lines = await gitLines(
      ["--git-dir", gitDir, "diff-tree", "-r", "--name-status", currentTree, targetRef],
      cwd
    )

    return lines
      .map((line) => {
        const match = line.match(/^([AMDRTUX])\t(.+)$/)
        if (!match) return null
        return { status: match[1] as FileChange["status"], path: match[2]! }
      })
      .filter((c): c is FileChange => c !== null)
  } catch {
    return []
  }
}

function dataHome(): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg && xdg.trim()) return xdg
  return path.join(os.homedir(), ".local", "share")
}

async function snapshotGitDir(root: string, cwd: string): Promise<string | null> {
  const id = await projectId(root, cwd)
  if (!id) return null
  return path.join(dataHome(), "marvin", "snapshot", id)
}

async function projectId(root: string, cwd: string): Promise<string> {
  const roots = await gitLines(["-C", root, "rev-list", "--max-parents=0", "--all"], cwd)
  if (roots[0]) return roots[0]
  return crypto.createHash("sha1").update(root).digest("hex")
}

function toSnapshotRef(ref: string): SnapshotRef | null {
  const rawLabel = ref.replace(REF_PREFIX, "")
  
  // Special refs without timestamps
  if (rawLabel === "latest") {
    return { ref, label: "Latest", rawLabel, kind: "latest", timestamp: Date.now() }
  }
  if (rawLabel === "resume") {
    return { ref, label: "Resume point", rawLabel, kind: "resume", timestamp: Date.now() }
  }
  
  // checkpoint-turn-N-timestamp
  const turnMatch = rawLabel.match(/^checkpoint-turn-(\d+)-(\d+)$/)
  if (turnMatch) {
    const turnIndex = parseInt(turnMatch[1]!, 10)
    const timestamp = parseInt(turnMatch[2]!, 10)
    return { ref, label: `Turn ${turnIndex}`, rawLabel, kind: "turn", turnIndex, timestamp }
  }
  
  // checkpoint-resume-timestamp
  const resumeMatch = rawLabel.match(/^checkpoint-resume-(\d+)$/)
  if (resumeMatch) {
    const timestamp = parseInt(resumeMatch[1]!, 10)
    return { ref, label: "Session start", rawLabel, kind: "resume", timestamp }
  }
  
  // before-rewind-timestamp
  const rewindMatch = rawLabel.match(/^before-rewind-(\d+)$/)
  if (rewindMatch) {
    const timestamp = parseInt(rewindMatch[1]!, 10)
    return { ref, label: "Before rewind", rawLabel, kind: "before-rewind", timestamp }
  }
  
  // Unknown pattern - try to extract timestamp
  const ts = extractTimestamp(ref)
  if (!ts) return null
  return { ref, label: rawLabel, rawLabel, kind: "other", timestamp: ts }
}

function extractTimestamp(ref: string): number {
  const parts = ref.split("-")
  const last = parts[parts.length - 1]
  const ts = parseInt(last ?? "", 10)
  return Number.isNaN(ts) ? 0 : ts
}

async function gitRoot(cwd: string): Promise<string | null> {
  const out = await gitLine(["rev-parse", "--show-toplevel"], cwd)
  return out || null
}

async function gitLine(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execGit(args, cwd)
  return stdout.trim()
}

async function gitLines(args: string[], cwd: string): Promise<string[]> {
  const { stdout } = await execGit(args, cwd)
  return stdout.split("\n").map((s) => s.trim()).filter(Boolean)
}

async function git(args: string[], cwd: string): Promise<void> {
  await execGit(args, cwd)
}

async function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const res = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const proc = spawn("git", args, { cwd, shell: false })
    let stdout = "", stderr = ""
    proc.stdout?.on("data", (d) => { stdout += d.toString() })
    proc.stderr?.on("data", (d) => { stderr += d.toString() })
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }))
    proc.on("error", () => resolve({ stdout, stderr, code: 1 }))
  })
  if (res.code !== 0) throw new Error((res.stderr || res.stdout || "git failed").trim())
  return res
}

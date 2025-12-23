/**
 * OpenCode-style snapshot hook for Marvin.
 *
 * Stores checkpoints in a private git object DB under XDG data:
 *   $XDG_DATA_HOME/marvin/snapshot/<projectId>/
 *
 * Creates refs (inside the private snapshot repo):
 *   refs/marvin-checkpoints/resume
 *   refs/marvin-checkpoints/latest
 *   refs/marvin-checkpoints/checkpoint-*
 *
 * Restore latest/resume:
 *   git --git-dir <gitDir> --work-tree <root> read-tree refs/marvin-checkpoints/latest
 *   git --git-dir <gitDir> --work-tree <root> checkout-index -a -f
 *
 * Install:
 *   cp examples/hooks/opencode-snapshot-rewind.ts ~/.config/marvin/hooks/
 *
 * Note: Hook runner enforces ~5s timeout per handler. Large repos may need
 * reduced snapshot frequency or increased runner timeout.
 */

import type { HookEventContext, HookFactory } from "@marvin-agents/coding-agent/hooks"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import crypto from "node:crypto"

const REF_PREFIX = "refs/marvin-checkpoints/"
const MAX_CHECKPOINTS = 100

function dataHome(): string {
	const xdg = process.env.XDG_DATA_HOME
	if (xdg && xdg.trim()) return xdg
	return path.join(os.homedir(), ".local", "share")
}

function marvinDataDir(): string {
	return path.join(dataHome(), "marvin")
}

async function inGit(ctx: HookEventContext): Promise<boolean> {
	const r = await ctx.exec("git", ["rev-parse", "--is-inside-work-tree"], { timeout: 2000 })
	return r.code === 0 && r.stdout.trim() === "true"
}

async function repoRoot(ctx: HookEventContext): Promise<string | null> {
	const r = await ctx.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 5000 })
	if (r.code !== 0) return null
	return r.stdout.trim()
}

async function projectId(ctx: HookEventContext, root: string): Promise<string> {
	const roots = await ctx.exec("git", ["-C", root, "rev-list", "--max-parents=0", "--all"], { timeout: 5000 })
	const candidates = roots.stdout
		.split("\n")
		.map((s: string) => s.trim())
		.filter(Boolean)
		.sort()

	if (candidates[0]) return candidates[0]

	// Fallback: stable per-machine/per-path
	return crypto.createHash("sha1").update(root).digest("hex")
}

async function ensureSnapshotRepo(ctx: HookEventContext, gitDir: string): Promise<void> {
	await fs.mkdir(gitDir, { recursive: true })
	const headPath = path.join(gitDir, "HEAD")
	const hasHead = await fs
		.stat(headPath)
		.then(() => true)
		.catch(() => false)
	if (hasHead) return

	const r = await ctx.exec("git", ["--git-dir", gitDir, "init"], { timeout: 5000 })
	if (r.code !== 0) throw new Error((r.stderr || r.stdout || "git init failed").trim())

	await ctx.exec("git", ["--git-dir", gitDir, "config", "core.autocrlf", "false"], { timeout: 2000 })
}

async function trackTree(ctx: HookEventContext, gitDir: string, root: string): Promise<string> {
	// NOTE: use -A to capture deletions (rm -rf) reliably.
	const add = await ctx.exec("git", ["-C", root, "--git-dir", gitDir, "--work-tree", root, "add", "-A", "."], { timeout: 10_000 })
	if (add.code !== 0 || add.killed) {
		throw new Error((add.stderr || add.stdout || "git add failed or was killed").trim())
	}

	const w = await ctx.exec("git", ["-C", root, "--git-dir", gitDir, "--work-tree", root, "write-tree"], { timeout: 5000 })
	if (w.code !== 0 || w.killed) {
		throw new Error((w.stderr || w.stdout || "git write-tree failed or was killed").trim())
	}
	return w.stdout.trim()
}

async function updateRef(ctx: HookEventContext, gitDir: string, ref: string, oid: string, msg: string): Promise<void> {
	const r = await ctx.exec("git", ["--git-dir", gitDir, "update-ref", "-m", msg, ref, oid], { timeout: 5000 })
	if (r.code !== 0) throw new Error((r.stderr || r.stdout || `update-ref failed: ${ref}`).trim())
}

/** Extract timestamp from ref name like "refs/marvin-checkpoints/checkpoint-turn-0-1234567890" */
function extractTimestamp(ref: string): number {
	const parts = ref.split("-")
	const last = parts[parts.length - 1]
	const ts = parseInt(last, 10)
	return Number.isNaN(ts) ? 0 : ts
}

async function prune(ctx: HookEventContext, gitDir: string): Promise<void> {
	const r = await ctx.exec("git", ["--git-dir", gitDir, "for-each-ref", "--format=%(refname)", REF_PREFIX], { timeout: 5000 })
	if (r.code !== 0) return

	const refs = r.stdout
		.split("\n")
		.map((s: string) => s.trim())
		.filter((s: string) => s.startsWith(`${REF_PREFIX}checkpoint-`))
		// Sort by timestamp (oldest first) so we prune oldest
		.sort((a, b) => extractTimestamp(a) - extractTimestamp(b))

	const excess = refs.length - MAX_CHECKPOINTS
	if (excess <= 0) return

	for (const ref of refs.slice(0, excess)) {
		await ctx.exec("git", ["--git-dir", gitDir, "update-ref", "-d", ref], { timeout: 5000 })
	}
}

const hook: HookFactory = (marvin) => {
	// Shared state with concurrency guards
	const state = {
		gitDir: "",
		root: "",
		initializing: null as Promise<boolean> | null,
		queue: Promise.resolve(), // Mutex for serializing checkpoint ops
	}

	const checkpoint = async (ctx: HookEventContext, kind: string) => {
		const tree = await trackTree(ctx, state.gitDir, state.root)
		const ts = Date.now()
		const id = `${REF_PREFIX}checkpoint-${kind}-${ts}`
		await updateRef(ctx, state.gitDir, id, tree, `marvin checkpoint (${kind})`)
		await updateRef(ctx, state.gitDir, `${REF_PREFIX}latest`, tree, `marvin checkpoint (latest)`)
		if (kind === "resume") await updateRef(ctx, state.gitDir, `${REF_PREFIX}resume`, tree, `marvin checkpoint (resume)`)
		await prune(ctx, state.gitDir)
		console.error(`[snapshot] ${kind} tree=${tree} gitDir=${state.gitDir}`)
	}

	/** Serialized checkpoint - queues behind any in-flight checkpoint */
	const queueCheckpoint = (ctx: HookEventContext, kind: string): Promise<void> => {
		state.queue = state.queue
			.then(() => checkpoint(ctx, kind))
			.catch((err) => {
				console.error(`[snapshot] ${kind} failed: ${err instanceof Error ? err.message : String(err)}`)
			})
		return state.queue
	}

	const doInit = async (ctx: HookEventContext): Promise<boolean> => {
		if (!(await inGit(ctx))) return false
		const root = await repoRoot(ctx)
		if (!root) return false

		const id = await projectId(ctx, root)
		const dir = path.join(marvinDataDir(), "snapshot", id)
		await ensureSnapshotRepo(ctx, dir)

		state.root = root
		state.gitDir = dir
		return true
	}

	/** Guarded init - prevents concurrent initialization */
	const init = (ctx: HookEventContext): Promise<boolean> => {
		if (state.gitDir && state.root) return Promise.resolve(true)
		if (state.initializing) return state.initializing
		state.initializing = doInit(ctx).finally(() => {
			state.initializing = null
		})
		return state.initializing
	}

	marvin.on("session.start", async (_ev, ctx) => {
		try {
			if (!(await init(ctx))) return
			await queueCheckpoint(ctx, "resume")
		} catch (err) {
			console.error(`[snapshot] session.start failed: ${err instanceof Error ? err.message : String(err)}`)
		}
	})

	marvin.on("session.resume", async (_ev, ctx) => {
		try {
			if (!(await init(ctx))) return
			await queueCheckpoint(ctx, "resume")
		} catch (err) {
			console.error(`[snapshot] session.resume failed: ${err instanceof Error ? err.message : String(err)}`)
		}
	})

	marvin.on("turn.start", async (ev, ctx) => {
		try {
			if (!(await init(ctx))) return
			await queueCheckpoint(ctx, `turn-${ev.turnIndex}`)
		} catch (err) {
			console.error(`[snapshot] turn.start failed: ${err instanceof Error ? err.message : String(err)}`)
		}
	})
}

export default hook

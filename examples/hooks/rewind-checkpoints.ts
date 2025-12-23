/**
 * Rewind checkpoints hook - creates git snapshot refs for quick restores.
 *
 * Install:
 *   cp examples/hooks/rewind-checkpoints.ts ~/.config/marvin/hooks/
 *
 * Creates:
 * - `refs/marvin-checkpoints/resume`  : snapshot at session start/resume
 * - `refs/marvin-checkpoints/latest`  : snapshot at each turn start
 * - `refs/marvin-checkpoints/checkpoint-*` : historical snapshots (pruned)
 *
 * Restore examples (safe: worktree only):
 *   git restore --source refs/marvin-checkpoints/latest --worktree -- .
 *   git restore --source refs/marvin-checkpoints/resume --worktree -- .
 *
 * Notes:
 * - Snapshot uses `git stash create` (captures tracked changes; does NOT include untracked files).
 * - Restore does not delete extra untracked files; run `git clean -fd` manually if you truly want that.
 */

import type { HookEventContext, HookFactory } from "@marvin-agents/coding-agent/hooks"

const REF_PREFIX = "refs/marvin-checkpoints/"
const HISTORY_PREFIX = `${REF_PREFIX}checkpoint-`
const RESUME_REF = `${REF_PREFIX}resume`
const LATEST_REF = `${REF_PREFIX}latest`
const MAX_CHECKPOINTS = 100

function makeCheckpointId(kind: string): string {
	const ts = Date.now()
	const rand = Math.random().toString(16).slice(2, 8)
	const safeKind = kind.replace(/[^A-Za-z0-9_.-]+/g, "-")
	return `checkpoint-${safeKind}-${ts}-${rand}`
}

async function isGitRepo(ctx: HookEventContext): Promise<boolean> {
	const r = await ctx.exec("git", ["rev-parse", "--is-inside-work-tree"], { timeout: 2000 })
	return r.code === 0 && r.stdout.trim() === "true"
}

async function snapshotCommit(ctx: HookEventContext): Promise<string> {
	// Captures tracked changes without touching worktree/index.
	const stash = await ctx.exec("git", ["stash", "create"], { timeout: 5000 })
	const hash = stash.stdout.trim()
	if (stash.code === 0 && hash) return hash

	// Fallback: clean tree, only untracked changes, or stash create unsupported.
	const head = await ctx.exec("git", ["rev-parse", "HEAD"], { timeout: 5000 })
	if (head.code !== 0) {
		throw new Error((head.stderr || head.stdout || "git rev-parse HEAD failed").trim())
	}
	return head.stdout.trim()
}

async function updateRef(ctx: HookEventContext, ref: string, hash: string, message: string): Promise<void> {
	const r = await ctx.exec("git", ["update-ref", "-m", message, ref, hash], { timeout: 5000 })
	if (r.code !== 0) {
		throw new Error((r.stderr || r.stdout || `git update-ref failed for ${ref}`).trim())
	}
}

async function pruneOld(ctx: HookEventContext): Promise<void> {
	const r = await ctx.exec("git", ["for-each-ref", "--format=%(refname)", REF_PREFIX], { timeout: 5000 })
	if (r.code !== 0) return

	const refs = r.stdout
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean)
		.filter((ref) => ref.startsWith(HISTORY_PREFIX))
		.sort()

	const excess = refs.length - MAX_CHECKPOINTS
	if (excess <= 0) return

	for (const ref of refs.slice(0, excess)) {
		await ctx.exec("git", ["update-ref", "-d", ref], { timeout: 5000 })
	}
}

async function createCheckpoint(ctx: HookEventContext, kind: string): Promise<void> {
	const hash = await snapshotCommit(ctx)
	const id = makeCheckpointId(kind)
	await updateRef(ctx, `${REF_PREFIX}${id}`, hash, `marvin checkpoint (${kind})`)
	await updateRef(ctx, LATEST_REF, hash, `marvin checkpoint (latest -> ${id})`)
	if (kind === "resume") {
		await updateRef(ctx, RESUME_REF, hash, `marvin checkpoint (resume -> ${id})`)
	}
	await pruneOld(ctx)
}

const hook: HookFactory = (marvin) => {
	marvin.on("session.start", async (_ev, ctx) => {
		try {
			if (!(await isGitRepo(ctx))) return
			await createCheckpoint(ctx, "resume")
		} catch (err) {
			console.error(`[rewind] resume checkpoint failed: ${err instanceof Error ? err.message : String(err)}`)
		}
	})

	marvin.on("session.resume", async (_ev, ctx) => {
		try {
			if (!(await isGitRepo(ctx))) return
			await createCheckpoint(ctx, "resume")
		} catch (err) {
			console.error(`[rewind] resume checkpoint failed: ${err instanceof Error ? err.message : String(err)}`)
		}
	})

	marvin.on("turn.start", async (ev, ctx) => {
		try {
			if (!(await isGitRepo(ctx))) return
			await createCheckpoint(ctx, `turn-${ev.turnIndex}`)
		} catch (err) {
			console.error(`[rewind] checkpoint failed: ${err instanceof Error ? err.message : String(err)}`)
		}
	})
}

export default hook

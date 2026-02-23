/**
 * Auto-compact hook - triggers compaction when context usage exceeds threshold.
 *
 * Copy to ~/.config/marvin/hooks/auto-compact.ts to enable.
 *
 * Configuration via environment:
 *   MARVIN_COMPACT_THRESHOLD        - percentage threshold (default: 85)
 *   MARVIN_COMPACT_COOLDOWN_MS      - min time between compacts (default: 120000)
 *   MARVIN_COMPACT_SETTLE_MS        - delay before compact call (default: 100)
 *   MARVIN_COMPACT_IDLE_TIMEOUT_MS  - max wait for idle (default: 30000)
 *   MARVIN_COMPACT_IDLE_POLL_MS     - idle poll interval (default: 100)
 */

interface TokenUsage {
	input: number
	output: number
	cacheRead?: number
	cacheWrite?: number
	total: number
}

interface TurnEndEvent {
	type: "turn.end"
	sessionId: string | null
	tokens: TokenUsage
	contextLimit: number
}

interface AgentEndEvent {
	type: "agent.end"
	sessionId: string | null
}

interface SessionCompactEvent {
	type: "session.compact"
	sessionId: string | null
	summary: string
}

interface SessionEvent {
	type: "session.start" | "session.resume" | "session.clear"
	sessionId: string | null
}

interface HookSessionContext {
	summarize(): Promise<void>
}

interface HookEventContext {
	session: HookSessionContext
	isIdle(): boolean
}

interface HookAPI {
	on(event: "turn.end", handler: (ev: TurnEndEvent, ctx: HookEventContext) => void): void
	on(event: "agent.end", handler: (ev: AgentEndEvent, ctx: HookEventContext) => void): void
	on(event: "session.compact", handler: (ev: SessionCompactEvent, ctx: HookEventContext) => void): void
	on(event: "session.clear", handler: (ev: SessionEvent, ctx: HookEventContext) => void): void
}

interface SessionState {
	pending: boolean
	compacting: boolean
	lastCompact: number
	timer: ReturnType<typeof setTimeout> | null
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitUntilIdle(ctx: HookEventContext, timeoutMs: number, pollMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (ctx.isIdle()) return true
		await sleep(pollMs)
	}
	return ctx.isIdle()
}

export default function autoCompact(marvin: HookAPI): void {
	const threshold = Number(process.env.MARVIN_COMPACT_THRESHOLD) || 85
	const cooldownMs = Number(process.env.MARVIN_COMPACT_COOLDOWN_MS) || 120_000
	const settleMs = Number(process.env.MARVIN_COMPACT_SETTLE_MS) || 100
	const idleTimeoutMs = Number(process.env.MARVIN_COMPACT_IDLE_TIMEOUT_MS) || 30_000
	const idlePollMs = Number(process.env.MARVIN_COMPACT_IDLE_POLL_MS) || 100

	const sessions = new Map<string, SessionState>()

	const getState = (sessionId: string): SessionState => {
		const state = sessions.get(sessionId)
		if (state) return state
		const created: SessionState = { pending: false, compacting: false, lastCompact: 0, timer: null }
		sessions.set(sessionId, created)
		return created
	}

	const attemptCompact = (sessionId: string, ctx: HookEventContext): void => {
		const state = getState(sessionId)
		if (!state.pending || state.compacting) return

		const now = Date.now()
		if (now - state.lastCompact < cooldownMs) return

		state.compacting = true
		void (async () => {
			try {
				const becameIdle = await waitUntilIdle(ctx, idleTimeoutMs, idlePollMs)
				if (!becameIdle) return

				await sleep(settleMs)
				if (!ctx.isIdle()) return

				state.pending = false
				await ctx.session.summarize()
			} finally {
				state.compacting = false
			}
		})()
	}

	const scheduleCompact = (sessionId: string, ctx: HookEventContext): void => {
		const state = getState(sessionId)
		if (state.timer !== null) return
		state.timer = setTimeout(() => {
			state.timer = null
			attemptCompact(sessionId, ctx)
		}, 0)
	}

	marvin.on("turn.end", (event) => {
		if (!event.sessionId) return
		if (!event.tokens?.total || !event.contextLimit) return

		const percent = (event.tokens.total / event.contextLimit) * 100
		if (percent < threshold) return

		const state = getState(event.sessionId)
		state.pending = true
	})

	marvin.on("agent.end", (event, ctx) => {
		if (!event.sessionId) return
		scheduleCompact(event.sessionId, ctx)
	})

	marvin.on("session.compact", (event) => {
		if (!event.sessionId) return
		const state = getState(event.sessionId)
		state.pending = false
		state.lastCompact = Date.now()
	})

	marvin.on("session.clear", (event) => {
		if (!event.sessionId) return
		const state = sessions.get(event.sessionId)
		if (state?.timer) clearTimeout(state.timer)
		sessions.delete(event.sessionId)
	})
}

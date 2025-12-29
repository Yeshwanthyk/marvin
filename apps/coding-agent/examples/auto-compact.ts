/**
 * Auto-compact hook - triggers compaction when context usage exceeds threshold.
 *
 * Copy to ~/.config/marvin/hooks/auto-compact.ts to enable.
 *
 * Configuration via environment:
 *   MARVIN_COMPACT_THRESHOLD - percentage threshold (default: 85)
 */

interface HookAPI {
	on(event: string, handler: (ev: any) => void): void
	send(text: string): void
}

export default function autoCompact(marvin: HookAPI): void {
	const threshold = Number(process.env.MARVIN_COMPACT_THRESHOLD) || 85
	let shouldCompact = false
	let compactPending = false

	// Track usage on turn.end
	marvin.on("turn.end", (event) => {
		if (!event.usage) return

		// Mark for compaction if threshold crossed
		if (event.usage.percent >= threshold && !compactPending) {
			shouldCompact = true
		}
	})

	// Actually trigger compact on agent.end (when idle)
	marvin.on("agent.end", () => {
		if (shouldCompact && !compactPending) {
			compactPending = true
			shouldCompact = false
			marvin.send("/compact")
		}
	})

	// Reset after compaction completes
	marvin.on("session.clear", () => {
		shouldCompact = false
		compactPending = false
	})
}

import { performance } from "node:perf_hooks"

type Stat = { count: number; totalMs: number; maxMs: number }

const enabled = process.env["MARVIN_TUI_PROFILE"] === "1"
const reportEveryMs = 2000
const stats = new Map<string, Stat>()
let lastReport = performance.now()

function record(name: string, ms: number): void {
	if (!enabled) return
	const stat = stats.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 }
	stat.count += 1
	stat.totalMs += ms
	if (ms > stat.maxMs) stat.maxMs = ms
	stats.set(name, stat)

	const now = performance.now()
	if (now - lastReport < reportEveryMs) return
	lastReport = now
	try {
		for (const [key, s] of stats) {
			const avg = s.totalMs / Math.max(1, s.count)
			process.stderr.write(`[perf] ${key} avg=${avg.toFixed(1)}ms max=${s.maxMs.toFixed(1)}ms n=${s.count}\n`)
			s.count = 0
			s.totalMs = 0
			s.maxMs = 0
		}
	} catch {}
}

export function profile<T>(name: string, fn: () => T): T {
	if (!enabled) return fn()
	const start = performance.now()
	try {
		return fn()
	} finally {
		record(name, performance.now() - start)
	}
}

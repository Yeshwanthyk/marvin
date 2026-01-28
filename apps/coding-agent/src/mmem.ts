/**
 * mmem client for full-text session search
 * Gracefully falls back when mmem unavailable
 */

import { spawnSync, spawn } from "bun";

export interface MmemSession {
  path: string;
  title: string;
  lastActivity: number;
  score: number;
}

export type MmemSearchResult =
  | { ok: true; sessions: MmemSession[] }
  | { ok: false; reason: "not-installed" | "not-indexed" | "exec-error" | "parse-error" };

interface MmemRawResult {
  path: string;
  title: string;
  last_message_at: string;
  score: number;
}

/**
 * Encode cwd to match marvin's session directory naming
 * e.g., /Users/foo/bar -> --Users--foo--bar--
 */
function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/\//g, "--")}--`;
}

/**
 * Search sessions via mmem with full-text search
 * Filters to marvin sessions in the specified cwd
 */
export function searchSessions(query: string, cwd: string, limit = 30): MmemSearchResult {
  // Check if mmem exists
  const which = spawnSync(["which", "mmem"]);
  if (which.exitCode !== 0) {
    return { ok: false, reason: "not-installed" };
  }

  // Run search
  const result = spawnSync([
    "mmem", "find", query,
    "--agent", "marvin",
    "--scope", "session",
    "--limit", String(limit),
    "--json",
  ]);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    if (stderr.includes("no such table") || stderr.includes("no index")) {
      return { ok: false, reason: "not-indexed" };
    }
    return { ok: false, reason: "exec-error" };
  }

  // Parse JSON
  let data: MmemRawResult[];
  try {
    const stdout = result.stdout.toString().trim();
    if (!stdout) {
      return { ok: true, sessions: [] };
    }
    data = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "parse-error" };
  }

  // Filter to current cwd and transform
  const encodedCwd = encodeCwd(cwd);
  const sessions: MmemSession[] = data
    .filter((r) => r.path.includes(encodedCwd))
    .map((r) => ({
      path: r.path,
      title: r.title,
      lastActivity: parseInt(r.last_message_at, 10),
      score: r.score,
    }));

  return { ok: true, sessions };
}

/**
 * Trigger mmem index in background (non-blocking)
 * Call after session ends or when picker opens
 */
export function triggerBackgroundIndex(): void {
  try {
    spawn(["mmem", "index"], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // Silently ignore - mmem may not be installed
  }
}

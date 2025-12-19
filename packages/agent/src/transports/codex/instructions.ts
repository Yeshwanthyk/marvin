import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const CACHE_DIR = join(process.env.HOME || "", ".marvin", "cache");
const CACHE_FILE = join(CACHE_DIR, "codex-instructions.md");
const CACHE_META_FILE = join(CACHE_DIR, "codex-instructions-meta.json");
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheMetadata {
	etag: string | null;
	tag: string;
	lastChecked: number;
}

/**
 * Get latest release tag from GitHub
 */
async function getLatestReleaseTag(): Promise<string> {
	const res = await fetch("https://api.github.com/repos/openai/codex/releases/latest");
	if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
	const data = await res.json() as { tag_name: string };
	return data.tag_name;
}

/**
 * Fetch Codex instructions from GitHub with ETag-based caching
 * Uses gpt-5.1-codex-max_prompt.md (used for gpt-5.2)
 */
export async function getCodexInstructions(): Promise<string> {
	try {
		// Check cache TTL
		if (existsSync(CACHE_META_FILE) && existsSync(CACHE_FILE)) {
			const meta: CacheMetadata = JSON.parse(readFileSync(CACHE_META_FILE, "utf-8"));
			if (Date.now() - meta.lastChecked < CACHE_TTL_MS) {
				return readFileSync(CACHE_FILE, "utf-8");
			}
		}

		// Get latest release tag
		const tag = await getLatestReleaseTag();
		const url = `https://raw.githubusercontent.com/openai/codex/${tag}/codex-rs/core/gpt-5.1-codex-max_prompt.md`;

		// Check if we have cached version with same tag
		if (existsSync(CACHE_META_FILE) && existsSync(CACHE_FILE)) {
			const meta: CacheMetadata = JSON.parse(readFileSync(CACHE_META_FILE, "utf-8"));
			if (meta.tag === tag) {
				// Update lastChecked and return cached
				meta.lastChecked = Date.now();
				writeFileSync(CACHE_META_FILE, JSON.stringify(meta));
				return readFileSync(CACHE_FILE, "utf-8");
			}
		}

		// Fetch new instructions
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to fetch instructions: ${res.status}`);
		const instructions = await res.text();

		// Cache
		mkdirSync(CACHE_DIR, { recursive: true });
		writeFileSync(CACHE_FILE, instructions);
		writeFileSync(CACHE_META_FILE, JSON.stringify({
			etag: res.headers.get("etag"),
			tag,
			lastChecked: Date.now(),
		} satisfies CacheMetadata));

		return instructions;
	} catch (err) {
		// Try cached version even if stale
		if (existsSync(CACHE_FILE)) {
			return readFileSync(CACHE_FILE, "utf-8");
		}
		throw err;
	}
}

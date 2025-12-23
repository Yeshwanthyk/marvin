import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CACHE_DIR = join(process.env.HOME || "", ".marvin", "cache");
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheMetadata {
	etag: string | null;
	tag: string;
	lastChecked: number;
}

type ModelFamily = "gpt-5.2-codex" | "gpt-5.2";

const PROMPT_FILES: Record<ModelFamily, string> = {
	"gpt-5.2-codex": "gpt-5.2-codex_prompt.md",
	"gpt-5.2": "gpt_5_2_prompt.md",
};

function getModelFamily(model: string): ModelFamily {
	const normalized = model.toLowerCase();
	// Check specific first
	if (normalized.includes("gpt-5.2-codex") || normalized.includes("gpt 5.2 codex")) {
		return "gpt-5.2-codex";
	}
	return "gpt-5.2";
}

function getCacheFiles(family: ModelFamily) {
	return {
		cache: join(CACHE_DIR, `codex-instructions-${family}.md`),
		meta: join(CACHE_DIR, `codex-instructions-${family}-meta.json`),
	};
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
 * Selects prompt file based on model family
 */
export async function getCodexInstructions(model: string): Promise<string> {
	const family = getModelFamily(model);
	const promptFile = PROMPT_FILES[family];
	const { cache: CACHE_FILE, meta: CACHE_META_FILE } = getCacheFiles(family);

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
		const url = `https://raw.githubusercontent.com/openai/codex/${tag}/codex-rs/core/${promptFile}`;

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

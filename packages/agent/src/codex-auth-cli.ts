#!/usr/bin/env node
/**
 * Simple CLI to authenticate with Codex (ChatGPT subscription)
 *
 * Usage: npx tsx packages/agent/src/codex-auth-cli.ts
 */

import { exec } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
	createAuthorizationFlow,
	exchangeAuthorizationCode,
	extractAccountId,
} from "./transports/codex/auth.js";
import { startLocalOAuthServer } from "./transports/codex/oauth-server.js";
import type { CodexTokens } from "./transports/codex/types.js";

export type TokenStoreOptions = {
	configDir?: string;
	tokensFile?: string;
};

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "marvin");
const LEGACY_CONFIG_DIR = join(homedir(), ".marvin");

function resolveTokensFile(options?: TokenStoreOptions): string {
	if (options?.tokensFile) return options.tokensFile;
	const configDir = options?.configDir ?? DEFAULT_CONFIG_DIR;
	return join(configDir, "codex-tokens.json");
}

function resolveLegacyTokensFile(): string {
	return join(LEGACY_CONFIG_DIR, "codex-tokens.json");
}

function shouldCheckLegacy(options?: TokenStoreOptions): boolean {
	if (options?.tokensFile) return false;
	return !options?.configDir || options.configDir === DEFAULT_CONFIG_DIR;
}

function ensurePrivateDirSync(dir: string): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	try {
		chmodSync(dir, 0o700);
	} catch {
		// ignore (best-effort)
	}
}

function writePrivateFileAtomicSync(filePath: string, contents: string): void {
	const dir = dirname(filePath);
	ensurePrivateDirSync(dir);

	const tmpPath = join(
		dir,
		`.${basename(filePath)}.tmp.${process.pid}.${Date.now()}`,
	);

	try {
		writeFileSync(tmpPath, contents, { mode: 0o600 });
		try {
			chmodSync(tmpPath, 0o600);
		} catch {
			// ignore (best-effort)
		}

		try {
			renameSync(tmpPath, filePath);
		} catch (err) {
			// Windows rename doesn't reliably overwrite existing files.
			if (process.platform !== "win32") throw err;
			try {
				unlinkSync(filePath);
			} catch {
				// ignore
			}
			renameSync(tmpPath, filePath);
		}

		try {
			chmodSync(filePath, 0o600);
		} catch {
			// ignore (best-effort)
		}
	} finally {
		try {
			unlinkSync(tmpPath);
		} catch {
			// ignore
		}
	}
}

function openBrowser(url: string): void {
	const cmd =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "start"
				: "xdg-open";
	exec(`${cmd} "${url}"`);
}

function isCodexTokens(value: unknown): value is CodexTokens {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.access === "string" &&
		typeof v.refresh === "string" &&
		typeof v.expires === "number"
	);
}

export function loadTokens(options?: TokenStoreOptions): CodexTokens | null {
	const tokensFile = resolveTokensFile(options);
	try {
		const data = readFileSync(tokensFile, "utf-8");
		const parsed = JSON.parse(data) as unknown;
		return isCodexTokens(parsed) ? parsed : null;
	} catch {
		// fall through to legacy
	}

	if (!shouldCheckLegacy(options)) return null;

	const legacyFile = resolveLegacyTokensFile();
	try {
		const data = readFileSync(legacyFile, "utf-8");
		const parsed = JSON.parse(data) as unknown;
		if (!isCodexTokens(parsed)) return null;

		// Best-effort migration into XDG config dir.
		try {
			saveTokens(parsed, { configDir: DEFAULT_CONFIG_DIR });
			unlinkSync(legacyFile);
		} catch {
			// ignore
		}

		return parsed;
	} catch {
		return null;
	}
}

export function saveTokens(tokens: CodexTokens, options?: TokenStoreOptions): void {
	const tokensFile = resolveTokensFile(options);
	writePrivateFileAtomicSync(tokensFile, `${JSON.stringify(tokens, null, 2)}\n`);
}

export function clearTokens(options?: TokenStoreOptions): void {
	const tokensFile = resolveTokensFile(options);
	try {
		unlinkSync(tokensFile);
	} catch {
		// ignore
	}

	if (!shouldCheckLegacy(options)) return;

	try {
		unlinkSync(resolveLegacyTokensFile());
	} catch {
		// ignore
	}
}

export async function authenticate(
	options?: TokenStoreOptions,
): Promise<CodexTokens | null> {
	console.log("🔐 Starting Codex OAuth flow...\n");

	// Create auth flow
	const flow = await createAuthorizationFlow();

	// Start local server
	const server = await startLocalOAuthServer(flow.state);

	console.log("Opening browser to authenticate with ChatGPT...");
	console.log(`\nIf browser doesn't open, visit:\n${flow.url}\n`);

	openBrowser(flow.url);

	console.log("Waiting for authentication...");

	// Wait for callback
	const result = await server.waitForCode(flow.state);
	server.close();

	if (!result) {
		console.error("❌ Authentication timed out or failed");
		return null;
	}

	console.log("Exchanging code for tokens...");

	// Exchange code for tokens
	const tokens = await exchangeAuthorizationCode(result.code, flow.pkce.verifier);

	if (tokens.type === "failed") {
		console.error("❌ Token exchange failed");
		return null;
	}

	const codexTokens: CodexTokens = {
		access: tokens.access,
		refresh: tokens.refresh,
		expires: tokens.expires,
	};

	saveTokens(codexTokens, options);

	const accountId = extractAccountId(tokens.access);
	console.log(`\n✅ Authenticated successfully!`);
	console.log(`   Account: ${accountId || "unknown"}`);
	console.log(`   Tokens saved to: ${resolveTokensFile(options)}`);
	console.log(`   Expires: ${new Date(tokens.expires).toLocaleString()}`);

	return codexTokens;
}

// Run if called directly (skip in compiled binaries)
if (
	import.meta.url === `file://${process.argv[1]}` &&
	!process.argv[1]?.includes("marvin")
) {
	const existing = loadTokens();
	if (existing && existing.expires > Date.now()) {
		// Already authenticated, silently exit
	} else if (process.argv.includes("--force") || !existing) {
		authenticate().catch(console.error);
	} else {
		console.log(`⚠️  Token expired at ${new Date(existing.expires).toLocaleString()}`);
		authenticate().catch(console.error);
	}
}

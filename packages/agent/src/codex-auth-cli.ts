#!/usr/bin/env node
/**
 * Simple CLI to authenticate with Codex (ChatGPT subscription)
 * 
 * Usage: npx tsx packages/agent/src/codex-auth-cli.ts
 */

import { exec } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createAuthorizationFlow,
	exchangeAuthorizationCode,
	extractAccountId,
} from "./transports/codex/auth.js";
import { startLocalOAuthServer } from "./transports/codex/oauth-server.js";
import type { CodexTokens } from "./transports/codex/types.js";

const CONFIG_DIR = join(homedir(), ".marvin");
const TOKENS_FILE = join(CONFIG_DIR, "codex-tokens.json");

function openBrowser(url: string): void {
	const cmd = process.platform === "darwin" 
		? "open" 
		: process.platform === "win32" 
			? "start" 
			: "xdg-open";
	exec(`${cmd} "${url}"`);
}

export function loadTokens(): CodexTokens | null {
	try {
		const data = readFileSync(TOKENS_FILE, "utf-8");
		return JSON.parse(data) as CodexTokens;
	} catch {
		return null;
	}
}

export function saveTokens(tokens: CodexTokens): void {
	mkdirSync(CONFIG_DIR, { recursive: true });
	writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

export function clearTokens(): void {
	try {
		writeFileSync(TOKENS_FILE, "{}");
	} catch {
		// ignore
	}
}

export async function authenticate(): Promise<CodexTokens | null> {
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
	
	// Save tokens
	saveTokens(codexTokens);
	
	const accountId = extractAccountId(tokens.access);
	console.log(`\n✅ Authenticated successfully!`);
	console.log(`   Account: ${accountId || "unknown"}`);
	console.log(`   Tokens saved to: ${TOKENS_FILE}`);
	console.log(`   Expires: ${new Date(tokens.expires).toLocaleString()}`);
	
	return codexTokens;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	authenticate().catch(console.error);
}

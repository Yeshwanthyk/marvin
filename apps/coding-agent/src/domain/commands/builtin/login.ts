import { exec } from "node:child_process"
import {
	saveAnthropicTokens,
	loadAnthropicTokens,
	clearAnthropicTokens,
	getAnthropicTokensPath,
	// Codex auth
	loadTokens as loadCodexTokens,
	saveTokens as saveCodexTokens,
	clearTokens as clearCodexTokens,
	createAuthorizationFlow,
	exchangeAuthorizationCode,
	startLocalOAuthServer,
} from "@yeshwanthyk/agent-core"
import { startAnthropicOAuth, completeAnthropicOAuth } from "@yeshwanthyk/ai"
import type { CommandDefinition } from "../types.js"
import { addSystemMessage } from "../helpers.js"

// Store pending OAuth state (verifier must persist between /login and /login code#state)
let pendingAuthUrl: string | null = null
let pendingVerifier: string | null = null

function openBrowser(url: string): void {
	const cmd =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
	exec(`${cmd} "${url}"`)
}

// ============ Codex Login ============

async function handleCodexLogin(args: string | undefined, configDir: string, ctx: Parameters<CommandDefinition["execute"]>[1]): Promise<boolean> {
	const subcommand = args?.replace(/^codex\s*/, "").trim()

	// /login codex status
	if (subcommand === "status") {
		const tokens = loadCodexTokens({ configDir })
		if (tokens) {
			const expiresAt = new Date(tokens.expires).toLocaleString()
			const isExpired = tokens.expires <= Date.now()
			addSystemMessage(
				ctx,
				isExpired
					? `Codex OAuth: Token expired at ${expiresAt}. Run /login codex to re-authenticate.`
					: `Codex OAuth: Logged in, token expires ${expiresAt}`,
			)
		} else {
			addSystemMessage(ctx, "Codex OAuth: Not logged in. Run /login codex to authenticate.")
		}
		return true
	}

	// /login codex clear
	if (subcommand === "clear" || subcommand === "logout") {
		clearCodexTokens({ configDir })
		addSystemMessage(ctx, "Codex OAuth tokens cleared.")
		return true
	}

	// /login codex - start OAuth flow with local server
	addSystemMessage(ctx, "Starting Codex OAuth flow...")

	try {
		const flow = await createAuthorizationFlow()
		const server = await startLocalOAuthServer(flow.state)

		openBrowser(flow.url)

		addSystemMessage(
			ctx,
			[
				"Browser opened for ChatGPT login.",
				"",
				"Waiting for authorization callback on localhost:1455...",
				"",
				`If browser didn't open, visit: ${flow.url}`,
			].join("\n"),
		)

		// Wait for callback (up to 60s)
		const result = await server.waitForCode(flow.state)
		server.close()

		if (!result) {
			addSystemMessage(ctx, "Codex login timed out. Please try again.")
			return true
		}

		// Exchange code for tokens
		const tokens = await exchangeAuthorizationCode(result.code, flow.pkce.verifier)

		if (tokens.type === "failed") {
			addSystemMessage(ctx, "Codex token exchange failed. Please try again.")
			return true
		}

		saveCodexTokens(
			{ access: tokens.access, refresh: tokens.refresh, expires: tokens.expires },
			{ configDir },
		)

		ctx.clearEditor?.()
		addSystemMessage(
			ctx,
			`Codex login successful! Token expires ${new Date(tokens.expires).toLocaleString()}`,
		)
	} catch (err) {
		addSystemMessage(ctx, `Codex login failed: ${err instanceof Error ? err.message : String(err)}`)
	}

	return true
}

// ============ Anthropic Login ============

async function handleAnthropicLogin(args: string | undefined, configDir: string, ctx: Parameters<CommandDefinition["execute"]>[1]): Promise<boolean> {
	// Strip "anthropic" prefix if present
	const subcommand = args?.replace(/^anthropic\s*/, "").trim()

	// /login anthropic status - show current login status
	if (subcommand === "status") {
		const tokens = loadAnthropicTokens({ configDir })
		if (tokens) {
			const expiresAt = new Date(tokens.expires).toLocaleString()
			const isExpired = tokens.expires <= Date.now()
			addSystemMessage(
				ctx,
				isExpired
					? `Anthropic OAuth: Token expired at ${expiresAt}. Run /login anthropic to re-authenticate.`
					: `Anthropic OAuth: Logged in, token expires ${expiresAt}`,
			)
		} else {
			addSystemMessage(ctx, "Anthropic OAuth: Not logged in. Run /login anthropic to authenticate.")
		}
		return true
	}

	// /login anthropic clear - clear stored tokens
	if (subcommand === "clear" || subcommand === "logout") {
		clearAnthropicTokens({ configDir })
		addSystemMessage(ctx, "Anthropic OAuth tokens cleared.")
		return true
	}

	// /login anthropic <code#state> - complete the OAuth flow
	if (subcommand && subcommand.includes("#")) {
		if (!pendingAuthUrl || !pendingVerifier) {
			addSystemMessage(ctx, "No pending login. Run /login anthropic first to start the OAuth flow.")
			return true
		}

		try {
			const credentials = await completeAnthropicOAuth(subcommand, pendingVerifier)
			saveAnthropicTokens(credentials, { configDir })
			pendingAuthUrl = null
			pendingVerifier = null
			ctx.clearEditor?.()
			addSystemMessage(
				ctx,
				`Logged in successfully! Token saved to ${getAnthropicTokensPath({ configDir })}`,
			)
		} catch (err) {
			pendingAuthUrl = null
			pendingVerifier = null
			addSystemMessage(ctx, `Login failed: ${err instanceof Error ? err.message : String(err)}`)
		}
		return true
	}

	// /login - start the OAuth flow
	addSystemMessage(ctx, "Starting Anthropic OAuth flow...")

	try {
		const { authUrl, verifier } = await startAnthropicOAuth()
		pendingAuthUrl = authUrl
		pendingVerifier = verifier
		openBrowser(authUrl)

		ctx.clearEditor?.()
		addSystemMessage(
			ctx,
			[
				"Browser opened for Anthropic login.",
				"",
				"After authorizing, you'll see a code like: abc123#xyz789",
				"",
				"Run: /login anthropic <code#state>",
				"",
				`Or visit: ${pendingAuthUrl}`,
			].join("\n"),
		)
	} catch (err) {
		pendingAuthUrl = null
		pendingVerifier = null
		addSystemMessage(ctx, `Login failed: ${err instanceof Error ? err.message : String(err)}`)
	}

	return true
}

// ============ Main Login Command ============

export const loginCommand: CommandDefinition = {
	name: "login",
	description: "Login with OAuth (anthropic or codex)",
	execute: async (args, ctx) => {
		const configDir = ctx.configDir

		// /login codex ... - Codex/ChatGPT login
		if (args?.startsWith("codex")) {
			return handleCodexLogin(args, configDir, ctx)
		}

		// /login anthropic ... - Anthropic/Claude login
		if (args?.startsWith("anthropic")) {
			return handleAnthropicLogin(args, configDir, ctx)
		}

		// /login status - show all login statuses
		if (args === "status") {
			const anthropicTokens = loadAnthropicTokens({ configDir })
			const codexTokens = loadCodexTokens({ configDir })

			const lines: string[] = []

			if (anthropicTokens) {
				const expiresAt = new Date(anthropicTokens.expires).toLocaleString()
				const isExpired = anthropicTokens.expires <= Date.now()
				lines.push(isExpired
					? `Anthropic: Expired at ${expiresAt}`
					: `Anthropic: Logged in, expires ${expiresAt}`)
			} else {
				lines.push("Anthropic: Not logged in")
			}

			if (codexTokens) {
				const expiresAt = new Date(codexTokens.expires).toLocaleString()
				const isExpired = codexTokens.expires <= Date.now()
				lines.push(isExpired
					? `Codex: Expired at ${expiresAt}`
					: `Codex: Logged in, expires ${expiresAt}`)
			} else {
				lines.push("Codex: Not logged in")
			}

			addSystemMessage(ctx, lines.join("\n"))
			return true
		}

		// /login (no args) - show help
		addSystemMessage(
			ctx,
			[
				"Usage: /login <provider> [subcommand]",
				"",
				"Providers:",
				"  anthropic  - Claude Pro/Max (manual code entry)",
				"  codex      - ChatGPT Plus/Pro (browser callback)",
				"",
				"Subcommands:",
				"  status     - Show login status",
				"  clear      - Clear stored tokens",
				"",
				"Examples:",
				"  /login anthropic        - Start Anthropic OAuth",
				"  /login codex            - Start Codex OAuth",
				"  /login status           - Show all login statuses",
			].join("\n"),
		)
		return true
	},
}

import { exec } from "node:child_process"
import {
	saveAnthropicTokens,
	loadAnthropicTokens,
	clearAnthropicTokens,
	getAnthropicTokensPath,
} from "@marvin-agents/agent-core"
import { loginAnthropic } from "@marvin-agents/ai"
import type { CommandDefinition } from "../types.js"
import { addSystemMessage } from "../helpers.js"

let pendingAuthUrl: string | null = null

function openBrowser(url: string): void {
	const cmd =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
	exec(`${cmd} "${url}"`)
}

export const loginCommand: CommandDefinition = {
	name: "login",
	description: "Login with Anthropic OAuth (Claude Pro/Max)",
	execute: async (args, ctx) => {
		const configDir = ctx.configDir

		// /login status - show current login status
		if (args === "status") {
			const tokens = loadAnthropicTokens({ configDir })
			if (tokens) {
				const expiresAt = new Date(tokens.expires).toLocaleString()
				const isExpired = tokens.expires <= Date.now()
				addSystemMessage(
					ctx,
					isExpired
						? `Anthropic OAuth: Token expired at ${expiresAt}. Run /login to re-authenticate.`
						: `Anthropic OAuth: Logged in, token expires ${expiresAt}`,
				)
			} else {
				addSystemMessage(ctx, "Anthropic OAuth: Not logged in. Run /login to authenticate.")
			}
			return true
		}

		// /login clear - clear stored tokens
		if (args === "clear" || args === "logout") {
			clearAnthropicTokens({ configDir })
			addSystemMessage(ctx, "Anthropic OAuth tokens cleared.")
			return true
		}

		// /login <code#state> - complete the OAuth flow
		if (args && args.includes("#")) {
			if (!pendingAuthUrl) {
				addSystemMessage(ctx, "No pending login. Run /login first to start the OAuth flow.")
				return true
			}

			try {
				const credentials = await loginAnthropic(
					() => {}, // URL already shown
					async () => args, // Return the provided code
				)
				saveAnthropicTokens(credentials, { configDir })
				pendingAuthUrl = null
				addSystemMessage(
					ctx,
					`Logged in successfully! Token saved to ${getAnthropicTokensPath({ configDir })}`,
				)
			} catch (err) {
				pendingAuthUrl = null
				addSystemMessage(ctx, `Login failed: ${err instanceof Error ? err.message : String(err)}`)
			}
			return true
		}

		// /login - start the OAuth flow
		addSystemMessage(ctx, "Starting Anthropic OAuth flow...")

		try {
			// We need to capture the URL without completing the flow
			const credentials = await loginAnthropic(
				(url: string) => {
					pendingAuthUrl = url
					openBrowser(url)
				},
				async () => {
					// Show instructions and return empty to abort this attempt
					// User will call /login <code> to complete
					throw new Error("PENDING")
				},
			)
			// If we get here, somehow completed without user input (shouldn't happen)
			saveAnthropicTokens(credentials, { configDir })
			addSystemMessage(ctx, "Logged in successfully!")
		} catch (err) {
			if (err instanceof Error && err.message === "PENDING") {
				// Expected - show instructions
				addSystemMessage(
					ctx,
					[
						"Browser opened for Anthropic login.",
						"",
						"After authorizing, you'll see a code like: abc123#xyz789",
						"",
						"Run: /login <code#state>",
						"",
						`Or visit: ${pendingAuthUrl}`,
					].join("\n"),
				)
			} else {
				pendingAuthUrl = null
				addSystemMessage(ctx, `Login failed: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		return true
	},
}

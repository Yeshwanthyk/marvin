import type { CodexTokens } from "./types.js";
import { refreshAccessToken, shouldRefreshToken, decodeJWT } from "./auth.js";
import { CODEX_BASE_URL, OPENAI_HEADERS, OPENAI_HEADER_VALUES, JWT_CLAIM_PATH } from "./constants.js";

export interface CodexFetchOptions {
	getTokens: () => Promise<CodexTokens | null>;
	setTokens: (tokens: CodexTokens) => Promise<void>;
	clearTokens: () => Promise<void>;
}

/**
 * Extract ChatGPT account ID from access token
 */
function extractAccountId(accessToken: string): string | null {
	const payload = decodeJWT(accessToken);
	return (payload?.[JWT_CLAIM_PATH] as any)?.chatgpt_account_id ?? null;
}

/**
 * Create custom fetch for Codex API
 * Handles OAuth headers, token refresh, and URL rewriting
 */
export function createCodexFetch(options: CodexFetchOptions): typeof fetch {
	let accountId: string | null = null;

	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		// Get and refresh tokens if needed
		let tokens = await options.getTokens();
		if (!tokens) {
			throw new Error("Not authenticated with Codex");
		}

		if (shouldRefreshToken(tokens.expires)) {
			const result = await refreshAccessToken(tokens.refresh);
			if (result.type === "failed") {
				await options.clearTokens();
				throw new Error("Token refresh failed");
			}
			tokens = { access: result.access, refresh: result.refresh, expires: result.expires };
			await options.setTokens(tokens);
			accountId = extractAccountId(result.access);
		}

		if (!accountId) {
			accountId = extractAccountId(tokens.access);
		}

		if (!accountId) {
			throw new Error("Could not extract account ID from token");
		}

		// Rewrite URL: api.openai.com/v1/responses → chatgpt.com/backend-api/codex/responses
		let url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		if (url.includes("api.openai.com")) {
			url = url.replace(/https:\/\/api\.openai\.com\/v1/, CODEX_BASE_URL);
			url = url.replace("/responses", "/codex/responses");
		}

		// Build headers
		const headers = new Headers(init?.headers);
		headers.delete("x-api-key");
		headers.set("Authorization", `Bearer ${tokens.access}`);
		headers.set(OPENAI_HEADERS.ACCOUNT_ID, accountId);
		headers.set(OPENAI_HEADERS.BETA, OPENAI_HEADER_VALUES.BETA_RESPONSES);
		headers.set(OPENAI_HEADERS.ORIGINATOR, OPENAI_HEADER_VALUES.ORIGINATOR_CODEX);
		headers.set("accept", "text/event-stream");

		// Transform request body
		if (init?.body) {
			try {
				const body = JSON.parse(init.body as string);
				body.store = false;
				body.stream = true;
				body.include = ["reasoning.encrypted_content"];
				
				// Remove unsupported parameters
				delete body.max_output_tokens;
				
				// Filter input items (remove item_reference, strip IDs)
				if (Array.isArray(body.input)) {
					body.input = body.input
						.filter((item: any) => item.type !== "item_reference")
						.map(({ id, ...rest }: any) => rest);
				}

				init = { ...init, body: JSON.stringify(body) };
			} catch {
				// Keep original body if not JSON
			}
		}

		const response = await fetch(url, { ...init, headers });

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Codex API error ${response.status}: ${text}`);
		}

		return response;
	};
}

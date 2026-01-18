import { randomBytes } from "node:crypto";
import type {
	AuthorizationFlow,
	JWTPayload,
	ParsedAuthInput,
	PKCEPair,
	TokenResult,
} from "./types.js";

// OAuth constants from Codex CLI
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const TOKEN_URL = "https://auth.openai.com/oauth/token";
export const REDIRECT_URI = "http://localhost:1455/auth/callback";
export const SCOPE = "openid profile email offline_access";

/** Buffer time before token expiry to trigger refresh (5 minutes) */
export const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Generate PKCE challenge and verifier
 */
async function generatePKCE(): Promise<PKCEPair> {
	const verifier = randomBytes(32).toString("base64url");
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const challenge = Buffer.from(hash).toString("base64url");
	return { verifier, challenge };
}

/**
 * Generate random state for OAuth flow
 */
export function createState(): string {
	return randomBytes(16).toString("hex");
}

/**
 * Parse authorization code and state from callback URL or user input
 */
export function parseAuthorizationInput(input: string): ParsedAuthInput {
	const value = (input || "").trim();
	if (!value) return {};

	const fromParams = (code: string | null, state: string | null): ParsedAuthInput => {
		const result: ParsedAuthInput = {};
		if (code !== null) {
			result.code = code;
		}
		if (state !== null) {
			result.state = state;
		}
		return result;
	};

	try {
		const url = new URL(value);
		return fromParams(url.searchParams.get("code"), url.searchParams.get("state"));
	} catch {
		// Not a URL, try other formats
	}

	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		const result: ParsedAuthInput = {};
		if (code !== undefined) {
			result.code = code;
		}
		if (state !== undefined) {
			result.state = state;
		}
		return result;
	}

	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return fromParams(params.get("code"), params.get("state"));
	}

	return { code: value };
}

/**
 * Exchange authorization code for access and refresh tokens
 */
export async function exchangeAuthorizationCode(
	code: string,
	verifier: string,
	redirectUri: string = REDIRECT_URI,
): Promise<TokenResult> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
	});

	if (!res.ok) {
		return { type: "failed" };
	}

	const json = (await res.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	if (!json?.access_token || !json?.refresh_token || typeof json?.expires_in !== "number") {
		return { type: "failed" };
	}

	return {
		type: "success",
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
	};
}

/**
 * Decode JWT to extract payload (no verification)
 */
export function decodeJWT(token: string): JWTPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const decoded = Buffer.from(parts[1], "base64").toString("utf-8");
		return JSON.parse(decoded) as JWTPayload;
	} catch {
		return null;
	}
}

/**
 * Extract ChatGPT account ID from access token
 */
export function extractAccountId(accessToken: string): string | null {
	const payload = decodeJWT(accessToken);
	return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResult> {
	try {
		const response = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: CLIENT_ID,
			}),
		});

		if (!response.ok) {
			return { type: "failed" };
		}

		const json = (await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};

		if (!json?.access_token || !json?.refresh_token || typeof json?.expires_in !== "number") {
			return { type: "failed" };
		}

		return {
			type: "success",
			access: json.access_token,
			refresh: json.refresh_token,
			expires: Date.now() + json.expires_in * 1000,
		};
	} catch {
		return { type: "failed" };
	}
}

/**
 * Check if token should be refreshed (within 5 minute buffer of expiry)
 */
export function shouldRefreshToken(expiresAt: number): boolean {
	return Date.now() >= expiresAt - REFRESH_BUFFER_MS;
}

/**
 * Create OAuth authorization flow with PKCE
 */
export async function createAuthorizationFlow(): Promise<AuthorizationFlow> {
	const pkce = await generatePKCE();
	const state = createState();

	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("redirect_uri", REDIRECT_URI);
	url.searchParams.set("scope", SCOPE);
	url.searchParams.set("code_challenge", pkce.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", "codex_cli_rs");

	return { pkce, state, url: url.toString() };
}

/**
 * Codex OAuth token storage
 */
export interface CodexTokens {
	access: string;
	refresh: string;
	/** Unix timestamp in milliseconds when access token expires */
	expires: number;
}

/**
 * Full Codex authentication state
 */
export interface CodexAuthState {
	tokens: CodexTokens | null;
	/** ChatGPT account ID extracted from JWT */
	accountId: string | null;
}

/**
 * PKCE challenge and verifier pair
 */
export interface PKCEPair {
	challenge: string;
	verifier: string;
}

/**
 * OAuth authorization flow data
 */
export interface AuthorizationFlow {
	pkce: PKCEPair;
	state: string;
	url: string;
}

/**
 * Token exchange success result
 */
export interface TokenSuccess {
	type: "success";
	access: string;
	refresh: string;
	expires: number;
}

/**
 * Token exchange failure result
 */
export interface TokenFailure {
	type: "failed";
}

/**
 * Token exchange result
 */
export type TokenResult = TokenSuccess | TokenFailure;

/**
 * Parsed authorization callback input
 */
export interface ParsedAuthInput {
	code?: string;
	state?: string;
}

/**
 * JWT payload with ChatGPT account info
 */
export interface JWTPayload {
	"https://api.openai.com/auth"?: {
		chatgpt_account_id?: string;
	};
	[key: string]: unknown;
}

/**
 * OAuth callback server info
 */
export interface OAuthServerInfo {
	port: number;
	close: () => void;
	waitForCode: (state: string) => Promise<{ code: string } | null>;
}

/**
 * Reasoning configuration for Codex requests
 */
export interface ReasoningConfig {
	effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	summary: "auto" | "concise" | "detailed" | "off" | "on";
}

/**
 * Input item in Codex request
 */
export interface InputItem {
	id?: string;
	type: string;
	role?: string;
	content?: unknown;
	call_id?: string;
	[key: string]: unknown;
}

/**
 * Codex request body structure
 */
export interface CodexRequestBody {
	model: string;
	store?: boolean;
	stream?: boolean;
	instructions?: string;
	input?: InputItem[];
	tools?: unknown;
	reasoning?: Partial<ReasoningConfig>;
	text?: {
		verbosity?: "low" | "medium" | "high";
	};
	include?: string[];
	max_output_tokens?: number;
	max_completion_tokens?: number;
	[key: string]: unknown;
}

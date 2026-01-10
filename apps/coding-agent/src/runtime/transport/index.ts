import {
	CodexTransport,
	ProviderTransport,
	RouterTransport,
	clearTokens,
	loadTokens,
	saveTokens,
	loadAnthropicTokens,
} from "@marvin-agents/agent-core"
import { getApiKey } from "@marvin-agents/ai"
import type { LoadedAppConfig } from "../../config.js"

export interface TransportBundle {
	provider: ProviderTransport
	codex: CodexTransport
	router: RouterTransport
}

export type ApiKeyResolver = (provider: string) => string | undefined

export const defaultApiKeyResolver: ApiKeyResolver = (provider) => {
	if (provider === "anthropic") {
		return process.env["ANTHROPIC_OAUTH_TOKEN"] || getApiKey(provider)
	}
	return getApiKey(provider)
}

export const createApiKeyResolver = (configDir: string): ApiKeyResolver => {
	return (provider) => {
		if (provider === "anthropic") {
			// Check stored OAuth tokens first
			const tokens = loadAnthropicTokens({ configDir })
			if (tokens && tokens.expires > Date.now()) {
				return tokens.access
			}
			// Fall back to env var or API key
			return process.env["ANTHROPIC_OAUTH_TOKEN"] || getApiKey(provider)
		}
		return getApiKey(provider)
	}
}

export const createTransportBundle = (
	config: LoadedAppConfig,
	resolver?: ApiKeyResolver,
): TransportBundle => {
	const apiKeyResolver = resolver ?? createApiKeyResolver(config.configDir)
	const provider = new ProviderTransport({ getApiKey: apiKeyResolver })
	const codex = new CodexTransport({
		getTokens: async () => loadTokens({ configDir: config.configDir }),
		setTokens: async (tokens) => saveTokens(tokens, { configDir: config.configDir }),
		clearTokens: async () => clearTokens({ configDir: config.configDir }),
	})
	const router = new RouterTransport({ provider, codex })
	return { provider, codex, router }
}

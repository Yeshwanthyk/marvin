import {
	CodexTransport,
	ProviderTransport,
	RouterTransport,
	clearTokens,
	loadTokens,
	saveTokens,
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

export const createTransportBundle = (
	config: LoadedAppConfig,
	resolver: ApiKeyResolver = defaultApiKeyResolver,
): TransportBundle => {
	const provider = new ProviderTransport({ getApiKey: resolver })
	const codex = new CodexTransport({
		getTokens: async () => loadTokens({ configDir: config.configDir }),
		setTokens: async (tokens) => saveTokens(tokens, { configDir: config.configDir }),
		clearTokens: async () => clearTokens({ configDir: config.configDir }),
	})
	const router = new RouterTransport({ provider, codex })
	return { provider, codex, router }
}

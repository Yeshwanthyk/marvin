import {
  CodexTransport,
  ProviderTransport,
  RouterTransport,
  clearTokens,
  loadTokens,
  saveTokens,
  loadAnthropicTokens,
} from "@yeshwanthyk/agent-core";
import { getApiKey } from "@yeshwanthyk/ai";
import { Context, Effect, Layer } from "effect";
import type { LoadedAppConfig } from "./config.js";

export interface TransportBundle {
  provider: ProviderTransport;
  codex: CodexTransport;
  router: RouterTransport;
}

export type ApiKeyResolver = (provider: string) => string | undefined;

export const defaultApiKeyResolver: ApiKeyResolver = (provider) => {
  if (provider === "anthropic") {
    return process.env["ANTHROPIC_OAUTH_TOKEN"] || getApiKey(provider);
  }
  return getApiKey(provider);
};

export const createApiKeyResolver = (configDir: string): ApiKeyResolver => {
  return (provider) => {
    if (provider === "anthropic") {
      const tokens = loadAnthropicTokens({ configDir });
      if (tokens && tokens.expires > Date.now()) {
        return tokens.access;
      }
      return process.env["ANTHROPIC_OAUTH_TOKEN"] || getApiKey(provider);
    }
    return getApiKey(provider);
  };
};

export const createTransportBundle = (config: LoadedAppConfig, resolver?: ApiKeyResolver): TransportBundle => {
  const apiKeyResolver = resolver ?? createApiKeyResolver(config.configDir);
  const provider = new ProviderTransport({ getApiKey: apiKeyResolver });
  const codex = new CodexTransport({
    getTokens: async () => loadTokens({ configDir: config.configDir }),
    setTokens: async (tokens) => saveTokens(tokens, { configDir: config.configDir }),
    clearTokens: async () => clearTokens({ configDir: config.configDir }),
  });
  const router = new RouterTransport({ provider, codex });
  return { provider, codex, router };
};

export interface TransportService {
  readonly transport: TransportBundle;
}

export const TransportTag = Context.GenericTag<TransportService>("runtime-effect/TransportService");

export const TransportLayer = (config: LoadedAppConfig, resolver?: ApiKeyResolver) =>
  Layer.effect(
    TransportTag,
    Effect.sync(() => ({
      transport: createTransportBundle(config, resolver),
    })),
  );

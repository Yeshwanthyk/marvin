# Provider adapters + Codex OAuth

`packages/providers` houses the reusable adapters that the runtime loads when it needs to talk to Anthropic, OpenAI Responses, or Codex. This package is intentionally self-contained so Bun runtimes (CLI, runtime, UI) can share transports without duplicating OAuth or streaming primitives.

## Folder map

- `src/stream.ts` — streaming helper exposed as `ProviderStream`. It stores replayable history, forwards text/tool deltas to subscribers, and exposes an async iterator for the UI/runtime.
- `src/types.ts` — shared adapter contracts (`ProviderAdapter`, `ProviderFactory`, and `ProviderInvokePayload`). Each adapter gets the full `AgentConfig` + `AgentConversation` plus optional `AgentProviderMetadata` when the runtime needs to override default labels.
- `src/api-keys.ts` — pluggable API-key stores (`createEnvApiKeyStore`, `createMemoryApiKeyStore`, and `createApiKeyManager`). Runtimes can inject their preferred storage layer and still keep a uniform `getApiKey`/`setApiKey` story.
- `src/registry.ts` — lazy-loading registry that instantiates adapters on demand. Consumers can register factories (e.g. `createAnthropicAdapter`) and look up adapters by provider name or by `supportsModel(model)` fallback.
- `src/providers/` — adapter implementations. Each adapter owns its fetch logic and converts SSE events into `ProviderStream` events so higher layers never juggle provider-specific streaming payloads.
- `src/utils/` — shared utilities. `conversation.ts` converts `AgentConversation` messages into provider-specific payloads (Anthropic string arrays, OpenAI input blocks) while `sse.ts` wraps Bun/WHATWG streams with a small SSE parser.
- `src/codex/` — Codex OAuth helpers. `CodexOAuthClient` wraps `opencode-openai-codex-auth` so we inherit the official PKCE + refresh flow, `storage.ts` implements `FileTokenStorage` (`~/.config/mu/codex-token.json`) and `MemoryTokenStorage` for tests, and `normalizeCodexModel` mirrors the opencode model map.

## Adding a provider

1. **Create the adapter** inside `src/providers`. Export either a `ProviderFactory` (no options) or a function that returns a `ProviderFactory` when you need custom options (see `createCodexOAuthAdapter`).
2. **Use `ProviderStream`** for streaming transports. Emit `text-delta`, `text-complete`, `tool-call-delta`, `tool-result`, `metadata`, `usage`, and `response` events as you parse SSE frames or batched JSON responses.
3. **Convert runtime messages** with helpers from `src/utils/conversation.ts`. This keeps Anthropic/OpenAI payload shapes in sync with `AgentConversation`.
4. **Map provider usage** to `AgentUsage`. Each adapter should transform provider specific billing/usage payloads so runtimes can surface consistent telemetry.
5. **Register factories** through `ProviderRegistry`. Runtimes typically instantiate a registry with `createApiKeyManager()` (for key-based providers) and `createCodexOAuthAdapter()` (for OAuth providers) and then call `registry.resolve(config)` when dispatching a request.
6. **Document configuration** (API keys, OAuth scopes, custom base URLs) so other packages know which stores or environment variables to expose.

## Codex OAuth storage

`CodexOAuthClient` wraps the official `opencode-openai-codex-auth` helpers:

- `ensureAuthenticated()` launches the PKCE browser/device flow when no valid token exists, falls back to refresh tokens, and returns `{ accessToken, refreshToken, expiresAt, accountId }`.
- Tokens are persisted via an injected `CodexTokenStorage`. The default `FileTokenStorage` writes JSON to `~/.config/mu/codex-token.json` so every CLI instance shares the same credential cache. Tests can swap in `MemoryTokenStorage` or a custom encrypted store.
- Consumers can clear credentials by calling `CodexOAuthClient.clear()` when the user revokes access.

Adapters that call Codex (`createCodexOAuthAdapter`) receive an authenticated fetch client, automatically normalize model aliases (e.g. `gpt-5.1-codex-max`), and stream Codex SSE payloads through the shared `ProviderStream`.

## API key flow

For key-based providers, call `createApiKeyManager()` and pass the resulting `getApiKey`/`setApiKey` into the `ProviderRegistry`. The default manager checks environment variables first (`MU_PROVIDER_<PROVIDER>`) and falls back to an in-memory store that can be mutated at runtime (e.g. after prompting the user). To add custom persistence (filesystem, secure storage), implement the `ApiKeyStore` interface and pass it to `createApiKeyManager({ stores: [...] })`.

Keeping the provider adapters, registry, key stores, and OAuth client isolated inside `packages/providers` lets `packages/agent`, `packages/coding-agent`, and future CLIs import a single package and stay agnostic of provider-specific transports.

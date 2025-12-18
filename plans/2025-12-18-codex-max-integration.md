# Codex Max OAuth Integration Plan

## Overview

Integrate OpenAI Codex Max plan authentication into the existing provider transport system, enabling seamless model swapping between Codex models (OAuth) and standard providers (API key).

## Current State Analysis

### Existing Architecture
- `ProviderTransport` → calls providers directly via `getApiKey(provider)` callback
- `AppTransport` → proxies through server with auth tokens
- `stream.ts` → dispatches to provider-specific stream functions based on `model.api`
- Model registry → `MODELS` object keyed by provider, contains model configs

### What's Missing
- OAuth token management for Codex (access + refresh tokens)
- Request transformation for ChatGPT backend (store=false, input filtering, reasoning config)
- Codex models in registry (`gpt-5.1-codex-max`, `gpt-5.2`, etc.)
- Router transport for automatic transport selection

### Key Constraints
- Codex uses ChatGPT backend, not OpenAI Platform API
- Requires `store=false`, input filtering, encrypted reasoning content
- OAuth tokens expire, need refresh flow
- `xhigh` reasoning only supported by `gpt-5.1-codex-max` and `gpt-5.2`

## Desired End State

```
/model codex/gpt-5.1-codex-max  → RouterTransport → CodexTransport (OAuth)
/model anthropic/claude-opus-4-5      → RouterTransport → ProviderTransport (API key)
/model openai/gpt-4o            → RouterTransport → ProviderTransport (API key)
```

Consumer uses single `RouterTransport`, model swap is just config change.

### Verification
- Can authenticate via OAuth flow
- Tokens persist and refresh automatically
- Model swap works without transport reconfiguration
- Streaming works with reasoning summaries

## What We're NOT Doing

- Full opencode plugin compatibility (different SDK)
- Browser OAuth popup (CLI flow with local server)
- Multiple ChatGPT accounts
- Codex system instructions fetching from GitHub (use static)

## Implementation Approach

1. Add `CodexTransport` as new transport (Option 1 from discussion)
2. Add `RouterTransport` thin wrapper for automatic dispatch
3. Add codex models to registry
4. Extract reusable auth/transform logic from reference plugin

---

## Phase 1: Token Management

### Overview
Create token storage and OAuth refresh utilities.

### Changes Required:

#### 1. Token Types and Storage
**File**: `packages/agent/src/transports/codex/types.ts` (new)

```typescript
export interface CodexTokens {
  access: string;
  refresh: string;
  expires: number; // Unix timestamp ms
}

export interface CodexAuthState {
  tokens: CodexTokens | null;
  accountId: string | null;
}
```

#### 2. OAuth Utilities
**File**: `packages/agent/src/transports/codex/auth.ts` (new)

Port from reference:
- `createAuthorizationFlow()` - PKCE + state generation
- `exchangeAuthorizationCode()` - code → tokens
- `refreshAccessToken()` - refresh → new tokens
- `decodeJWT()` - extract account ID
- `shouldRefreshToken()` - check expiry (5min buffer)

Constants:
```typescript
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const TOKEN_URL = "https://auth.openai.com/oauth/token";
export const REDIRECT_URI = "http://localhost:1455/auth/callback";
```

#### 3. Local OAuth Server
**File**: `packages/agent/src/transports/codex/oauth-server.ts` (new)

Port `startLocalOAuthServer()` - listens on 1455, waits for callback.

### Success Criteria:

#### Automated Verification:
- [ ] Types compile: `npm run typecheck`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] OAuth flow test: can get tokens via browser auth

---

## Phase 2: Request Transformation

### Overview
Transform requests for Codex backend compatibility.

### Changes Required:

#### 1. Request Transformer
**File**: `packages/agent/src/transports/codex/request-transformer.ts` (new)

Port from reference:
- `normalizeModel()` - map model names to API names
- `filterInput()` - remove `item_reference`, strip IDs
- `getReasoningConfig()` - model-specific reasoning defaults
- `transformRequestBody()` - full transformation

Key transformations:
```typescript
body.store = false;
body.stream = true;
body.include = ["reasoning.encrypted_content"];
// Filter orphaned function_call_output items
// Add developer message for tools
```

#### 2. Model Map
**File**: `packages/agent/src/transports/codex/model-map.ts` (new)

```typescript
export const CODEX_MODEL_MAP: Record<string, string> = {
  "gpt-5.1-codex-max": "gpt-5.1-codex-max",
  "gpt-5.1-codex-max-xhigh": "gpt-5.1-codex-max",
  "gpt-5.2": "gpt-5.2",
  "gpt-5.2-xhigh": "gpt-5.2",
  "gpt-5.1-codex": "gpt-5.1-codex",
  "gpt-5.1-codex-mini": "gpt-5.1-codex-mini",
  // ... etc
};
```

### Success Criteria:

#### Automated Verification:
- [ ] Unit tests pass for transformer: `npm test -- request-transformer`
- [ ] Types compile: `npm run typecheck`

#### Manual Verification:
- [ ] Transformed request matches expected format (manual inspection)

---

## Phase 3: CodexTransport

### Overview
Create transport that handles OAuth and request transformation.

### Changes Required:

#### 1. CodexTransport Class
**File**: `packages/agent/src/transports/CodexTransport.ts` (new)

```typescript
export interface CodexTransportOptions {
  getTokens: () => Promise<CodexTokens | null>;
  setTokens: (tokens: CodexTokens) => Promise<void>;
  clearTokens: () => Promise<void>;
}

export class CodexTransport implements AgentTransport {
  // Manages token refresh
  // Transforms requests via request-transformer
  // Uses openai-responses streaming with custom fetch
}
```

Key implementation:
- Wrap `streamOpenAIResponses` with custom client/params
- Inject OAuth headers: `Authorization: Bearer {access}`
- Add `openai-organization`, `openai-sentinel-chat-requirements-token` headers
- Handle 401 → refresh → retry

#### 2. Custom Fetch for Codex
**File**: `packages/agent/src/transports/codex/fetch.ts` (new)

```typescript
export function createCodexFetch(
  getAccessToken: () => Promise<string>,
  accountId: string
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${await getAccessToken()}`);
    headers.set("openai-sentinel-chat-requirements-token", accountId);
    // ... transform body
    return fetch(input, { ...init, headers });
  };
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Types compile: `npm run typecheck`
- [ ] Build succeeds: `npm run build`
- [ ] Transport instantiates without error

#### Manual Verification:
- [ ] Can make authenticated request to Codex API
- [ ] Streaming response works
- [ ] Token refresh works when expired

---

## Phase 4: RouterTransport

### Overview
Thin wrapper that routes to correct transport based on model.provider.

### Changes Required:

#### 1. RouterTransport Class
**File**: `packages/agent/src/transports/RouterTransport.ts` (new)

```typescript
export interface RouterTransportOptions {
  codex?: CodexTransport;
  provider: ProviderTransport;
}

export class RouterTransport implements AgentTransport {
  async *run(messages, userMessage, cfg, signal) {
    const transport = cfg.model.provider === "codex"
      ? this.codexTransport
      : this.providerTransport;
    
    if (!transport) {
      throw new Error(`No transport for provider: ${cfg.model.provider}`);
    }
    
    yield* transport.run(messages, userMessage, cfg, signal);
  }
  
  async *continue(messages, cfg, signal) {
    // Same routing logic
  }
}
```

#### 2. Export from index
**File**: `packages/agent/src/transports/index.ts`

Add:
```typescript
export { RouterTransport, type RouterTransportOptions } from "./RouterTransport.js";
export { CodexTransport, type CodexTransportOptions } from "./CodexTransport.js";
```

### Success Criteria:

#### Automated Verification:
- [ ] Types compile: `npm run typecheck`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Router dispatches to CodexTransport for codex provider
- [ ] Router dispatches to ProviderTransport for other providers
- [ ] Model swap mid-session works

---

## Phase 5: Codex Models in Registry

### Overview
Add codex models to generated models file.

### Changes Required:

#### 1. Update Model Generation Script
**File**: `packages/ai/scripts/generate-models.ts`

Add codex provider section:
```typescript
const CODEX_MODELS = {
  "gpt-5.1-codex-max": {
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    api: "openai-responses",
    provider: "codex",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // Free with subscription
    contextWindow: 200000,
    maxTokens: 32000,
  },
  "gpt-5.2": { /* ... */ },
  "gpt-5.1-codex": { /* ... */ },
  "gpt-5.1-codex-mini": { /* ... */ },
};
```

#### 2. Regenerate Models
```bash
npm run generate-models
```

### Success Criteria:

#### Automated Verification:
- [ ] `npm run generate-models` succeeds
- [ ] `getModel("codex", "gpt-5.1-codex-max")` returns valid model
- [ ] Types compile: `npm run typecheck`

#### Manual Verification:
- [ ] Models appear in model selection UI/CLI

---

## Testing Strategy

### Unit Tests:
- Token refresh logic (mock fetch)
- Request transformer (input/output snapshots)
- Model normalization
- Router dispatch logic

### Integration Tests:
- Full OAuth flow (requires manual browser step)
- Streaming with mocked Codex responses
- Token refresh mid-conversation

### Manual Testing Steps:
1. Run OAuth flow: should open browser, get tokens
2. Send message with codex model: should stream response
3. Wait for token expiry (or mock), send message: should auto-refresh
4. Swap to anthropic model mid-conversation: should use ProviderTransport
5. Swap back to codex: should resume with existing tokens

## Performance Considerations

- Token refresh adds latency on first request after expiry
- Consider pre-emptive refresh (refresh when <5min remaining)
- Request transformation is sync, minimal overhead

## Migration Notes

- Existing consumers using `ProviderTransport` directly can continue unchanged
- New consumers should use `RouterTransport` for multi-provider support
- Tokens stored in consumer's persistence layer (not managed by transport)

## References

- Reference plugin: `/Users/yesh/Documents/personal/reference/opencode-openai-codex-auth`
- OAuth constants: `lib/auth/auth.ts`
- Request transform: `lib/request/request-transformer.ts`
- Model map: `lib/request/helpers/model-map.ts`

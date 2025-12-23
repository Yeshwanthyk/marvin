# Codex Transport

Access OpenAI models via ChatGPT subscription (OAuth-based, no API key needed).

## Authentication

### First-time Setup

```bash
# Run auth flow (opens browser for ChatGPT login)
bun run packages/agent/src/codex-auth-cli.ts
```

This will:
1. Start local OAuth server on `localhost:1455`
2. Open browser to OpenAI auth page
3. After login, tokens are saved to `~/.config/marvin/codex-tokens.json`

### Token Storage

- **Location**: `~/.config/marvin/codex-tokens.json`
- **Contents**: `{ access, refresh, expires }`
- **Permissions**: File is created with `0600` (owner read/write only)
- **Refresh**: Automatic when token expires (uses refresh token)

### Re-authentication

Delete tokens and re-run auth:
```bash
rm ~/.config/marvin/codex-tokens.json
bun run packages/agent/src/codex-auth-cli.ts
```

## Adding New Models

When OpenAI releases new Codex models, update these files:

### 1. `packages/ai/src/models.generated.ts`

Add entry under `"codex"` provider:

```ts
"codex": {
    // ... existing models ...
    "gpt-X.Y-codex": {
        id: "gpt-X.Y-codex",
        name: "GPT-X.Y Codex",
        api: "openai-responses",
        provider: "codex",
        baseUrl: "https://chatgpt.com/backend-api",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 32000,
    } satisfies Model<"openai-responses">,
}
```

### 2. `packages/agent/src/transports/codex/model-map.ts`

Add normalization entries (maps variants to API model ID):

```ts
export const MODEL_MAP: Record<string, string> = {
    // ... existing ...
    
    // GPT-X.Y Codex
    "gpt-X.Y-codex": "gpt-X.Y-codex",
    "gpt-X.Y-codex-xhigh": "gpt-X.Y-codex",
    "gpt-X.Y-codex-high": "gpt-X.Y-codex",
    "gpt-X.Y-codex-medium": "gpt-X.Y-codex",
    "gpt-X.Y-codex-low": "gpt-X.Y-codex",
};
```

### 3. `packages/agent/src/transports/codex/instructions.ts`

If model needs different prompt file, update:

```ts
type ModelFamily = "gpt-5.2-codex" | "gpt-5.2" | "gpt-X.Y-codex";  // Add new family

const PROMPT_FILES: Record<ModelFamily, string> = {
    // ... existing ...
    "gpt-X.Y-codex": "gpt-X.Y-codex_prompt.md",  // Check openai/codex repo for filename
};

function getModelFamily(model: string): ModelFamily {
    const normalized = model.toLowerCase();
    // Add check BEFORE less specific patterns
    if (normalized.includes("gpt-X.Y-codex")) return "gpt-X.Y-codex";
    // ... rest ...
}
```

### 4. Rebuild

```bash
cd apps/coding-agent && bun run build
```

## Reference: opencode-openai-codex-auth

Upstream reference for Codex API patterns:
- Repo: `~/Documents/personal/reference/opencode-openai-codex-auth`
- Key files:
  - `lib/request/helpers/model-map.ts` — model ID mappings
  - `lib/request/request-transformer.ts` — reasoning config per model family
  - `lib/prompts/codex.ts` — prompt file selection

Check commits for new model support:
```bash
cd ~/Documents/personal/reference/opencode-openai-codex-auth
git log --oneline --grep="codex" | head -10
```

## Architecture

```
CodexTransport
├── auth.ts          — OAuth PKCE flow, token refresh
├── oauth-server.ts  — Local callback server (port 1455)
├── fetch.ts         — Custom fetch with auth headers, URL rewriting
├── instructions.ts  — Fetches prompt from github.com/openai/codex
├── model-map.ts     — Normalizes model variants to API IDs
├── request-transformer.ts — Body transforms (store=false, etc.)
├── constants.ts     — URLs, headers
└── types.ts         — Token types, auth types
```

## Model Capabilities

| Model | Reasoning | xhigh | "none" | Notes |
|-------|-----------|-------|--------|-------|
| gpt-5.2-codex | ✓ | ✓ | ✗ | Newest codex model |
| gpt-5.2 | ✓ | ✓ | ✓ | General purpose |
| gpt-5.2-mini | ✓ | ✗ | ✗ | Lightweight |

- **xhigh**: Extended reasoning effort
- **"none"**: Disable reasoning (only general-purpose models)

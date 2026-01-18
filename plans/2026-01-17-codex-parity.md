# Codex Harness & Transport Parity Plan

## Plan Metadata
- Created: 2026-01-17
- Status: draft
- Owner: yesh
- Ticket: n/a
- Assumptions:
  - Reference repos `~/Documents/personal/reference/pi-mono` and `~/Documents/personal/reference/opencode` remain stable for parity checks.
  - No production Codex traffic yet, so temporary outages during refactor are acceptable inside dev builds.

## Progress Tracking
- [ ] Phase 1: Harness Prompt & Instruction Source
- [ ] Phase 2: Session ID Plumbing & API Surface
- [ ] Phase 3: Codex Request & Header Parity
- [ ] Phase 4: Model Access Control, Auth UX, Verification

## Overview
Bring Marvin’s Codex harness (system prompt generation and runtime glue) plus `CodexTransport` behavior to parity with the proven implementations in `pi-mono` and `opencode`, focusing on deterministic instructions, session-based caching, and compliant request/authorization handling.

## Current State
- `apps/coding-agent/src/config.ts:193-218` stitches a single hard-coded prompt with optional AGENTS content; Codex-specific guidance is lazily downloaded by `packages/agent/src/transports/codex/instructions.ts`.
- `AgentRunConfig` lacks `sessionId`, so `HookedTransport` cannot forward `sessionManager.sessionId` to transports, and Codex never sets `prompt_cache_key` or `session_id` headers.
- `packages/agent/src/transports/codex/fetch.ts` only forces `store=false`, `stream=true`, strips `item_reference`, and adds partial headers. No reasoning clamp, tool routing, or `text.verbosity`.
- `codex/model-map.ts` normalizes only `gpt-5.2*` variants; OAuth flow allows any OpenAI model and meters them at standard costs, unlike opencode’s filtered, zero-cost list.

### Key Discoveries
- Opencode sources instructions directly from harness prompt files (`packages/opencode/src/session/system.ts:16-76`) rather than per-request fetches—approach avoids network flakiness.
- Pi’s agent natively supports `sessionId`, and Codex provider injects both `prompt_cache_key` and `session_id` headers (`packages/ai/src/providers/openai-codex-responses.ts:219-232`, `687-699`).
- Authorization plugin filters models and zeroes pricing for Codex OAuth tokens (`packages/opencode/src/plugin/codex.ts:356-372`) to match ChatGPT licensing; Marvin currently exposes all OpenAI SKUs via OAuth.

## Desired End State
- Harness builds a deterministic Codex prompt entirely within Marvin (AGENTS + skills + environment), and transports reuse it without GitHub fetches.
- Session IDs flow from `SessionManager` → `HookedTransport` → transports → Codex HTTP payloads/headers enabling prompt caching.
- `createCodexFetch` mirrors opencode/pi request transforms (tool_choice, reasoning clamp, `text.verbosity`, headers, model normalization) and supports direct-call config for compaction.
- OAuth flow exposes only supported Codex models, zeros costs, and refreshes tokens transparently, aligning with opencode’s experience.

### Verification
- Automated: `bun run typecheck`, `bun run test`, plus new unit tests under `packages/agent`/`apps/coding-agent` verifying session ID propagation and request shaping.
- Manual: run Marvin with Codex OAuth account, observe session headers via proxy (or verbose logging), ensure `/compact` works offline, and verify only Codex models appear in picker.

## Out of Scope
- Non-Codex provider improvements (Anthropic, Gemini, etc.).
- Deep rewrite of agent-loop beyond session ID wiring.
- UI/UX enhancements beyond necessary toggles/error messages for Codex login.

## Breaking Changes
- `AgentRunConfig` gains `sessionId?: string`; transports and hook wrappers must be updated synchronously.
- `CodexTransport.getDirectCallConfig` signature will now return `sessionId`-aware config; ensure downstream callers expect the new property.

## Dependency and Configuration Changes

### Additions
*(none)*

### Updates
*(none)*

### Removals
*(none)*

### Configuration Changes
Potential addition of a `codex.allowNonOAuthModels` dev flag (default false) inside `apps/coding-agent/src/config.ts`. If introduced:

**File**: `apps/coding-agent/src/config.ts`

**Before**
```ts
export interface LoadedAppConfig {
  provider: ProviderId;
  // ...
}
```

**After**
```ts
export interface LoadedAppConfig {
  provider: ProviderId;
  codex?: {
    allowNonOAuthModels?: boolean;
  };
  // ...
}
```

**Impact**: developers can temporarily bypass model filtering; production configs must leave unset.

## Error Handling Strategy
- `createCodexFetch` should surface descriptive errors when token refresh fails or account ID extraction fails (propagate `Token refresh failed`), matching existing CLI behavior.
- Instructions loader failures fall back to cached prompt; if unavailable, throw explicit `Codex prompt unavailable` error to prevent silent malformed requests.
- Session ID absence defaults to no caching but should log once per session for observability.
- Model filtering errors (user selects unsupported model) should raise actionable message `"Model <id> requires API key or non-Codex provider"`.

## Implementation Approach
Apply changes in four phases: move instruction responsibility into harness, plumb session IDs across agent/transports, align Codex request headers/body with upstream references, and finally enforce OAuth model gating and verification. This sequencing isolates risk (prompt generation first, then contract changes, then API semantics) and mirrors pi/opencode structure for easier diffing.

## Phase Dependencies and Parallelization
- Phase 2 depends on Phase 1 (prompt changes inform what transports send).
- Phase 3 depends on Phase 2 (request shaping needs session IDs).
- Phase 4 depends on prior phases but can start documentation/testing work in parallel once session IDs flow.

---

## Phase 1: Harness Prompt & Instruction Source

### Overview
Replace the brittle `getCodexInstructions()` fetch with local prompt composition via the harness so Codex instructions are deterministic, cached with project context, and identical across transports and direct calls.

### Prerequisites
- [ ] Confirm `plans/` instructions accepted (this document).
- [ ] Inventory AGENTS/skills discovery logic (`apps/coding-agent/src/config.ts`, `apps/coding-agent/src/core/*`).

### Change Checklist
- [ ] Introduce shared system prompt builder module (adapted from pi’s `packages/coding-agent/src/core/system-prompt.ts`).
- [ ] Delete `packages/agent/src/transports/codex/instructions.ts` usage; fallback to harness-provided prompt.
- [ ] Ensure `/compact` path (`apps/coding-agent/src/compact-handler.ts`) passes current system prompt into `getDirectCallConfig`.

### Changes

#### 1. System Prompt Builder
**File**: `apps/coding-agent/src/config.ts`
**Location**: ~190

**Before**
```ts
const basePrompt =
  typeof rawObj.systemPrompt === 'string' && rawObj.systemPrompt.trim().length > 0
    ? rawObj.systemPrompt
    : 'You are a helpful coding agent...';
const systemPrompt = agentsConfig.combined
  ? `${basePrompt}\n\n${agentsConfig.combined}`
  : basePrompt;
```

**After**
```ts
import { buildSystemPrompt } from './core/system-prompt.js';
// ...
const systemPrompt = buildSystemPrompt({
  customPrompt: rawObj.systemPrompt,
  appendSystemPrompt: agentsConfig.combined,
  skillsSettings: resolveSkillsSettings(rawObj.skills),
  cwd: process.cwd(),
  agentDir: configDir,
});
```

**Why**: Align prompt construction with pi/opencode and eliminate downstream instruction fetching.

#### 2. Remove Codex Instruction Fetch
**File**: `packages/agent/src/transports/CodexTransport.ts`
**Location**: 71-105

**Before**
```ts
private async getInstructions(modelId: string): Promise<string> { ... }
const instructions = await this.getInstructions(cfg.model.id);
```

**After**
```ts
const instructions = cfg.systemPrompt;
```

**Why**: Use harness-provided prompt, ensuring consistency and removing GitHub dependency.

#### 3. Delete Instruction Cache Module
**File**: `packages/agent/src/transports/codex/instructions.ts`

**Action**: Remove file and exports, adjust barrel file.

### Edge Cases to Handle
- [ ] Missing custom prompt: builder must still produce base instructions.
- [ ] No skills directories: ensure builder handles empty arrays.
- [ ] Offline operation: eliminating network fetch removes prior failure mode.

### Success Criteria

**Automated**
```bash
bun run typecheck --filter apps/coding-agent
bun run test --filter apps/coding-agent
```

**Manual**
- [ ] Launch Marvin offline and ensure Codex prompts still include AGENTS instructions.

### Rollback
```bash
git restore apps/coding-agent/src/config.ts packages/agent/src/transports/CodexTransport.ts
git checkout HEAD -- packages/agent/src/transports/codex/instructions.ts
```

### Notes
- Consider extracting builder to `packages/agent` later for reuse.

---

## Phase 2: Session ID Plumbing & API Surface

### Overview
Expose `sessionId` through `AgentRunConfig`, transports, and Codex direct-call helpers so session-based caching (prompt cache key + headers) becomes possible.

### Prerequisites
- [ ] Phase 1 automated + manual checks pass.
- [ ] Catalog session manager entry points (`apps/coding-agent/src/core/session-manager.ts`, `apps/coding-agent/src/compact-handler.ts`).

### Change Checklist
- [ ] Add `sessionId?: string` to `AgentRunConfig` (`packages/agent/src/transports/types.ts`).
- [ ] Update `Agent` class to store session ID and expose getters/setters (patterned after `pi-mono/packages/agent/src/agent.ts:64-135`).
- [ ] Modify `HookedTransport` to forward session ID from `hooks.getSessionId()` into config.
- [ ] Pass session ID into `CodexTransport.getDirectCallConfig` and `agentLoop` calls.

### Changes

#### 1. Agent State
**File**: `packages/agent/src/agent.ts`
**Location**: constructor + class fields

**Before**
```ts
private queueMode: "all" | "one-at-a-time";
```

**After**
```ts
private _sessionId?: string;

get sessionId(): string | undefined { return this._sessionId; }
set sessionId(value: string | undefined) { this._sessionId = value; }
```

**Why**: Allow runtime to update session ID when switching branches.

#### 2. Run Config Interface
**File**: `packages/agent/src/transports/types.ts`

**Add**
```ts
sessionId?: string;
```

**Why**: Provide transports with session information.

#### 3. Hooked Transport
**File**: `apps/coding-agent/src/hooks/hook-transport.ts`

**Before**
```ts
const nextCfg = await this.hooks.applyRunConfig(cfg, sessionId);
```

**After**
```ts
const nextCfg = await this.hooks.applyRunConfig({ ...cfg, sessionId }, sessionId);
```

**Why**: Actually carry the ID through to transports.

#### 4. Session Manager Integration
**File**: `apps/coding-agent/src/core/agent-session.ts`

**Update**: After `this.sessionManager.newSession()`, set `this.agent.sessionId = this.sessionManager.getSessionId();` (mirroring pi).

### Edge Cases to Handle
- [ ] No session ID yet (cold start) → transports should handle undefined gracefully.
- [ ] Session restore from existing file ensures `sessionId` matches file header.
- [ ] Direct-call compaction uses same ID.

### Success Criteria

**Automated**
```bash
bun run typecheck
```

**Manual**
- [ ] Start Marvin, create new session, log `CodexTransport` config to confirm `sessionId` present.

### Rollback
```bash
git restore packages/agent/src/agent.ts packages/agent/src/transports/types.ts apps/coding-agent/src/hooks/hook-transport.ts apps/coding-agent/src/core/agent-session.ts
```

---

## Phase 3: Codex Request & Header Parity

### Overview
Align `createCodexFetch`, request bodies, and direct-call helpers with pi/opencode: add missing headers (`session_id`, `User-Agent`), enforce `tool_choice`, `parallel_tool_calls`, `text.verbosity`, `reasoning` clamping, and `prompt_cache_key`.

### Prerequisites
- [ ] Phase 2 automated checks pass; session IDs observable in configs.

### Change Checklist
- [ ] Update `createCodexFetch` to set headers (including `session_id` when config provides it), `tool_choice`, `parallel_tool_calls`, `text.verbosity`, `reasoning`.
- [ ] Ensure `CodexTransport.buildLoopConfig` sets `prompt_cache_key`/`sessionId` in agent loop options.
- [ ] Normalize model IDs using extended map covering `gpt-5.1*`.
- [ ] Add unit tests for request transformation.

### Changes

#### 1. Fetch Header Updates
**File**: `packages/agent/src/transports/codex/fetch.ts`

**Before**
```ts
headers.set("Authorization", `Bearer ${tokens.access}`);
headers.set(OPENAI_HEADERS.ACCOUNT_ID, accountId);
headers.set(OPENAI_HEADERS.BETA, OPENAI_HEADER_VALUES.BETA_RESPONSES);
headers.set(OPENAI_HEADERS.ORIGINATOR, OPENAI_HEADER_VALUES.ORIGINATOR_CODEX);
headers.set("accept", "text/event-stream");
```

**After**
```ts
headers.set("authorization", `Bearer ${tokens.access}`);
headers.set("chatgpt-account-id", accountId);
headers.set("OpenAI-Beta", "responses=experimental");
headers.set("originator", "pi"); // match upstream
headers.set("User-Agent", buildUserAgent());
headers.set("accept", "text/event-stream");
headers.set("content-type", "application/json");
if (initSessionId) headers.set("session_id", initSessionId);
```

**Why**: parity with `packages/ai/src/providers/openai-codex-responses.ts:687-699`.

#### 2. Request Body Transformation
**File**: `packages/agent/src/transports/codex/request-transformer.ts`

**Before**
```ts
return {
  ...body,
  model,
  store: false,
  stream: true,
  instructions,
  input: body.input ? filterInput(body.input) : undefined,
  reasoning: { effort: reasoning ?? "medium", summary: "auto" },
  text: { verbosity: "medium" },
  include: ["reasoning.encrypted_content"],
  max_output_tokens: undefined,
  max_completion_tokens: undefined,
};
```

**After**
```ts
return {
  ...body,
  model,
  store: false,
  stream: true,
  instructions,
  input: body.input ? filterInput(body.input) : undefined,
  tool_choice: "auto",
  parallel_tool_calls: true,
  reasoning: buildReasoningBlock(model, reasoning),
  text: { verbosity: body.text?.verbosity ?? "medium" },
  include: ["reasoning.encrypted_content"],
  prompt_cache_key: body.prompt_cache_key,
  max_output_tokens: undefined,
  max_completion_tokens: undefined,
};
```

**Why**: replicate opencode/pi semantics.

#### 3. Direct Call Config
**File**: `apps/coding-agent/src/compact-handler.ts`

**Change**: When building `direct`, include `sessionId: sessionManager.getSessionId()` and pass into `codexTransport.getDirectCallConfig`.

### Edge Cases to Handle
- [ ] `reasoning="none"` for general GPT-5.2 should omit `reasoning` block.
- [ ] Tools absent: still set `tool_choice` but omit `tools` array.
- [ ] When no session ID, skip header but log once.

### Success Criteria

**Automated**
```bash
bun run test packages/agent/src/transports/codex/request-transformer.test.ts
```

**Manual**
- [ ] Capture network traffic to confirm `session_id` header present and `tool_choice` auto set.

### Rollback
```bash
git restore packages/agent/src/transports/codex/*
```

---

## Phase 4: Model Access Control, Auth UX, Verification

### Overview
Filter OAuth Codex models, zero out their cost, enhance error handling, and document/testing to ensure parity with opencode.

### Prerequisites
- [ ] Phases 1-3 complete and tests green.

### Change Checklist
- [ ] Update `apps/coding-agent/src/runtime/transport/index.ts` to restrict Codex models when OAuth credentials used (allowed set: `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5.2`, `gpt-5.2-codex`).
- [ ] Adjust pricing metadata (likely `packages/ai/src/models.*` or runtime model registry) to set input/output/cache costs to 0 when provider `codex` + OAuth tokens.
- [ ] Improve `codex-auth-cli.ts` messaging for refresh failures and ensure `ChatGPT-Account-Id` stored (for multi-org).
- [ ] Update documentation/CHANGELOG and add integration smoke test.

### Changes

#### 1. Model Filtering
**File**: `apps/coding-agent/src/runtime/transport/index.ts`

**Add**
```ts
const ALLOWED_CODEX_MODELS = new Set(["gpt-5.1-codex-max","gpt-5.1-codex-mini","gpt-5.2","gpt-5.2-codex"]);
```
Before returning transport bundle, prune `config.model` if not allowed when `codex` provider selected with OAuth tokens; prompt user to switch to API-key provider.

#### 2. Pricing Adjustments
**File**: `apps/coding-agent/src/core/model-registry.ts`

**Before**
```ts
cost: { input: 0.01, output: 0.03 }
```

**After**
```ts
cost: isCodexOAuth ? { input: 0, output: 0, cache: { read: 0, write: 0 } } : existingCost;
```

**Why**: Match subscription licensing.

#### 3. Auth Messaging
**File**: `packages/agent/src/codex-auth-cli.ts`

**Change**: When `extractAccountId` fails, prompt user to rerun login; log instructions similar to opencode plugin.

### Edge Cases to Handle
- [ ] Users with API keys should still access other OpenAI models.
- [ ] Allow dev override flag for testing (document).
- [ ] Token refresh failure should clear tokens and instruct re-login.

### Success Criteria

**Automated**
```bash
bun run test --filter codex
```

**Manual**
- [ ] Login via OAuth, ensure model picker only shows allowed list.
- [ ] Run `/login openai-codex`, verify costs show $0, run sample prompt.

### Rollback
```bash
git restore apps/coding-agent/src/runtime/transport/index.ts apps/coding-agent/src/core/model-registry.ts packages/agent/src/codex-auth-cli.ts
```

---

## Testing Strategy

### Unit Tests to Add/Modify
- `packages/agent/src/transports/codex/request-transformer.test.ts`: cover reasoning clamp, tool_choice injection, prompt_cache_key propagation.
- `packages/agent/src/agent.test.ts`: ensure `sessionId` setter/getter works and forwarded into transports.
- `apps/coding-agent/src/core/config.test.ts`: assert `buildSystemPrompt` merges AGENTS + skills.

### Integration Tests
- Add Codex OAuth smoke test under `apps/coding-agent/tests/codex-oauth.test.ts` that simulates `CodexTransport` run with mocked fetch, verifying headers/body.
- Extend `/compact` integration test to ensure direct-call config uses session ID.

### Manual Testing Checklist
1. [ ] Login with Codex OAuth, run simple command, confirm REPL output includes AGENTS instructions (use `--debug-prompt` flag if available).
2. [ ] Trigger `/compact` while offline; ensure prompt fetch not attempted.
3. [ ] Observe network headers with `MITM_PROXY=1 bun run marvin` to check `session_id`.
4. [ ] Attempt to select unsupported OpenAI model under OAuth; expect explicit error.

## Deployment Instructions

### Feature Flags
- Optional `codex.allowNonOAuthModels` for dev only. Default false in production config.
- Rollout: enable flag only for QA if necessary; remove once confident.

### Environment Variables
*(none new)* — ensure documentation notes ChatGPT Plus/Pro requirement.

### Deployment Order
1. Merge harness/transport changes.
2. Release updated packages (`bun run build` for apps/coding-agent).
3. Publish documentation/CHANGELOG.

## Anti-Patterns to Avoid
- Copying prompts directly from pi without tailoring to Marvin-specific tools (ensure builder describes Marvin toolset).
- Introducing silent fallbacks (e.g., defaulting to general GPT-5) when user selects unsupported model—always fail loudly.

## Open Questions
- [x] Should `originator` header be `pi` or `codex_cli_rs`? → Answer: match opencode/pi value `pi` for consistent allowlisting.
- [x] Do we need to cache prompts per model family beyond harness prompt? → Answer: no; harness prompt already encapsulates context, removing need for GitHub fetch.

## References
- pi-mono Codex provider: `~/Documents/personal/reference/pi-mono/packages/ai/src/providers/openai-codex-responses.ts`
- opencode Codex plugin: `~/Documents/personal/reference/opencode/packages/opencode/src/plugin/codex.ts`
- Marvin current transport: `packages/agent/src/transports/CodexTransport.ts`

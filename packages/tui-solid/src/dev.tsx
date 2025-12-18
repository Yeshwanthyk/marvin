/**
 * Development runner for testing the TUI
 *
 * Run with: bun run src/dev.tsx
 */
import { Agent, ProviderTransport } from "@mu-agents/agent-core"
import { getApiKey, getModel, getProviders, getModels, type KnownProvider } from "@mu-agents/ai"
import { runTui } from "./app.js"

// Get provider/model from env or defaults
const providerStr = process.env.MU_PROVIDER || "anthropic"
const modelName = process.env.MU_MODEL || "claude-opus-4-5"

// Validate provider
const providers = getProviders()
if (!(providers as string[]).includes(providerStr)) {
  console.error(`Invalid provider: ${providerStr}. Available: ${providers.join(", ")}`)
  process.exit(1)
}
const provider = providerStr as KnownProvider

// Get model - use any to work around strict typing
const model = (getModel as any)(provider, modelName)
if (!model) {
  const available = getModels(provider).map(m => m.name).join(", ")
  console.error(`Invalid model: ${modelName}. Available for ${provider}: ${available}`)
  process.exit(1)
}

// Custom API key getter that supports ANTHROPIC_OAUTH_TOKEN
const getApiKeyForProvider = (p: string): string | undefined => {
  if (p === "anthropic") {
    return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey("anthropic")
  }
  return getApiKey(p as KnownProvider)
}

const transport = new ProviderTransport({ getApiKey: getApiKeyForProvider })

const agent = new Agent({
  transport,
  initialState: {
    systemPrompt: "You are a helpful coding assistant.",
    model,
    thinkingLevel: "off",
    tools: [],
  },
})

runTui({ agent }).catch(console.error)

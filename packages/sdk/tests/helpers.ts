import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { getModels, type AssistantMessage, type Message, type ToolResultMessage, type Usage } from "@marvin-agents/ai"
import { CodexTransport, ProviderTransport, RouterTransport, type AgentRunConfig } from "@marvin-agents/agent-core"
import type { AgentEvent } from "@marvin-agents/agent-core"
import type { LoadedAppConfig } from "@marvin-agents/runtime-effect/config.js"
import type { ApiKeyResolver, TransportBundle } from "@marvin-agents/runtime-effect/transports.js"

export interface TempConfig {
  dir: string
  configPath: string
  cleanup: () => Promise<void>
}

export const createTempConfig = async (): Promise<TempConfig> => {
  const dir = await mkdtemp(path.join(tmpdir(), "marvin-sdk-test-"))
  const models = getModels("anthropic")
  if (models.length === 0) {
    throw new Error("No anthropic models available for tests")
  }
  const model = models[0]
  const configPath = path.join(dir, "config.json")

  await writeFile(
    configPath,
    JSON.stringify(
      {
        provider: "anthropic",
        model: model.id,
        thinking: "off",
        lsp: { enabled: false, autoInstall: false },
      },
      null,
      2,
    ),
    "utf8",
  )

  return {
    dir,
    configPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const defaultUsage: Usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

const buildAssistantMessage = (cfg: AgentRunConfig, text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: cfg.model.api,
  provider: cfg.model.provider,
  model: cfg.model.id,
  usage: defaultUsage,
  stopReason: "stop",
  timestamp: Date.now(),
})

const buildEventSequence = (
  messages: Message[],
  userMessage: Message | null,
  cfg: AgentRunConfig,
  text: string,
): AgentEvent[] => {
  const assistant = buildAssistantMessage(cfg, text)
  const toolResults: ToolResultMessage[] = []
  const combined: Message[] = userMessage ? [...messages, userMessage, assistant] : [...messages, assistant]
  return [
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: assistant },
    { type: "message_end", message: assistant },
    { type: "turn_end", message: assistant, toolResults },
    { type: "agent_end", messages: combined },
  ]
}

const emitEvents = async function* (
  messages: Message[],
  userMessage: Message | null,
  cfg: AgentRunConfig,
  text: string,
): AsyncIterable<AgentEvent> {
  for (const event of buildEventSequence(messages, userMessage, cfg, text)) {
    yield event
  }
}

const createResponsePicker = (responses: string[]) => {
  const fallback = responses.length > 0 ? responses[responses.length - 1] : ""
  let index = 0
  return () => {
    const response = responses[index] ?? fallback
    index += 1
    return response
  }
}

class MockProviderTransport extends ProviderTransport {
  private nextResponse: () => string

  constructor(nextResponse: () => string) {
    super({ getApiKey: () => "test" })
    this.nextResponse = nextResponse
  }

  async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig): AsyncIterable<AgentEvent> {
    const text = this.nextResponse()
    yield* emitEvents(messages, userMessage, cfg, text)
  }

  async *continue(messages: Message[], cfg: AgentRunConfig): AsyncIterable<AgentEvent> {
    const text = this.nextResponse()
    yield* emitEvents(messages, null, cfg, text)
  }
}

class MockCodexTransport extends CodexTransport {
  private nextResponse: () => string

  constructor(nextResponse: () => string) {
    super({
      getTokens: async () => null,
      setTokens: async () => {},
      clearTokens: async () => {},
    })
    this.nextResponse = nextResponse
  }

  async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig): AsyncIterable<AgentEvent> {
    const text = this.nextResponse()
    yield* emitEvents(messages, userMessage, cfg, text)
  }

  async *continue(messages: Message[], cfg: AgentRunConfig): AsyncIterable<AgentEvent> {
    const text = this.nextResponse()
    yield* emitEvents(messages, null, cfg, text)
  }
}

export const createMockTransportFactory = (responses: string[]) => {
  return (_config: LoadedAppConfig, _resolver: ApiKeyResolver): TransportBundle => {
    const nextResponse = createResponsePicker(responses)
    const provider = new MockProviderTransport(nextResponse)
    const codex = new MockCodexTransport(nextResponse)
    const router = new RouterTransport({ provider, codex })
    return { provider, codex, router }
  }
}

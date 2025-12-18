import { Agent, ProviderTransport, type AgentEvent } from "@mu-agents/agent-core"
import { getApiKey, getModels, getProviders, type Api, type KnownProvider, type Model } from "@mu-agents/ai"
import { codingTools } from "@mu-agents/base-tools"
import type { ThinkingLevel } from "@mu-agents/agent-core"
import { runTui as runSolidTui, type SlashCommand } from "@mu-agents/tui-solid"
import { loadAppConfig, updateAppConfig } from "./config.js"
import { SessionManager } from "./session-manager.js"
import * as readline from "node:readline/promises"

const resolveProvider = (raw: string): KnownProvider | undefined => {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const providers = getProviders()
  return providers.includes(trimmed as KnownProvider) ? (trimmed as KnownProvider) : undefined
}

const resolveModel = (provider: KnownProvider, raw: string): Model<Api> | undefined => {
  const modelId = raw.trim()
  if (!modelId) return undefined
  return getModels(provider).find((m) => m.id === modelId) as Model<Api> | undefined
}

const chooseSessionPath = async (sessionManager: SessionManager): Promise<string | null> => {
  const sessions = sessionManager.listSessions()
  if (sessions.length === 0) return null

  if (!process.stdin.isTTY) return sessions[0]!.path

  process.stdout.write("\nRecent sessions:\n")
  sessions.slice(0, 10).forEach((s, i) => {
    const when = new Date(s.timestamp).toLocaleString()
    process.stdout.write(`  ${i + 1}) ${when}  ${s.provider} ${s.modelId}\n`)
  })

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question("Select session (1-10) or empty to cancel: ")).trim()
    if (!answer) return null
    const idx = Number(answer)
    if (!Number.isFinite(idx) || idx < 1 || idx > Math.min(10, sessions.length)) return null
    return sessions[idx - 1]!.path
  } finally {
    rl.close()
  }
}

export const runTui = async (args?: {
  configDir?: string
  configPath?: string
  provider?: string
  model?: string
  thinking?: ThinkingLevel
  continueSession?: boolean
  resumeSession?: boolean
}) => {
  const loaded = await loadAppConfig({
    configDir: args?.configDir,
    configPath: args?.configPath,
    provider: args?.provider,
    model: args?.model,
    thinking: args?.thinking,
  })

  let currentProvider = loaded.provider
  let currentModelId = loaded.modelId
  let currentThinking = loaded.thinking

  const getApiKeyForProvider = (provider: string): string | undefined => {
    if (provider === "anthropic") {
      return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider)
    }
    return getApiKey(provider)
  }

  const transport = new ProviderTransport({ getApiKey: getApiKeyForProvider })
  const agent = new Agent({
    transport,
    initialState: {
      systemPrompt: loaded.systemPrompt,
      model: loaded.model,
      thinkingLevel: loaded.thinking,
      tools: codingTools,
    },
  })

  // Session persistence
  const sessionManager = new SessionManager(loaded.configDir)
  let sessionStarted = false
  const ensureSession = () => {
    if (sessionStarted) return
    sessionManager.startSession(currentProvider, currentModelId, currentThinking)
    sessionStarted = true
  }

  // Restore a session if requested (before UI starts so it can seed initial messages)
  const restoreFromPath = (sessionPath: string) => {
    const loadedSession = sessionManager.loadSession(sessionPath)
    if (!loadedSession) return
    sessionManager.continueSession(sessionPath, loadedSession.metadata.id)
    sessionStarted = true

    const provider = resolveProvider(loadedSession.metadata.provider) ?? currentProvider
    const model = resolveModel(provider, loadedSession.metadata.modelId)
    const thinking = loadedSession.metadata.thinkingLevel

    currentProvider = provider
    if (model) {
      currentModelId = model.id
      agent.setModel(model)
    }
    currentThinking = thinking
    agent.setThinkingLevel(thinking)
    agent.replaceMessages(loadedSession.messages)
  }

  if (args?.resumeSession) {
    const chosen = await chooseSessionPath(sessionManager)
    if (chosen) restoreFromPath(chosen)
  } else if (args?.continueSession) {
    const latest = sessionManager.listSessions()[0]?.path
    if (latest) restoreFromPath(latest)
  }

  // Persist generated messages
  agent.subscribe((event: AgentEvent) => {
    if (event.type !== "message_end") return
    ensureSession()
    sessionManager.appendMessage(event.message)
  })

  const commands: SlashCommand[] = [
    {
      name: "model",
      description: "Set model: /model <provider> <modelId> (or /model <modelId>)",
      onSelect: async (argText?: string) => {
        const text = (argText ?? "").trim()
        if (!text) return

        const parts = text.split(/\s+/).filter(Boolean)
        let provider: KnownProvider = currentProvider
        let modelId = ""

        if (parts.length === 1) {
          modelId = parts[0]!
        } else {
          const p = resolveProvider(parts[0]!)
          if (!p) return
          provider = p
          modelId = parts[1]!
        }

        const model = resolveModel(provider, modelId)
        if (!model) return

        currentProvider = provider
        currentModelId = model.id
        agent.setModel(model)

        await updateAppConfig(
          { configDir: loaded.configDir, configPath: loaded.configPath },
          { provider, model: model.id }
        )
      },
    },
    {
      name: "thinking",
      description: "Set thinking: /thinking off|minimal|low|medium|high|xhigh",
      onSelect: async (argText?: string) => {
        const level = (argText ?? "").trim() as ThinkingLevel
        if (
          level !== "off" &&
          level !== "minimal" &&
          level !== "low" &&
          level !== "medium" &&
          level !== "high" &&
          level !== "xhigh"
        ) {
          return
        }

        currentThinking = level
        agent.setThinkingLevel(level)
        await updateAppConfig(
          { configDir: loaded.configDir, configPath: loaded.configPath },
          { thinking: level }
        )
      },
    },
  ]

  await runSolidTui({
    agent,
    configDir: loaded.configDir,
    model: loaded.model,
    thinking: loaded.thinking,
    models: getModels(currentProvider) as Model<Api>[],
    commands,
  })
}

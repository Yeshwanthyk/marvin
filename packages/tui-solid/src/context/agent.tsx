import { createContext, useContext, onCleanup, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Agent, AgentEvent, AppMessage, ThinkingLevel } from "@mu-agents/agent-core"
import type { AssistantMessage, Model, Api } from "@mu-agents/ai"

export interface ToolBlock {
  id: string
  name: string
  args: Record<string, unknown>
  status: "pending" | "success" | "error"
  output?: string
  isError: boolean
}

export interface MessageItem {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
  usage?: AssistantMessage["usage"]
}

interface AgentState {
  responding: boolean
  messages: MessageItem[]
  toolBlocks: ToolBlock[]
  queuedMessages: string[]
  currentAssistantContent: string
  model: Model<Api> | null
  thinking: ThinkingLevel
  totalUsage: {
    input: number
    output: number
    cacheRead: number
    cost: number
    lastContext: number
  }
  retryStatus: string | null
}

interface AgentContextValue {
  state: AgentState
  agent: Agent
  prompt: (text: string) => Promise<void>
  queue: (text: string) => void
  abort: () => void
  clear: () => void
  setModel: (model: Model<Api>) => void
  setThinking: (level: ThinkingLevel) => void
}

const AgentContext = createContext<AgentContextValue>()

let messageCounter = 0
const nextMessageId = () => `msg-${++messageCounter}`

function messageToItem(m: AppMessage): MessageItem | null {
  const role = (m as { role?: unknown }).role
  if (role !== "user" && role !== "assistant") return null

  const rawContent = (m as { content?: unknown }).content
  const timestamp =
    typeof (m as { timestamp?: unknown }).timestamp === "number"
      ? ((m as { timestamp: number }).timestamp as number)
      : Date.now()

  const content = typeof rawContent === "string" ? rawContent : textFromBlocks(rawContent)

  if (role === "assistant") {
    const usage = (m as Partial<AssistantMessage>).usage
    return {
      id: nextMessageId(),
      role: "assistant",
      content,
      timestamp,
      usage: usage as AssistantMessage["usage"] | undefined,
    }
  }

  return {
    id: nextMessageId(),
    role: "user",
    content,
    timestamp,
  }
}

function textFromBlocks(raw: unknown): string {
  if (!Array.isArray(raw)) return ""
  return raw
    .filter((b) => b && typeof b === "object" && (b as { type?: unknown }).type === "text")
    .map((b) => ((b as { text?: unknown }).text as string | undefined) ?? "")
    .join("")
}

export function AgentProvider(props: ParentProps<{ agent: Agent }>) {
  const initialMessages = props.agent.state.messages
    .map(messageToItem)
    .filter((x): x is MessageItem => x !== null)

  const initialUsage = initialMessages.reduce(
    (acc, item) => {
      if (!item.usage) return acc
      acc.input += item.usage.input
      acc.output += item.usage.output
      acc.cacheRead += item.usage.cacheRead
      acc.cost += item.usage.cost.total
      acc.lastContext =
        item.usage.input +
        item.usage.output +
        item.usage.cacheRead +
        (item.usage.cacheWrite || 0)
      return acc
    },
    { input: 0, output: 0, cacheRead: 0, cost: 0, lastContext: 0 }
  )

  const [state, setState] = createStore<AgentState>({
    responding: false,
    messages: initialMessages,
    toolBlocks: [],
    queuedMessages: [],
    currentAssistantContent: "",
    model: props.agent.state.model,
    thinking: props.agent.state.thinkingLevel,
    totalUsage: initialUsage,
    retryStatus: null,
  })

  // Subscribe to agent events
  const unsubscribe = props.agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
      case "turn_start":
        setState("responding", true)
        break

      case "message_start":
        if (event.message.role === "user") {
          // Handle queued message
          if (state.queuedMessages.length > 0) {
            setState(
              produce((s) => {
                s.queuedMessages.shift()
              })
            )
          }
          const content =
            typeof event.message.content === "string"
              ? event.message.content
              : textFromBlocks(event.message.content)
          setState(
            produce((s) => {
              s.messages.push({
                id: nextMessageId(),
                role: "user",
                content,
                timestamp: Date.now(),
              })
            })
          )
        }
        if (event.message.role === "assistant") {
          setState("currentAssistantContent", "")
        }
        break

      case "message_update":
        if (event.message.role === "assistant") {
          const content = textFromBlocks(event.message.content)
          setState("currentAssistantContent", content)
        }
        break

      case "message_end":
        if (event.message.role === "assistant") {
          const assistantMsg = event.message as AssistantMessage
          let content = textFromBlocks(assistantMsg.content)
          // Show error message if present and content is empty
          if (!content && assistantMsg.errorMessage) {
            content = `Error: ${assistantMsg.errorMessage}`
          }
          // Clear streaming content FIRST to avoid duplicate display
          setState("currentAssistantContent", "")
          setState(
            produce((s) => {
              s.messages.push({
                id: nextMessageId(),
                role: "assistant",
                content,
                timestamp: Date.now(),
                usage: assistantMsg.usage,
              })
              // Update usage totals
              s.totalUsage.input += assistantMsg.usage.input
              s.totalUsage.output += assistantMsg.usage.output
              s.totalUsage.cacheRead += assistantMsg.usage.cacheRead
              s.totalUsage.cost += assistantMsg.usage.cost.total
              s.totalUsage.lastContext =
                assistantMsg.usage.input +
                assistantMsg.usage.output +
                assistantMsg.usage.cacheRead +
                (assistantMsg.usage.cacheWrite || 0)
            })
          )
        }
        break

      case "tool_execution_start":
        setState(
          produce((s) => {
            s.toolBlocks.push({
              id: event.toolCallId,
              name: event.toolName,
              args: event.args,
              status: "pending",
              isError: false,
            })
          })
        )
        break

      case "tool_execution_update":
        setState(
          produce((s) => {
            const block = s.toolBlocks.find((b) => b.id === event.toolCallId)
            if (block) {
              block.output = getToolText(event.partialResult)
            }
          })
        )
        break

      case "tool_execution_end":
        setState(
          produce((s) => {
            const block = s.toolBlocks.find((b) => b.id === event.toolCallId)
            if (block) {
              block.status = event.isError ? "error" : "success"
              block.output = getToolText(event.result)
              block.isError = event.isError
            }
          })
        )
        break

      case "agent_end":
        setState("responding", false)
        setState("currentAssistantContent", "")
        break
    }
  })

  onCleanup(() => unsubscribe())

  const prompt = async (text: string) => {
    setState("responding", true)
    setState("toolBlocks", [])
    try {
      await props.agent.prompt(text)
    } catch (err) {
      setState(
        produce((s) => {
          s.messages.push({
            id: nextMessageId(),
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: Date.now(),
          })
        })
      )
    } finally {
      setState("responding", false)
    }
  }

  const queue = (text: string) => {
    setState("queuedMessages", (q) => [...q, text])
    const queuedUserMessage: AppMessage = {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    }
    props.agent.queueMessage(queuedUserMessage)
  }

  const abort = () => {
    props.agent.abort()
    props.agent.clearMessageQueue()
    setState("responding", false)
  }

  const clear = () => {
    props.agent.reset()
    setState(produce((s) => {
      s.responding = false
      s.messages.length = 0  // Mutate array in place
      s.toolBlocks.length = 0
      s.queuedMessages.length = 0
      s.currentAssistantContent = ""
      s.totalUsage = { input: 0, output: 0, cacheRead: 0, cost: 0, lastContext: 0 }
      s.retryStatus = null
    }))
  }

  const setModel = (model: Model<Api>) => {
    props.agent.setModel(model)
    setState("model", model)
  }

  const setThinking = (level: ThinkingLevel) => {
    props.agent.setThinkingLevel(level)
    setState("thinking", level)
  }

  return (
    <AgentContext.Provider
      value={{ state, agent: props.agent, prompt, queue, abort, clear, setModel, setThinking }}
    >
      {props.children}
    </AgentContext.Provider>
  )
}

export function useAgent() {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error("useAgent must be used within AgentProvider")
  return ctx
}

// Helper to extract text from tool result
function getToolText(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "")
  const maybe = result as { content?: unknown }
  const content = Array.isArray(maybe.content) ? maybe.content : []
  return content
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("")
}

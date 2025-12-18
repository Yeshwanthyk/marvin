import { render, useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createSignal } from "solid-js"
import type { Agent, ThinkingLevel } from "@mu-agents/agent-core"
import type { Model, Api } from "@mu-agents/ai"

import { ThemeProvider } from "./context/theme.js"
import { AgentProvider, useAgent } from "./context/agent.js"
import { PromptProvider } from "./context/prompt.js"
import { CommandProvider, useCommand, type SlashCommand } from "./context/command.js"

import { ChatMessage } from "./components/chat-message.js"
import { ToolBlock } from "./components/tool-block.js"
import { PromptInput } from "./components/prompt-input.js"
import { Footer } from "./components/footer.js"
import { Loader } from "./components/loader.js"
import { Markdown } from "./components/markdown.js"
import { colors } from "./utils/colors.js"

export interface TuiConfig {
  agent: Agent
  /** Config directory for persistence */
  configDir?: string
  /** Initial model override */
  model?: Model<Api>
  /** Initial thinking level */
  thinking?: ThinkingLevel
  /** Available models for /model command */
  models?: Model<Api>[]
  /** Additional slash commands to register */
  commands?: SlashCommand[]
  /** Called when renderer is destroyed */
  onExit?: () => void | Promise<void>
}

function App(props: { agent: Agent }) {
  const agent = useAgent()
  
  const messages = () => agent.state.messages
  const commands = useCommand()
  const dimensions = useTerminalDimensions()

  const [toolOutputExpanded, setToolOutputExpanded] = createSignal(false)
  const [ctrlCCount, setCtrlCCount] = createSignal(0)

  // Global keyboard handler
  useKeyboard((evt) => {
    // Ctrl+C - double tap to exit
    if (evt.ctrl && evt.name === "c") {
      if (agent.state.responding) {
        agent.abort()
        return
      }
      setCtrlCCount((c) => c + 1)
      if (ctrlCCount() >= 1) {
        process.exit(0)
      }
      setTimeout(() => setCtrlCCount(0), 500)
      return
    }

    // Ctrl+O - toggle tool output
    if (evt.ctrl && evt.name === "o") {
      setToolOutputExpanded((e) => !e)
      return
    }

    // Escape - abort if responding
    if (evt.name === "escape" && agent.state.responding) {
      agent.abort()
      return
    }
  })

  return (
    <box
      flexDirection="column"
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={colors.bg}
    >
      {/* Header */}
      <box height={1} paddingLeft={1}>
        <text fg={colors.textDim}>mu</text>
      </box>

      {/* Messages area */}
      <scrollbox flexGrow={1} overflow="scroll" stickyScroll={true} stickyStart="bottom">
        <Show when={messages().length > 0}>
          <For each={messages()}>
            {(msg) => <ChatMessage message={msg} />}
          </For>
        </Show>

        {/* Streaming/loader inline */}
        <box 
          paddingLeft={1} paddingRight={1} paddingTop={1}
          height={agent.state.responding ? undefined : 0}
        >
          {agent.state.currentAssistantContent ? (
            <text><Markdown content={agent.state.currentAssistantContent} streaming /></text>
          ) : agent.state.responding ? (
            <Loader />
          ) : null}
        </box>
      </scrollbox>

      {/* Input */}
      <PromptInput />

      {/* Footer */}
      <Footer />
    </box>
  )
}

/**
 * Default slash commands - these are created inside App so they have access to context
 */
function useDefaultCommands(): SlashCommand[] {
  const agent = useAgent()
  
  return [
    {
      name: "clear",
      description: "Clear chat and reset agent",
      onSelect: () => agent.clear(),
    },
    {
      name: "abort",
      description: "Abort current request",
      onSelect: () => agent.abort(),
    },
    {
      name: "exit",
      description: "Exit the application",
      onSelect: () => process.exit(0),
    },
    {
      name: "help",
      description: "Show available commands",
      onSelect: () => {
        // Could show help dialog in future
      },
    },
  ]
}

/**
 * Inner app wrapper that registers default commands after providers are ready
 */
function AppWithCommands(props: { agent: Agent; commands?: SlashCommand[] }) {
  const commands = useCommand()
  const defaultCommands = useDefaultCommands()
  
  // Register default commands and any additional commands from config
  commands.register([...defaultCommands, ...(props.commands ?? [])])
  
  return <App agent={props.agent} />
}

/**
 * Main entry point for the TUI
 */
export async function runTui(config: TuiConfig): Promise<void> {
  return new Promise((resolve) => {
    render(
      () => (
        <ThemeProvider>
          <AgentProvider agent={config.agent}>
            <PromptProvider>
              <CommandProvider>
                <AppWithCommands agent={config.agent} commands={config.commands} />
              </CommandProvider>
            </PromptProvider>
          </AgentProvider>
        </ThemeProvider>
      ),
      {
        targetFps: 60,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
        onDestroy: async () => {
          await config.onExit?.()
          resolve()
        },
      }
    ).catch(async (err) => {
      console.error(err)
      await config.onExit?.()
      resolve()
    })
  })
}

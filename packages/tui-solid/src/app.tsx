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

      {/* Messages area - scrollable */}
      <scrollbox flexGrow={1} overflow="scroll" stickyScroll>
        <For each={agent.state.messages}>
          {(msg) => <ChatMessage message={msg} />}
        </For>

        <For each={agent.state.toolBlocks}>
          {(block) => (
            <ToolBlock
              block={block}
              expanded={toolOutputExpanded()}
              width={dimensions().width - 4}
            />
          )}
        </For>

        {/* Streaming assistant content or loading indicator */}
        <Show 
          when={agent.state.currentAssistantContent}
          fallback={
            <Show when={agent.state.responding}>
              <Loader />
            </Show>
          }
        >
          <box paddingLeft={1} paddingRight={1} paddingTop={1}>
            <text><Markdown content={agent.state.currentAssistantContent!} streaming /></text>
          </box>
        </Show>
      </scrollbox>

      {/* Input */}
      <PromptInput />

      {/* Footer */}
      <Footer />
    </box>
  )
}

/**
 * Create default slash commands for the TUI
 */
function createDefaultCommands(agent: Agent): SlashCommand[] {
  return [
    {
      name: "clear",
      description: "Clear chat and reset agent",
      onSelect: () => agent.reset(),
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
 * Main entry point for the TUI
 */
export async function runTui(config: TuiConfig): Promise<void> {
  const defaultCommands = createDefaultCommands(config.agent)
  const initialCommands = [...defaultCommands, ...(config.commands ?? [])]

  return new Promise((resolve) => {
    render(
      () => (
        <ThemeProvider>
          <AgentProvider agent={config.agent}>
            <PromptProvider>
              <CommandProvider initialCommands={initialCommands}>
                <App agent={config.agent} />
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

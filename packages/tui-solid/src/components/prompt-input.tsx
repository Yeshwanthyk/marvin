import { Show, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { TextareaRenderable, BoxRenderable, KeyEvent } from "@opentui/core"
import { useAgent } from "../context/agent.js"
import { usePrompt } from "../context/prompt.js"
import { useCommand } from "../context/command.js"
import { useTheme } from "../context/theme.js"
import { Autocomplete, type AutocompleteItem } from "./autocomplete.js"

export interface PromptInputProps {
  /** Disable input (e.g., while processing) */
  disabled?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Callback when prompt is submitted */
  onSubmit?: () => void
}

export function PromptInput(props: PromptInputProps) {
  const agent = useAgent()
  const prompt = usePrompt()
  const commands = useCommand()
  const theme = useTheme()

  let textareaRef: TextareaRenderable | undefined
  let anchorRef: BoxRenderable | undefined

  const [autocomplete, setAutocomplete] = createStore<{
    visible: boolean
    mode: "slash" | "none"
    items: AutocompleteItem[]
    selected: number
    triggerIndex: number
  }>({
    visible: false,
    mode: "none",
    items: [],
    selected: 0,
    triggerIndex: 0,
  })

  // Focus textarea on mount
  onMount(() => {
    textareaRef?.focus()
  })

  const showSlashCommands = () => {
    const allCommands = commands.commands()
    const items: AutocompleteItem[] = allCommands.map((c) => ({
      value: "/" + c.name,
      label: "/" + c.name,
      description: c.description,
    }))

    setAutocomplete({
      visible: items.length > 0,
      mode: "slash",
      items,
      selected: 0,
      triggerIndex: textareaRef?.cursorOffset ?? 0,
    })
  }

  const updateSlashCompletions = (value: string) => {
    if (!value.startsWith("/")) {
      setAutocomplete("visible", false)
      return
    }

    const query = value.slice(1).split(" ")[0] ?? ""
    const matches = commands.getCompletions(query)
    const items: AutocompleteItem[] = matches.map((c) => ({
      value: "/" + c.name,
      label: "/" + c.name,
      description: c.description,
    }))

    setAutocomplete({
      visible: items.length > 0,
      mode: "slash",
      items,
      selected: 0,
      triggerIndex: 0,
    })
  }

  const hideAutocomplete = () => {
    setAutocomplete("visible", false)
  }

  const handleInput = (value: string) => {
    prompt.setText(value)

    // Handle slash commands
    if (value.startsWith("/") && !value.match(/^\/\S+\s/)) {
      // Show or update slash completions
      updateSlashCompletions(value)
    } else if (autocomplete.visible && autocomplete.mode === "slash") {
      // Hide if no longer a slash command
      hideAutocomplete()
    }
  }

  const handleSubmit = () => {
    // If autocomplete visible, select item instead of submitting
    if (autocomplete.visible) {
      selectAutocompleteItem()
      return
    }

    // Get text directly from textarea to avoid sync issues
    const text = (textareaRef?.plainText ?? prompt.state.text).trim()

    // Empty submit while responding = abort
    if (!text) {
      if (agent.state.responding) {
        agent.abort()
      }
      return
    }

    // Handle slash commands
    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.slice(1).split(" ")
      if (cmdName && commands.execute(cmdName, args.join(" "))) {
        prompt.clear()
        textareaRef?.setText("")
        return
      }
    }

    // Regular prompt
    if (agent.state.responding) {
      agent.queue(text)
    } else {
      agent.prompt(text)
    }

    prompt.addToHistory(text)
    prompt.clear()
    textareaRef?.setText("")
    props.onSubmit?.()
  }

  const selectAutocompleteItem = () => {
    const item = autocomplete.items[autocomplete.selected]
    if (!item) return

    hideAutocomplete()

    // For slash commands, execute directly
    if (autocomplete.mode === "slash") {
      const cmdName = item.value.slice(1) // remove leading "/"
      commands.execute(cmdName)
      prompt.clear()
      if (textareaRef) {
        textareaRef.setText("")
      }
      return
    }

    // For other completions, fill in the text
    prompt.setText(item.value + " ")
    if (textareaRef) {
      textareaRef.setText(item.value + " ")
      textareaRef.cursorOffset = item.value.length + 1
    }
  }

  const handleKeyDown = (e: KeyEvent) => {
    // Autocomplete navigation
    if (autocomplete.visible) {
      if (e.name === "up") {
        e.preventDefault?.()
        setAutocomplete("selected", (s) => Math.max(0, s - 1))
        return
      }
      if (e.name === "down") {
        e.preventDefault?.()
        setAutocomplete("selected", (s) => Math.min(autocomplete.items.length - 1, s + 1))
        return
      }
      if (e.name === "tab") {
        e.preventDefault?.()
        selectAutocompleteItem()
        return
      }
      if (e.name === "escape") {
        e.preventDefault?.()
        hideAutocomplete()
        return
      }
    }

    // History navigation (when not in autocomplete)
    if (e.name === "up" && !autocomplete.visible) {
      // Only navigate history if at start of input
      if (textareaRef?.cursorOffset === 0) {
        if (prompt.navigateHistory("up")) {
          e.preventDefault?.()
        }
      }
    }
    if (e.name === "down" && !autocomplete.visible) {
      // Only navigate history if at end of input
      const len = prompt.state.text.length
      if (textareaRef?.cursorOffset === len) {
        if (prompt.navigateHistory("down")) {
          e.preventDefault?.()
        }
      }
    }
  }

  return (
    <box flexDirection="column">
      {/* Autocomplete popup - rendered before anchor for absolute positioning */}
      <Show when={autocomplete.visible}>
        <Autocomplete
          items={autocomplete.items}
          selected={autocomplete.selected}
          maxVisible={8}
          anchor={anchorRef}
        />
      </Show>

      {/* Input anchor box */}
      <box
        ref={(r: BoxRenderable) => {
          anchorRef = r
        }}
        border
        borderColor={theme.colors.border}
        backgroundColor={theme.colors.bgRaised}
      >
        <textarea
          ref={(r: TextareaRenderable) => {
            textareaRef = r
          }}
          focused
          showCursor
          cursorColor={theme.colors.accent}
          textColor={props.disabled ? theme.colors.textDim : theme.colors.text}
          placeholder={props.placeholder ?? "Ask anything..."}
          wrapMode="word"
          minHeight={1}
          maxHeight={6}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", meta: true, action: "newline" },
          ]}
          onContentChange={() => {
            if (textareaRef) {
              handleInput(textareaRef.plainText)
            }
          }}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
        />
      </box>

      {/* Status line */}
      <box height={1} paddingLeft={1}>
        <Show
          when={agent.state.responding}
          fallback={
            <text fg={theme.colors.textDim}>
              enter submit · ↑↓ history · / commands
            </text>
          }
        >
          <text fg={theme.colors.textDim}>
            <span style={{ fg: theme.colors.accent }}>responding</span>
            {" · "}
            <span>esc abort</span>
            {" · "}
            <span>enter queue message</span>
          </text>
        </Show>
      </box>
    </box>
  )
}

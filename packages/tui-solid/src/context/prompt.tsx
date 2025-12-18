import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"

interface PromptState {
  text: string
  history: string[]
  historyIndex: number
  savedText: string | null
}

interface PromptContextValue {
  state: PromptState
  setText: (text: string) => void
  clear: () => void
  addToHistory: (text: string) => void
  navigateHistory: (direction: "up" | "down") => boolean
}

const PromptContext = createContext<PromptContextValue>()

const MAX_HISTORY = 100

export function PromptProvider(props: ParentProps) {
  const [state, setState] = createStore<PromptState>({
    text: "",
    history: [],
    historyIndex: -1,
    savedText: null,
  })

  const setText = (text: string) => {
    setState("text", text)
    // Exit history mode when typing
    if (state.historyIndex >= 0) {
      setState("historyIndex", -1)
      setState("savedText", null)
    }
  }

  const clear = () => {
    setState("text", "")
    setState("historyIndex", -1)
    setState("savedText", null)
  }

  const addToHistory = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    // Don't add duplicates
    if (state.history[0] === trimmed) return
    setState("history", (h) => [trimmed, ...h].slice(0, MAX_HISTORY))
  }

  const navigateHistory = (direction: "up" | "down"): boolean => {
    const entries = state.history
    if (entries.length === 0) return false

    if (direction === "up") {
      if (state.historyIndex === -1) {
        // Save current text before entering history
        setState("savedText", state.text)
        setState("historyIndex", 0)
        setState("text", entries[0] ?? "")
        return true
      }
      if (state.historyIndex < entries.length - 1) {
        const next = state.historyIndex + 1
        setState("historyIndex", next)
        setState("text", entries[next] ?? "")
        return true
      }
      return false
    }

    // direction === "down"
    if (state.historyIndex > 0) {
      const next = state.historyIndex - 1
      setState("historyIndex", next)
      setState("text", entries[next] ?? "")
      return true
    }
    if (state.historyIndex === 0) {
      // Restore saved text
      setState("historyIndex", -1)
      setState("text", state.savedText ?? "")
      setState("savedText", null)
      return true
    }
    return false
  }

  return (
    <PromptContext.Provider value={{ state, setText, clear, addToHistory, navigateHistory }}>
      {props.children}
    </PromptContext.Provider>
  )
}

export function usePrompt() {
  const ctx = useContext(PromptContext)
  if (!ctx) throw new Error("usePrompt must be used within PromptProvider")
  return ctx
}

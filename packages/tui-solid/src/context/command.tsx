import { createContext, useContext, type ParentProps, createSignal, type Accessor } from "solid-js"

export interface SlashCommand {
  name: string
  description: string
  onSelect: (args?: string) => void
  getArgCompletions?: (argText: string) => Completion[]
}

export interface Completion {
  value: string
  label: string
  description?: string
}

interface CommandContextValue {
  commands: Accessor<SlashCommand[]>
  register: (commands: SlashCommand[]) => void
  unregister: (names: string[]) => void
  execute: (name: string, args?: string) => boolean
  getCompletions: (query: string) => SlashCommand[]
  getArgCompletions: (commandName: string, argText: string) => Completion[]
}

const CommandContext = createContext<CommandContextValue>()

export interface CommandProviderProps extends ParentProps {
  initialCommands?: SlashCommand[]
}

export function CommandProvider(props: CommandProviderProps) {
  const [commands, setCommands] = createSignal<SlashCommand[]>(props.initialCommands ?? [])

  const register = (newCommands: SlashCommand[]) => {
    setCommands((prev) => {
      const names = new Set(newCommands.map((c) => c.name))
      const filtered = prev.filter((c) => !names.has(c.name))
      return [...filtered, ...newCommands]
    })
  }

  const unregister = (names: string[]) => {
    const nameSet = new Set(names)
    setCommands((prev) => prev.filter((c) => !nameSet.has(c.name)))
  }

  const execute = (name: string, args?: string): boolean => {
    const cmd = commands().find((c) => c.name === name)
    if (cmd) {
      cmd.onSelect(args)
      return true
    }
    return false
  }

  const getCompletions = (query: string): SlashCommand[] => {
    const q = query.toLowerCase()
    return commands().filter(
      (c) => c.name.toLowerCase().startsWith(q) || c.description.toLowerCase().includes(q)
    )
  }

  const getArgCompletions = (commandName: string, argText: string): Completion[] => {
    const cmd = commands().find((c) => c.name === commandName)
    if (cmd?.getArgCompletions) {
      return cmd.getArgCompletions(argText)
    }
    return []
  }

  return (
    <CommandContext.Provider
      value={{ commands, register, unregister, execute, getCompletions, getArgCompletions }}
    >
      {props.children}
    </CommandContext.Provider>
  )
}

export function useCommand() {
  const ctx = useContext(CommandContext)
  if (!ctx) throw new Error("useCommand must be used within CommandProvider")
  return ctx
}

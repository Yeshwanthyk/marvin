import { Match, Switch, Show } from "solid-js"
import { useTheme } from "../context/theme.js"
import { Markdown } from "./markdown.js"
import type { MessageItem } from "../context/agent.js"

export interface ChatMessageProps {
  message: MessageItem
  showTimestamp?: boolean
}

export function ChatMessage(props: ChatMessageProps) {
  const theme = useTheme()

  const formatTime = (ts: number) => {
    const date = new Date(ts)
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <box paddingLeft={1} paddingRight={1} paddingTop={1}>
      <Switch>
        <Match when={props.message.role === "user"}>
          <box flexDirection="column">
            <text>
              <span style={{ fg: theme.colors.textDim }}>› </span>
              <Markdown content={props.message.content} streaming={false} />
            </text>
            <Show when={props.showTimestamp}>
              <text fg={theme.colors.textDim}>{formatTime(props.message.timestamp)}</text>
            </Show>
          </box>
        </Match>
        <Match when={props.message.role === "assistant"}>
          <box flexDirection="column">
            <text><Markdown content={props.message.content} streaming={false} /></text>
            <Show when={props.showTimestamp || props.message.usage}>
              <text fg={theme.colors.textDim}>
                <Show when={props.showTimestamp}>{formatTime(props.message.timestamp)} </Show>
                <Show when={props.message.usage}>
                  · {props.message.usage?.input}↓ {props.message.usage?.output}↑
                </Show>
              </text>
            </Show>
          </box>
        </Match>
      </Switch>
    </box>
  )
}

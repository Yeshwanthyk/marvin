import { For, Show, createMemo } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
import { colors } from "../utils/colors.js"

export interface AutocompleteItem {
  value: string
  label: string
  description?: string
}

export interface AutocompleteProps {
  items: AutocompleteItem[]
  selected: number
  maxVisible?: number
  anchor?: BoxRenderable
}

export function Autocomplete(props: AutocompleteProps) {
  const maxVisible = () => props.maxVisible ?? 8

  const height = createMemo(() => {
    if (props.items.length === 0) return 1
    return Math.min(maxVisible(), props.items.length)
  })

  const startIndex = createMemo(() => {
    const max = maxVisible()
    if (props.items.length <= max) return 0
    const half = Math.floor(max / 2)
    const start = Math.max(0, props.selected - half)
    return Math.min(start, props.items.length - max)
  })

  const visibleItems = createMemo(() => {
    return props.items.slice(startIndex(), startIndex() + maxVisible())
  })

  const position = createMemo(() => {
    if (!props.anchor) return { x: 0, y: 0, width: 80 }
    const parent = props.anchor.parent
    const parentX = parent?.x ?? 0
    const parentY = parent?.y ?? 0
    return {
      x: props.anchor.x - parentX,
      y: props.anchor.y - parentY,
      width: props.anchor.width,
    }
  })

  return (
    <box
      position="absolute"
      top={position().y - height()}
      left={position().x}
      width={position().width}
      zIndex={100}
      border
      borderColor={colors.border}
    >
      <box backgroundColor={colors.bgRaised} height={height()}>
        <For
          each={visibleItems()}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text fg={colors.textDim}>No matching items</text>
            </box>
          }
        >
          {(item, index) => {
            const isSelected = () => index() + startIndex() === props.selected
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isSelected() ? colors.accent : undefined}
                flexDirection="row"
              >
                <text fg={isSelected() ? colors.bg : colors.text} flexShrink={0}>
                  {item.label}
                </text>
                <Show when={item.description}>
                  <text fg={isSelected() ? colors.bg : colors.textDim} wrapMode="none">
                    {" "}- {item.description}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}

import { createSignal, onMount, onCleanup } from "solid-js"
import { colors } from "../utils/colors.js"

export interface LoaderProps {
  text?: string
  spinnerColor?: string
  textColor?: string
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Loader(props: LoaderProps) {
  const [frame, setFrame] = createSignal(0)
  const [elapsed, setElapsed] = createSignal(0)

  onMount(() => {
    const spinnerInterval = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length)
    }, 80)
    
    const elapsedInterval = setInterval(() => {
      setElapsed((e) => e + 1)
    }, 1000)
    
    onCleanup(() => {
      clearInterval(spinnerInterval)
      clearInterval(elapsedInterval)
    })
  })

  return (
    <box live height={1} paddingLeft={1}>
      <text>
        <span style={{ fg: props.spinnerColor ?? colors.accent }}>{FRAMES[frame()]}</span>
        <span style={{ fg: props.textColor ?? colors.textDim }}>
          {" "}{props.text ?? "Thinking..."}{elapsed() > 2 ? ` (${elapsed()}s)` : ""}
        </span>
      </text>
    </box>
  )
}

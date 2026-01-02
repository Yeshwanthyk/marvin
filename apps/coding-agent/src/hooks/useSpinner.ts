import { createSignal, createEffect, onCleanup, type Accessor } from "solid-js"
import type { ActivityState } from "../types.js"

export function useSpinner(activityState: Accessor<ActivityState>): () => number {
	const [spinnerFrame, setSpinnerFrame] = createSignal(0)
	let spinnerInterval: ReturnType<typeof setInterval> | null = null

	createEffect(() => {
		if (activityState() !== "idle") {
			if (!spinnerInterval) {
				spinnerInterval = setInterval(() => setSpinnerFrame((frame) => (frame + 1) % 8), 200)
			}
		} else if (spinnerInterval) {
			clearInterval(spinnerInterval)
			spinnerInterval = null
			setSpinnerFrame(0)
		}
	})

	onCleanup(() => {
		if (spinnerInterval) {
			clearInterval(spinnerInterval)
			spinnerInterval = null
		}
	})

	return spinnerFrame
}

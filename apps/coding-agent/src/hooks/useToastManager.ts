import { createSignal, onCleanup } from "solid-js"
import type { ToastItem } from "@marvin-agents/open-tui"

export function useToastManager(limit = 3) {
	const [toasts, setToasts] = createSignal<ToastItem[]>([])
	const timeouts = new Set<ReturnType<typeof setTimeout>>()

	onCleanup(() => {
		for (const timeout of timeouts) {
			clearTimeout(timeout)
		}
		timeouts.clear()
	})

	const pushToast = (toast: Omit<ToastItem, "id">, ttlMs = 2000) => {
		const id = crypto.randomUUID()
		setToasts((prev) => [{ id, ...toast }, ...prev].slice(0, limit))
		const timeout = setTimeout(() => {
			timeouts.delete(timeout)
			setToasts((prev) => prev.filter((t) => t.id !== id))
		}, ttlMs)
		timeouts.add(timeout)
	}

	return { toasts, pushToast }
}

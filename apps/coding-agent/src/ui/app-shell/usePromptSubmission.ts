import { batch, createEffect, onCleanup } from "solid-js"
import { Effect, Fiber, Stream } from "effect"
import { createHookMessage } from "@yeshwanthyk/runtime-effect/hooks/index.js"
import type { PromptDeliveryMode, PromptQueueItem } from "@yeshwanthyk/runtime-effect/session/prompt-queue.js"
import { appendWithCap } from "@domain/messaging/content.js"
import type { useRuntime } from "../../runtime/context.js"
import type { SessionManager } from "../../session-manager.js"
import type { UIMessage, ToolBlock } from "../../types.js"
import type { EventHandlerContext } from "../../agent-events.js"
import { hookMessageToUiMessage } from "./hook-message-projection.js"

type RuntimeContext = ReturnType<typeof useRuntime>
type ActivityState = "idle" | "thinking" | "streaming" | "tool" | "error"

export interface PromptSubmissionStore {
	queueCounts: {
		set: (value: { steer: number; followUp: number }) => void
		value: () => { steer: number; followUp: number }
	}
	messages: {
		set: (updater: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => void
	}
	toolBlocks: {
		set: (updater: ToolBlock[] | ((prev: ToolBlock[]) => ToolBlock[])) => void
	}
	isResponding: {
		set: (value: boolean) => void
		value: () => boolean
	}
	activityState: {
		set: (value: ActivityState) => void
	}
}

export interface UsePromptSubmissionDeps {
	runtime: RuntimeContext
	hookRunner: RuntimeContext["hookRunner"]
	sessionManager: SessionManager
	store: PromptSubmissionStore
	activateVisibleSessionForSubmit: () => boolean
	revealLiveSession: () => boolean
	syncCurrentSessionLane: (title?: string, options?: { select?: boolean }) => unknown
	getPendingSessionTitle: () => string | undefined
	clearPendingSessionTitle: () => void
	showToast: (title: string, message: string, variant?: "info" | "warning" | "success" | "error") => void
	activeKey?: () => unknown
	canStartPrompt?: () => { ok: true } | { ok: false; maxStreaming: number }
}

export interface PromptSubmissionController {
	promptQueue: EventHandlerContext["promptQueue"]
	submitPrompt: (text: string, mode?: PromptDeliveryMode) => Promise<void>
	steerHelper: (text: string) => Promise<void>
	followUpHelper: (text: string) => Promise<void>
	sendUserMessageHelper: (text: string, options?: { deliverAs?: PromptDeliveryMode }) => Promise<void>
	enqueueWhileResponding: (text: string, mode: PromptDeliveryMode) => void
}

export const usePromptSubmission = ({
	runtime,
	hookRunner,
	sessionManager,
	store,
	activateVisibleSessionForSubmit,
	revealLiveSession,
	syncCurrentSessionLane,
	getPendingSessionTitle,
	clearPendingSessionTitle,
	showToast,
	activeKey,
	canStartPrompt,
}: UsePromptSubmissionDeps): PromptSubmissionController => {
	let promptQueueItems: ReadonlyArray<PromptQueueItem> = []
	let queueFiber: ReturnType<typeof Effect.runFork> | null = null
	const promptQueue: EventHandlerContext["promptQueue"] = {
		push: (_item: PromptQueueItem) => {},
		shift: () => {
			const item = promptQueueItems[0]
			if (item !== undefined) {
				promptQueueItems = promptQueueItems.slice(1)
				store.queueCounts.set({
					steer: promptQueueItems.filter((entry) => entry.mode === "steer").length,
					followUp: promptQueueItems.filter((entry) => entry.mode === "followUp").length,
				})
				Effect.runFork(runtime.promptQueue.acknowledgeHead(item))
			}
			return item
		},
		drainToScript: () =>
			Effect.runSync(Effect.catchAll(runtime.sessionOrchestrator.drainToScript, () => Effect.succeed(null))),
		clear: () => {
			Effect.runFork(runtime.promptQueue.clear)
		},
		size: () => promptQueueItems.length,
		peekAll: () => [...promptQueueItems],
		peek: () => promptQueueItems[0],
		counts: () => store.queueCounts.value(),
	}

	createEffect(() => {
		activeKey?.()
		if (queueFiber !== null) {
			Effect.runFork(Fiber.interrupt(queueFiber))
			queueFiber = null
		}
		promptQueueItems = []
		store.queueCounts.set({ steer: 0, followUp: 0 })
		queueFiber = Effect.runFork(
			Stream.runForEach(runtime.promptQueue.stateStream, (snapshot) =>
				Effect.sync(() => {
					promptQueueItems = snapshot.pending
					store.queueCounts.set(snapshot.counts)
				}),
			),
		)
	})
	onCleanup(() => {
		if (queueFiber !== null) Effect.runFork(Fiber.interrupt(queueFiber))
	})

	const submitPrompt = async (text: string, mode: PromptDeliveryMode = "followUp") => {
		const trimmed = text.trim()
		if (!trimmed) return
		const admission = canStartPrompt?.()
		if (admission?.ok === false) {
			showToast(
				"Streaming limit reached",
				`${admission.maxStreaming} sessions are already streaming. Queue this after one finishes.`,
				"warning",
			)
			return
		}
		if (!activateVisibleSessionForSubmit()) return
		if (sessionManager.sessionId) {
			syncCurrentSessionLane(getPendingSessionTitle())
			clearPendingSessionTitle()
		}

		let beforeStartResult: Awaited<ReturnType<typeof hookRunner.emitBeforeAgentStart>> | undefined
		try {
			beforeStartResult = await hookRunner.emitBeforeAgentStart(trimmed)
			const hookMsg = beforeStartResult?.message ? createHookMessage(beforeStartResult.message) : null
			if (hookMsg?.display) {
				store.messages.set((prev) => appendWithCap(prev, hookMessageToUiMessage(hookMsg)))
			}
		} catch (err) {
			store.messages.set((prev) =>
				appendWithCap(prev, {
					id: crypto.randomUUID(),
					role: "assistant",
					content: `Hook error: ${err instanceof Error ? err.message : String(err)}`,
					timestamp: Date.now(),
				}),
			)
		}

		batch(() => {
			store.toolBlocks.set([])
			store.isResponding.set(true)
			store.activityState.set("thinking")
		})
		try {
			await Effect.runPromise(runtime.sessionOrchestrator.submitPrompt(trimmed, { mode, beforeStartResult }))
			setTimeout(() => {
				if (!sessionManager.sessionId) return
				syncCurrentSessionLane(getPendingSessionTitle())
				clearPendingSessionTitle()
			}, 100)
		} catch (err) {
			batch(() => {
				store.messages.set((prev) =>
					appendWithCap(prev, {
						id: crypto.randomUUID(),
						role: "assistant",
						content: `Error: ${err instanceof Error ? err.message : String(err)}`,
					}),
				)
				store.isResponding.set(false)
				store.activityState.set("idle")
			})
		}
	}

	const steerHelper = async (text: string) => {
		const trimmed = text.trim()
		if (!trimmed) return
		if (store.isResponding.value()) {
			if (!revealLiveSession()) {
				showToast("Session still running", "Switch back to the live session before steering", "warning")
				return
			}
			await Effect.runPromise(runtime.sessionOrchestrator.submitPrompt(trimmed, { mode: "steer" }))
			return
		}
		await submitPrompt(trimmed, "steer")
	}

	const followUpHelper = async (text: string) => {
		const trimmed = text.trim()
		if (!trimmed) return
		if (store.isResponding.value()) {
			if (!revealLiveSession()) {
				showToast("Session still running", "Switch back to the live session before queueing follow-up", "warning")
				return
			}
			await Effect.runPromise(runtime.sessionOrchestrator.submitPrompt(trimmed, { mode: "followUp" }))
			return
		}
		await submitPrompt(trimmed, "followUp")
	}

	const sendUserMessageHelper = async (text: string, options?: { deliverAs?: PromptDeliveryMode }) => {
		const mode: PromptDeliveryMode = options?.deliverAs ?? "followUp"
		if (mode === "steer") {
			await steerHelper(text)
			return
		}
		await followUpHelper(text)
	}

	const enqueueWhileResponding = (text: string, mode: PromptDeliveryMode) => {
		void sendUserMessageHelper(text, { deliverAs: mode }).catch((err) => {
			store.messages.set((prev) =>
				appendWithCap(prev, {
					id: crypto.randomUUID(),
					role: "assistant",
					content: `Error: ${err instanceof Error ? err.message : String(err)}`,
				}),
			)
		})
	}

	return {
		promptQueue,
		submitPrompt,
		steerHelper,
		followUpHelper,
		sendUserMessageHelper,
		enqueueWhileResponding,
	}
}

import { createEffect, onCleanup } from "solid-js"
import type { Agent, AgentEvent } from "@marvin-agents/agent-core"
import { createAgentEventHandler, type EventHandlerContext } from "../agent-events.js"

export interface AgentEventsOptions {
	agent: Agent
	context: EventHandlerContext
}

export function useAgentEvents(options: AgentEventsOptions): void {
	const handler = createAgentEventHandler(options.context)

	createEffect(() => {
		const unsubscribe = options.agent.subscribe((event: AgentEvent) => {
			try {
				handler(event)
			} catch (err) {
				if (process.env.NODE_ENV !== "production") {
					console.error("Agent event handler error", err)
				}
			}
		})
		onCleanup(() => {
			unsubscribe()
			handler.dispose()
		})
	})
}

import type { AgentRunConfig, AgentTransport } from "@marvin-agents/agent-core"
import type { AgentEvent, Message } from "@marvin-agents/ai"
import type { HookRunner } from "./runner.js"

/**
 * Transport wrapper that applies hook transforms before passing to inner transport.
 * - Applies chat.messages.transform to message history
 * - Applies chat.system.transform to system prompt
 * - Applies chat.params to stream options
 * - Applies auth.get for API key/headers overrides
 * - Applies model.resolve for model routing
 */
export class HookedTransport implements AgentTransport {
	constructor(
		private inner: AgentTransport,
		private hooks: HookRunner
	) {}

	async *run(
		messages: Message[],
		userMessage: Message,
		cfg: AgentRunConfig,
		signal?: AbortSignal
	): AsyncIterable<AgentEvent> {
		const sessionId = this.hooks.getSessionId()
		const nextCfg = await this.hooks.applyRunConfig(cfg, sessionId)
		const transformed = await this.hooks.emitContext(messages)
		yield* this.inner.run(transformed, userMessage, nextCfg, signal)
	}

	async *continue(
		messages: Message[],
		cfg: AgentRunConfig,
		signal?: AbortSignal
	): AsyncIterable<AgentEvent> {
		const sessionId = this.hooks.getSessionId()
		const nextCfg = await this.hooks.applyRunConfig(cfg, sessionId)
		const transformed = await this.hooks.emitContext(messages)
		yield* this.inner.continue(transformed, nextCfg, signal)
	}
}

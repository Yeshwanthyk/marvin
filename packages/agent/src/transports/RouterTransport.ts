import type { AgentRunConfig, AgentTransport } from "./types.js";
import type { Message } from "@marvin-agents/ai";

export interface RouterTransportOptions {
	/** Transport for codex provider (OAuth) */
	codex?: AgentTransport;
	/** Transport for standard providers (API key) */
	provider: AgentTransport;
}

/**
 * Routes to correct transport based on model.provider
 */
export class RouterTransport implements AgentTransport {
	private codex?: AgentTransport;
	private provider: AgentTransport;

	constructor(options: RouterTransportOptions) {
		this.codex = options.codex;
		this.provider = options.provider;
	}

	private getTransport(cfg: AgentRunConfig): AgentTransport {
		if (cfg.model.provider === "codex") {
			if (!this.codex) {
				throw new Error("Codex transport not configured");
			}
			return this.codex;
		}
		return this.provider;
	}

	async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
		yield* this.getTransport(cfg).run(messages, userMessage, cfg, signal);
	}

	async *continue(messages: Message[], cfg: AgentRunConfig, signal?: AbortSignal) {
		yield* this.getTransport(cfg).continue(messages, cfg, signal);
	}
}

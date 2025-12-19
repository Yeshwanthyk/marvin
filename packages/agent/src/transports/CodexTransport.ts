import {
	type AgentContext,
	type AgentLoopConfig,
	agentLoop,
	agentLoopContinue,
	type Message,
	type UserMessage,
} from "@marvin-agents/ai";
import type { AgentRunConfig, AgentTransport } from "./types.js";
import type { CodexTokens } from "./codex/types.js";
import { createCodexFetch } from "./codex/fetch.js";
import { CODEX_BASE_URL } from "./codex/constants.js";
import { getCodexInstructions } from "./codex/instructions.js";

export interface CodexTransportOptions {
	/** Get current tokens */
	getTokens: () => Promise<CodexTokens | null>;
	/** Save updated tokens */
	setTokens: (tokens: CodexTokens) => Promise<void>;
	/** Clear tokens (on auth failure) */
	clearTokens: () => Promise<void>;
}

/**
 * Transport for Codex (ChatGPT subscription) OAuth-based access
 */
export class CodexTransport implements AgentTransport {
	private options: CodexTransportOptions;
	private customFetch: typeof fetch;
	private cachedInstructions: string | null = null;

	constructor(options: CodexTransportOptions) {
		this.options = options;
		this.customFetch = createCodexFetch({
			getTokens: options.getTokens,
			setTokens: options.setTokens,
			clearTokens: options.clearTokens,
		});
	}

	private async getInstructions(): Promise<string> {
		if (!this.cachedInstructions) {
			this.cachedInstructions = await getCodexInstructions();
		}
		return this.cachedInstructions;
	}

	private buildContext(messages: Message[], cfg: AgentRunConfig): AgentContext {
		return {
			systemPrompt: cfg.systemPrompt,
			messages,
			tools: cfg.tools,
		};
	}

	private async buildLoopConfig(cfg: AgentRunConfig): Promise<AgentLoopConfig> {
		// Override model to use openai-responses API
		// Keep standard OpenAI baseUrl - custom fetch rewrites to Codex endpoint
		const model = {
			...cfg.model,
			baseUrl: "https://api.openai.com/v1",
			provider: "openai" as const,
			api: "openai-responses" as const,
		};

		const instructions = await this.getInstructions();

		return {
			model,
			reasoning: cfg.reasoning,
			apiKey: "codex-oauth", // Dummy key, real auth via custom fetch
			fetch: this.customFetch,
			instructions,
			getQueuedMessages: cfg.getQueuedMessages,
		};
	}

	async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
		const context = this.buildContext(messages, cfg);
		const loopCfg = await this.buildLoopConfig(cfg);

		for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, loopCfg, signal)) {
			yield ev;
		}
	}

	async *continue(messages: Message[], cfg: AgentRunConfig, signal?: AbortSignal) {
		const context = this.buildContext(messages, cfg);
		const loopCfg = await this.buildLoopConfig(cfg);

		for await (const ev of agentLoopContinue(context, loopCfg, signal)) {
			yield ev;
		}
	}
}

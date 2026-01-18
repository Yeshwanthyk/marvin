import {
	type AgentContext,
	type AgentLoopConfig,
	agentLoop,
	agentLoopContinue,
	type Message,
	type Model,
	type UserMessage,
} from "@marvin-agents/ai";
import type { AgentRunConfig, AgentTransport } from "./types.js";
import type { CodexTokens } from "./codex/types.js";
import { createCodexFetch } from "./codex/fetch.js";
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
type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class CodexTransport implements AgentTransport {
	private customFetch: FetchFn;
	private instructionsCache: Record<string, string> = {};

	constructor(options: CodexTransportOptions) {
		this.customFetch = createCodexFetch({
			getTokens: options.getTokens,
			setTokens: options.setTokens,
			clearTokens: options.clearTokens,
		});
	}

	/** Get the custom fetch for direct API calls (compaction, etc.) */
	getFetch(): FetchFn {
		return this.customFetch;
	}

	/**
	 * Build a correctly-shaped OpenAI Responses config for one-off calls (e.g. /compact).
	 * Mirrors the model/option overrides used in `run()`.
	 */
	async getDirectCallConfig(baseModel: Model<any>) {
		const { compat: _compat, ...rest } = baseModel as Model<any>;
		const model: Model<"openai-responses"> = {
			...(rest as Omit<Model<any>, "compat">),
			baseUrl: "https://api.openai.com/v1",
			provider: "openai" as const,
			api: "openai-responses" as const,
		};

		const instructions = await this.getInstructions(baseModel.id);

		return {
			model,
			apiKey: "codex-oauth" as const,
			fetch: this.customFetch,
			instructions,
		};
	}

	private async getInstructions(modelId: string): Promise<string> {
		// Cache per model family (codex vs general)
		const cacheKey = modelId.toLowerCase().includes("codex") ? "codex" : "general";
		if (!this.instructionsCache[cacheKey]) {
			this.instructionsCache[cacheKey] = await getCodexInstructions(modelId);
		}
		return this.instructionsCache[cacheKey];
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

		const instructions = await this.getInstructions(cfg.model.id);

		return {
			model,
			reasoning: cfg.reasoning,
			apiKey: "codex-oauth", // Dummy key, real auth via custom fetch
			fetch: this.customFetch,
			instructions,
			getSteeringMessages: cfg.getSteeringMessages,
			getFollowUpMessages: cfg.getFollowUpMessages,
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

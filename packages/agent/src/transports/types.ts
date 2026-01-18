import type { AgentEvent, AgentTool, Api, Message, Model, QueuedMessage, ReasoningEffort, SimpleStreamOptions } from "@marvin-agents/ai";

/**
 * The minimal configuration needed to run an agent turn.
 */
export interface AgentRunConfig {
	systemPrompt: string;
	tools: AgentTool[];
	model: Model<Api>;
	reasoning?: ReasoningEffort;
	/** Stream options (hook overridable) */
	streamOptions?: SimpleStreamOptions;
	/** API key override (from auth hook) */
	apiKey?: string;
	/** Custom headers override (from auth hook) */
	headers?: Record<string, string>;
	/** Base URL override (from model.resolve hook) */
	baseUrl?: string;
	getQueuedMessages?: <T>() => Promise<QueuedMessage<T>[]>;
	getSteeringMessages?: <T>() => Promise<QueuedMessage<T>[]>;
	getFollowUpMessages?: <T>() => Promise<QueuedMessage<T>[]>;
}

/**
 * Transport interface for executing agent turns.
 * Transports handle the communication with LLM providers,
 * abstracting away the details of API calls, proxies, etc.
 *
 * Events yielded must match the @marvin-agents/ai AgentEvent types.
 */
export interface AgentTransport {
	/** Run with a new user message */
	run(
		messages: Message[],
		userMessage: Message,
		config: AgentRunConfig,
		signal?: AbortSignal,
	): AsyncIterable<AgentEvent>;

	/** Continue from current context (no new user message) */
	continue(messages: Message[], config: AgentRunConfig, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

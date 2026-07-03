import type { Usage } from "../types.js";

export interface AnthropicDeltaUsage {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
}

export interface OpenAICompletionsUsage {
	prompt_tokens?: number | null;
	completion_tokens?: number | null;
	total_tokens?: number | null;
	prompt_tokens_details?: object | null;
}

export interface GoogleUsageMetadata {
	promptTokenCount?: number | null;
	candidatesTokenCount?: number | null;
	thoughtsTokenCount?: number | null;
	cachedContentTokenCount?: number | null;
	totalTokenCount?: number | null;
}

export function createEmptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

export function applyAnthropicDeltaUsage(
	usage: Usage,
	delta: AnthropicDeltaUsage,
): void {
	if (delta.input_tokens != null) {
		usage.input = delta.input_tokens;
	}
	if (delta.output_tokens != null) {
		usage.output = delta.output_tokens;
	}
	if (delta.cache_read_input_tokens != null) {
		usage.cacheRead = delta.cache_read_input_tokens;
	}
	if (delta.cache_creation_input_tokens != null) {
		usage.cacheWrite = delta.cache_creation_input_tokens;
	}
	recomputeTotalTokens(usage);
}

export function buildOpenAICompletionsUsage(
	rawUsage: OpenAICompletionsUsage,
): Usage {
	const cachedTokens = readNumberProperty(
		rawUsage.prompt_tokens_details,
		"cached_tokens",
	);
	const cacheWriteTokens = readNumberProperty(
		rawUsage.prompt_tokens_details,
		"cache_write_tokens",
	);
	const input =
		(rawUsage.prompt_tokens ?? 0) - cachedTokens - cacheWriteTokens;
	const output = rawUsage.completion_tokens ?? 0;
	const usage = createEmptyUsage();
	usage.input = input;
	usage.output = output;
	usage.cacheRead = cachedTokens;
	usage.cacheWrite = cacheWriteTokens;
	usage.totalTokens =
		rawUsage.total_tokens ?? input + output + cachedTokens + cacheWriteTokens;
	return usage;
}

export function buildGoogleUsage(rawUsage: GoogleUsageMetadata): Usage {
	const cachedTokens = rawUsage.cachedContentTokenCount ?? 0;
	const usage = createEmptyUsage();
	usage.input = (rawUsage.promptTokenCount ?? 0) - cachedTokens;
	usage.output =
		(rawUsage.candidatesTokenCount ?? 0) + (rawUsage.thoughtsTokenCount ?? 0);
	usage.cacheRead = cachedTokens;
	usage.totalTokens = rawUsage.totalTokenCount ?? 0;
	return usage;
}

function recomputeTotalTokens(usage: Usage): void {
	usage.totalTokens =
		usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function readNumberProperty(
	value: object | null | undefined,
	property: string,
): number {
	if (!value) return 0;
	const result = Reflect.get(value, property);
	return typeof result === "number" ? result : 0;
}

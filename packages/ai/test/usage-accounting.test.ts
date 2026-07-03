import { describe, expect, it } from "vitest";
import {
	applyAnthropicDeltaUsage,
	buildGoogleUsage,
	buildOpenAICompletionsUsage,
	createEmptyUsage,
} from "../src/providers/usage-accounting.js";

describe("provider usage accounting", () => {
	it("preserves Anthropic usage fields when message_delta omits them", () => {
		const usage = createEmptyUsage();
		usage.input = 100;
		usage.output = 2;
		usage.cacheRead = 30;
		usage.cacheWrite = 20;
		usage.totalTokens = 152;

		applyAnthropicDeltaUsage(usage, { output_tokens: 7 });

		expect(usage.input).toBe(100);
		expect(usage.output).toBe(7);
		expect(usage.cacheRead).toBe(30);
		expect(usage.cacheWrite).toBe(20);
		expect(usage.totalTokens).toBe(157);
	});

	it("subtracts OpenAI completions cache writes and does not double-count reasoning", () => {
		const usage = buildOpenAICompletionsUsage({
			prompt_tokens: 100,
			completion_tokens: 40,
			total_tokens: 140,
			prompt_tokens_details: {
				cached_tokens: 25,
				cache_write_tokens: 15,
			},
		});

		expect(usage.input).toBe(60);
		expect(usage.output).toBe(40);
		expect(usage.cacheRead).toBe(25);
		expect(usage.cacheWrite).toBe(15);
		expect(usage.totalTokens).toBe(140);
	});

	it("subtracts Google cached content tokens from input", () => {
		const usage = buildGoogleUsage({
			promptTokenCount: 100,
			cachedContentTokenCount: 35,
			candidatesTokenCount: 20,
			thoughtsTokenCount: 5,
			totalTokenCount: 125,
		});

		expect(usage.input).toBe(65);
		expect(usage.output).toBe(25);
		expect(usage.cacheRead).toBe(35);
		expect(usage.cacheWrite).toBe(0);
		expect(usage.totalTokens).toBe(125);
	});
});

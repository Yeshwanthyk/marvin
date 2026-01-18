import { getModel } from "@marvin-agents/ai";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { Message, QueuedMessage } from "@marvin-agents/ai";
import { Agent, ProviderTransport, type AgentRunConfig, type AgentTransport } from "../src/index.js";
import type { AgentEvent, AppMessage } from "../src/types.js";

class QueueCapturingTransport implements AgentTransport {
	public lastSteering: QueuedMessage[] = [];
	public lastFollowUps: QueuedMessage[] = [];

	reset() {
		this.lastSteering = [];
		this.lastFollowUps = [];
	}

	private async captureQueues(cfg: AgentRunConfig) {
		this.lastSteering = (await cfg.getSteeringMessages?.()) ?? [];
		this.lastFollowUps = (await cfg.getFollowUpMessages?.()) ?? [];
	}

	async *run(_messages: Message[], _userMessage: Message, cfg: AgentRunConfig) {
		await this.captureQueues(cfg);
		yield { type: "agent_end", messages: [] as AppMessage[] } as AgentEvent;
	}

	async *continue(_messages: Message[], cfg: AgentRunConfig) {
		await this.captureQueues(cfg);
		yield { type: "agent_end", messages: [] as AppMessage[] } as AgentEvent;
	}
}

function createUserAppMessage(text: string): AppMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Agent", () => {
	it("should create an agent instance with default state", () => {
		const agent = new Agent({
			transport: new ProviderTransport(),
		});

		expect(agent.state).toBeDefined();
		expect(agent.state.systemPrompt).toBe("");
		expect(agent.state.model).toBeDefined();
		expect(agent.state.thinkingLevel).toBe("off");
		expect(agent.state.tools).toEqual([]);
		expect(agent.state.messages).toEqual([]);
		expect(agent.state.isStreaming).toBe(false);
		expect(agent.state.streamMessage).toBe(null);
		expect(agent.state.pendingToolCalls).toEqual(new Set());
		expect(agent.state.error).toBeUndefined();
	});

	it("should create an agent instance with custom initial state", () => {
		const customModel = getModel("openai", "gpt-4o-mini");
		const agent = new Agent({
			transport: new ProviderTransport(),
			initialState: {
				systemPrompt: "You are a helpful assistant.",
				model: customModel,
				thinkingLevel: "low",
			},
		});

		expect(agent.state.systemPrompt).toBe("You are a helpful assistant.");
		expect(agent.state.model).toBe(customModel);
		expect(agent.state.thinkingLevel).toBe("low");
	});

	it("should subscribe to events", () => {
		const agent = new Agent({
			transport: new ProviderTransport(),
		});

		let eventCount = 0;
		const unsubscribe = agent.subscribe((_event) => {
			eventCount++;
		});

		// No initial event on subscribe
		expect(eventCount).toBe(0);

		// State mutators don't emit events
		agent.setSystemPrompt("Test prompt");
		expect(eventCount).toBe(0);
		expect(agent.state.systemPrompt).toBe("Test prompt");

		// Unsubscribe should work
		unsubscribe();
		agent.setSystemPrompt("Another prompt");
		expect(eventCount).toBe(0); // Should not increase
	});

	it("should update state with mutators", () => {
		const agent = new Agent({
			transport: new ProviderTransport(),
		});

		// Test setSystemPrompt
		agent.setSystemPrompt("Custom prompt");
		expect(agent.state.systemPrompt).toBe("Custom prompt");

		// Test setModel
		const newModel = getModel("google", "gemini-2.5-flash");
		agent.setModel(newModel);
		expect(agent.state.model).toBe(newModel);

		// Test setThinkingLevel
		agent.setThinkingLevel("high");
		expect(agent.state.thinkingLevel).toBe("high");

		// Test setTools
		const tools = [{ name: "test", description: "test tool" } as any];
		agent.setTools(tools);
		expect(agent.state.tools).toBe(tools);

		// Test replaceMessages
		const messages = [{ role: "user" as const, content: "Hello", timestamp: Date.now() }];
		agent.replaceMessages(messages);
		expect(agent.state.messages).toEqual(messages);
		expect(agent.state.messages).not.toBe(messages); // Should be a copy

		// Test appendMessage
		const newMessage = { role: "assistant" as const, content: [{ type: "text" as const, text: "Hi" }] };
		agent.appendMessage(newMessage as any);
		expect(agent.state.messages).toHaveLength(2);
		expect(agent.state.messages[1]).toBe(newMessage);

		// Test clearMessages
		agent.clearMessages();
		expect(agent.state.messages).toEqual([]);
	});

	it("should support message queueing", async () => {
		const agent = new Agent({
			transport: new ProviderTransport(),
		});

		const message = { role: "user" as const, content: "Queued message", timestamp: Date.now() };
		await agent.queueMessage(message);

		// The message is queued but not yet in state.messages
		expect(agent.state.messages).not.toContainEqual(message);
	});

	it("should handle abort controller", () => {
		const agent = new Agent({
			transport: new ProviderTransport(),
		});

		// Should not throw even if nothing is running
		expect(() => agent.abort()).not.toThrow();
	});

	it("queueMessage should warn once and enqueue as follow-up", async () => {
		const transport = new QueueCapturingTransport();
		const agent = new Agent({ transport });
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const queued = createUserAppMessage("queued via alias");
		await agent.queueMessage(queued);
		await agent.prompt("baseline prompt");

		expect(transport.lastFollowUps).toHaveLength(1);
		expect((transport.lastFollowUps[0].original as AppMessage).content).toEqual(queued.content);
		expect(transport.lastFollowUps[0].mode).toBe("followUp");
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it("followUp should respect one-at-a-time queue mode", async () => {
		const transport = new QueueCapturingTransport();
		const agent = new Agent({ transport });

		const first = createUserAppMessage("first follow up");
		const second = createUserAppMessage("second follow up");
		await agent.followUp(first);
		await agent.followUp(second);

		await agent.prompt("trigger run");
		expect(transport.lastFollowUps).toHaveLength(1);
		expect((transport.lastFollowUps[0].original as AppMessage).content).toEqual(first.content);

		transport.reset();
		await agent.prompt("trigger second run");
		expect(transport.lastFollowUps).toHaveLength(1);
		expect((transport.lastFollowUps[0].original as AppMessage).content).toEqual(second.content);
	});

	it("followUp should respect 'all' queue mode", async () => {
		const transport = new QueueCapturingTransport();
		const agent = new Agent({ transport });

		agent.setQueueMode("all");
		const first = createUserAppMessage("first all message");
		const second = createUserAppMessage("second all message");
		await agent.followUp(first);
		await agent.followUp(second);

		await agent.prompt("trigger batch");
		expect(transport.lastFollowUps).toHaveLength(2);
		const payloads = transport.lastFollowUps.map((entry) => (entry.original as AppMessage).content);
		expect(payloads[0]).toEqual(first.content);
		expect(payloads[1]).toEqual(second.content);
	});

	it("steer should enqueue steering messages separately from follow-ups", async () => {
		const transport = new QueueCapturingTransport();
		const agent = new Agent({ transport });

		await agent.steer(createUserAppMessage("steer now"));
		await agent.followUp(createUserAppMessage("follow later"));

		await agent.prompt("trigger steering");

		expect(transport.lastSteering).toHaveLength(1);
		expect(transport.lastSteering[0].mode).toBe("steer");
		expect((transport.lastSteering[0].original as AppMessage).content).toEqual([
			{ type: "text", text: "steer now" },
		]);
		expect(transport.lastFollowUps).toHaveLength(1);
		expect((transport.lastFollowUps[0].original as AppMessage).content).toEqual([
			{ type: "text", text: "follow later" },
		]);
	});
});

describe("ProviderTransport", () => {
	it("should create a provider transport instance", () => {
		const transport = new ProviderTransport();
		expect(transport).toBeDefined();
	});

	it("should create a provider transport with options", () => {
		const transport = new ProviderTransport({
			getApiKey: async (provider) => `test-key-${provider}`,
			corsProxyUrl: "https://proxy.example.com",
		});
		expect(transport).toBeDefined();
	});
});

import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent/agent-loop.js";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentTool,
	QueueDeliveryMode,
	QueuedMessage,
} from "../src/agent/types.js";
import { getModel } from "../src/models.js";
import type {
	AssistantMessage,
	Message,
	Model,
	StopReason,
	ToolCall,
	UserMessage,
} from "../src/types.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

function createAssistantMessage(
	model: Model<any>,
	content: AssistantMessage["content"],
	stopReason: StopReason,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function createQueuedMessage(
	text: string,
	mode: QueueDeliveryMode,
): QueuedMessage {
	const userMessage = createUserMessage(text);
	return {
		original: userMessage,
		llm: userMessage,
		mode,
	};
}

function sequentialStream(messages: AssistantMessage[]) {
	let idx = 0;
	return async (_model: Model<any>, _context: any, _options: any) => {
		if (idx >= messages.length) {
			throw new Error("No more assistant messages provided to test stream");
		}
		const message = messages[idx++];
		const stream = new AssistantMessageEventStream();
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: message.stopReason, message });
		});
		return stream;
	};
}

describe("agentLoop steering/follow-up parity", () => {
	const model = getModel("google", "gemini-2.5-flash-lite-preview-06-17");

	it("should execute all tool calls in parallel and handle steering after batch completes", async () => {
		const steeringQueue: QueuedMessage[] = [];
		const followUpQueue: QueuedMessage[] = [];

		let firstToolExecuted = false;
		let secondToolExecuted = false;
		const tools: AgentTool[] = [
			{
				name: "first-tool",
				label: "first-tool",
				description: "first",
				parameters: Type.Object({}, { additionalProperties: false }),
				async execute() {
					firstToolExecuted = true;
					steeringQueue.push(createQueuedMessage("steer now", "steer"));
					return {
						content: [{ type: "text", text: "first-result" }],
						details: {},
					};
				},
			},
			{
				name: "second-tool",
				label: "second-tool",
				description: "second",
				parameters: Type.Object({}, { additionalProperties: false }),
				async execute() {
					secondToolExecuted = true;
					return {
						content: [{ type: "text", text: "second-result" }],
						details: {},
					};
				},
			},
		];

		const prompt = createUserMessage("start");
		const context: AgentContext = { systemPrompt: "test", messages: [], tools };
		const config: AgentLoopConfig = {
			model,
			getSteeringMessages: async () => {
				const queued = [...steeringQueue];
				steeringQueue.length = 0;
				return queued;
			},
			getFollowUpMessages: async () => {
				const queued = [...followUpQueue];
				followUpQueue.length = 0;
				return queued;
			},
		};

		const toolCalls: ToolCall[] = [
			{ type: "toolCall", id: "tool-1", name: "first-tool", arguments: {} },
			{ type: "toolCall", id: "tool-2", name: "second-tool", arguments: {} },
		];
		const assistantMessages = [
			createAssistantMessage(model, toolCalls, "toolUse"),
			createAssistantMessage(model, [{ type: "text", text: "done" }], "stop"),
		];
		const streamFn = sequentialStream(assistantMessages);

		const events: AgentEvent[] = [];
		const stream = agentLoop(prompt, context, config, undefined, streamFn);
		for await (const event of stream) {
			events.push(event);
		}
		await stream.result();

		// With parallel execution, both tools run to completion
		expect(firstToolExecuted).toBe(true);
		expect(secondToolExecuted).toBe(true);

		// Steering should still be handled after the batch completes
		const steeringEvents = events.filter(
			(event) =>
				event.type === "message_start" &&
				(event.message as Message).role === "user" &&
				(event.message as UserMessage).content?.[0]?.type === "text" &&
				(event.message as UserMessage).content?.[0]?.text === "steer now",
		);
		expect(steeringEvents).toHaveLength(1);
	});

	it("should only deliver follow-ups once the agent is idle", async () => {
		const steeringQueue: QueuedMessage[] = [];
		const followUpQueue: QueuedMessage[] = [
			createQueuedMessage("queued follow-up", "followUp"),
		];
		const tools: AgentTool[] = [
			{
				name: "slow-tool",
				label: "slow-tool",
				description: "runs once",
				parameters: Type.Object({}, { additionalProperties: false }),
				async execute() {
					return {
						content: [{ type: "text", text: "tool-result" }],
						details: {},
					};
				},
			},
		];

		const prompt = createUserMessage("start follow-up test");
		const context: AgentContext = { systemPrompt: "test", messages: [], tools };
		const config: AgentLoopConfig = {
			model,
			getSteeringMessages: async () => {
				const queued = [...steeringQueue];
				steeringQueue.length = 0;
				return queued;
			},
			getFollowUpMessages: async () => {
				const queued = [...followUpQueue];
				followUpQueue.length = 0;
				return queued;
			},
		};

		const assistantMessages = [
			createAssistantMessage(
				model,
				[
					{
						type: "toolCall",
						id: "tool-slow",
						name: "slow-tool",
						arguments: {},
					},
				],
				"toolUse",
			),
			createAssistantMessage(
				model,
				[{ type: "text", text: "final-response" }],
				"stop",
			),
		];
		const streamFn = sequentialStream(assistantMessages);

		const events: AgentEvent[] = [];
		const stream = agentLoop(prompt, context, config, undefined, streamFn);
		for await (const event of stream) {
			events.push(event);
		}
		await stream.result();

		const followUpEventIndex = events.findIndex(
			(event) =>
				event.type === "message_start" &&
				(event.message as Message).role === "user" &&
				(event.message as UserMessage).content?.[0]?.text ===
					"queued follow-up",
		);
		let finalAssistantIndex = -1;
		for (let i = events.length - 1; i >= 0; i--) {
			const event = events[i];
			if (
				event.type === "message_end" &&
				(event.message as Message).role === "assistant" &&
				(event.message as AssistantMessage).stopReason === "stop"
			) {
				finalAssistantIndex = i;
				break;
			}
		}

		expect(followUpEventIndex).toBeGreaterThan(-1);
		expect(finalAssistantIndex).toBeGreaterThan(-1);
		expect(followUpEventIndex).toBeGreaterThan(finalAssistantIndex);
	});
});

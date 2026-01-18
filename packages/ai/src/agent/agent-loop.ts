import { streamSimple } from "../stream.js";
import type { AssistantMessage, Context, Message, ToolResultMessage, UserMessage } from "../types.js";
import { EventStream } from "../utils/event-stream.js";
import { validateToolArguments } from "../utils/validation.js";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentTool,
	AgentToolResult,
	QueueDeliveryMode,
	QueuedMessage,
} from "./types.js";

/**
 * Start an agent loop with a new user message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
	prompt: UserMessage,
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: typeof streamSimple,
): EventStream<AgentEvent, AgentContext["messages"]> {
	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentContext["messages"] = [prompt];
		const currentContext: AgentContext = {
			...context,
			messages: [...context.messages, prompt],
		};

		stream.push({ type: "agent_start" });
		stream.push({ type: "turn_start" });
		stream.push({ type: "message_start", message: prompt });
		stream.push({ type: "message_end", message: prompt });

		await runLoop(currentContext, newMessages, config, signal, stream, streamFn);
	})();

	return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retry after overflow - context already has user message or tool results.
 * Throws if the last message is not a user message or tool result.
 */
export function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: typeof streamSimple,
): EventStream<AgentEvent, AgentContext["messages"]> {
	// Validate that we can continue from this context
	const lastMessage = context.messages[context.messages.length - 1];
	if (!lastMessage) {
		throw new Error("Cannot continue: no messages in context");
	}
	if (lastMessage.role !== "user" && lastMessage.role !== "toolResult") {
		throw new Error(`Cannot continue from message role: ${lastMessage.role}. Expected 'user' or 'toolResult'.`);
	}

	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentContext["messages"] = [];
		const currentContext: AgentContext = { ...context };

		stream.push({ type: "agent_start" });
		stream.push({ type: "turn_start" });
		// No user message events - we're continuing from existing context

		await runLoop(currentContext, newMessages, config, signal, stream, streamFn);
	})();

	return stream;
}

function createAgentStream(): EventStream<AgentEvent, AgentContext["messages"]> {
	return new EventStream<AgentEvent, AgentContext["messages"]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

interface RunLoopQueues {
	steering: QueuedMessage[];
	followUps: QueuedMessage[];
	all: QueuedMessage[];
}

function classifyQueuedMessages(messages: QueuedMessage[] = []): RunLoopQueues {
	const steering: QueuedMessage[] = [];
	const followUps: QueuedMessage[] = [];
	const all: QueuedMessage[] = [];
	for (const msg of messages) {
		all.push(msg);
		const mode: QueueDeliveryMode = (msg.mode as QueueDeliveryMode) || "followUp";
		if (mode === "steer") {
			steering.push(msg);
		} else {
			followUps.push(msg);
		}
	}
	return { steering, followUps, all };
}

async function runLoop(
	currentContext: AgentContext,
	newMessages: AgentContext["messages"],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentContext["messages"]>,
	streamFn?: typeof streamSimple,
): Promise<void> {
	let hasMoreToolCalls = true;
	let firstTurn = true;
	let pendingSteering: QueuedMessage[] = [];
	let pendingFollowUps: QueuedMessage[] = [];
	let pendingGeneral: QueuedMessage[] = [];

	const refreshQueueState = async () => {
		const general = await config.getQueuedMessages?.();
		const steering = await config.getSteeringMessages?.();
		const followUps = await config.getFollowUpMessages?.();
		const classifiedGeneral = classifyQueuedMessages(general || []);
		const classifiedSteering = classifyQueuedMessages(steering || []);
		const classifiedFollowUps = classifyQueuedMessages(followUps || []);
		pendingSteering = [...classifiedGeneral.steering, ...classifiedSteering.all];
		pendingFollowUps = [...classifiedGeneral.followUps, ...classifiedFollowUps.all];
		pendingGeneral = classifiedGeneral.all;
	};

	await refreshQueueState();

	while (hasMoreToolCalls || pendingSteering.length > 0 || pendingFollowUps.length > 0 || pendingGeneral.length > 0) {
		if (!firstTurn) {
			stream.push({ type: "turn_start" });
		} else {
			firstTurn = false;
		}

		const steeringBatch = pendingSteering;
		pendingSteering = [];
		if (steeringBatch.length > 0) {
			for (const { original, llm } of steeringBatch) {
				stream.push({ type: "message_start", message: original });
				stream.push({ type: "message_end", message: original });
				if (llm) {
					currentContext.messages.push(llm);
					newMessages.push(llm);
				}
			}
		}

		// Stream assistant response
		const message = await streamAssistantResponse(currentContext, config, signal, stream, streamFn);
		newMessages.push(message);

		if (message.stopReason === "error" || message.stopReason === "aborted") {
			// Stop the loop on error or abort
			stream.push({ type: "turn_end", message, toolResults: [] });
			stream.push({ type: "agent_end", messages: newMessages });
			stream.end(newMessages);
			return;
		}

		// Check for tool calls
		const toolCalls = message.content.filter((c) => c.type === "toolCall");
		hasMoreToolCalls = toolCalls.length > 0;

		const toolResults: ToolResultMessage[] = [];
		if (hasMoreToolCalls) {
			// Execute tool calls
			toolResults.push(...(await executeToolCalls(currentContext.tools, message, signal, stream)));
			currentContext.messages.push(...toolResults);
			newMessages.push(...toolResults);
		}
		stream.push({ type: "turn_end", message, toolResults: toolResults });

		await refreshQueueState();
		if (pendingSteering.length > 0) {
			continue;
		}

		if (pendingGeneral.length > 0) {
			continue;
		}

		if (pendingFollowUps.length > 0) {
			const followUps = pendingFollowUps;
			pendingFollowUps = [];
			for (const { original, llm } of followUps) {
				stream.push({ type: "message_start", message: original });
				stream.push({ type: "message_end", message: original });
				if (llm) {
					currentContext.messages.push(llm);
					newMessages.push(llm);
				}
			}
			await refreshQueueState();
			continue;
		}
	}

	stream.push({ type: "agent_end", messages: newMessages });
	stream.end(newMessages);
}

// Helper functions
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentContext["messages"]>,
	streamFn?: typeof streamSimple,
): Promise<AssistantMessage> {
	// Convert AgentContext to Context for streamSimple
	// Use a copy of messages to avoid mutating the original context
	const processedMessages = config.preprocessor
		? await config.preprocessor(context.messages, signal)
		: [...context.messages];
	const processedContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: [...processedMessages].map((m) => {
			if (m.role === "toolResult") {
				const { details, ...rest } = m;
				return rest;
			} else {
				return m;
			}
		}),
		tools: context.tools, // AgentTool extends Tool, so this works
	};

	// Use custom stream function if provided, otherwise use default streamSimple
	const streamFunction = streamFn || streamSimple;
	const response = await streamFunction(config.model, processedContext, { ...config, signal });

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				stream.push({ type: "message_start", message: { ...partialMessage } });
				break;

			case "text_start":
			case "text_delta":
			case "text_end":
			case "thinking_start":
			case "thinking_delta":
			case "thinking_end":
			case "toolcall_start":
			case "toolcall_delta":
			case "toolcall_end":
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					stream.push({ type: "message_update", assistantMessageEvent: event, message: { ...partialMessage } });
				}
				break;

			case "done":
			case "error": {
				const finalMessage = await response.result();
				if (addedPartial) {
					context.messages[context.messages.length - 1] = finalMessage;
				} else {
					context.messages.push(finalMessage);
				}
				if (!addedPartial) {
					stream.push({ type: "message_start", message: { ...finalMessage } });
				}
				stream.push({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	return await response.result();
}

async function executeToolCalls<T>(
	tools: AgentTool<any, T>[] | undefined,
	assistantMessage: AssistantMessage,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, Message[]>,
): Promise<ToolResultMessage<T>[]> {
	const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");

	// Execute all tools in parallel
	const executionPromises = toolCalls.map((toolCall) =>
		executeSingleToolCall<T>(toolCall, tools, signal, stream),
	);

	const results = await Promise.allSettled(executionPromises);

	// Maintain original order and extract results
	const toolResults: ToolResultMessage<T>[] = [];
	for (let i = 0; i < results.length; i++) {
		const settledResult = results[i];
		if (settledResult.status === "fulfilled") {
			toolResults.push(settledResult.value);
		} else {
			// This shouldn't happen since executeSingleToolCall catches errors
			// but handle it just in case
			const toolCall = toolCalls[i];
			toolResults.push({
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: [{ type: "text", text: "Tool execution failed" }],
				details: {} as T,
				isError: true,
				timestamp: Date.now(),
			});
		}
	}

	return toolResults;
}

/**
 * Execute a single tool call and return the result message.
 * Handles all event streaming and error handling.
 */
async function executeSingleToolCall<T>(
	toolCall: any,
	tools: AgentTool<any, T>[] | undefined,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, Message[]>,
): Promise<ToolResultMessage<T>> {
	const tool = tools?.find((t) => t.name === toolCall.name);

	stream.push({
		type: "tool_execution_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
	});

	let result: AgentToolResult<T>;
	let isError = false;

	try {
		if (!tool) throw new Error(`Tool ${toolCall.name} not found`);

		// Validate arguments using shared validation function
		const validatedArgs = validateToolArguments(tool, toolCall);

		// Execute with validated, typed arguments, passing update callback
		result = await tool.execute(toolCall.id, validatedArgs, signal, (partialResult) => {
			stream.push({
				type: "tool_execution_update",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				args: toolCall.arguments,
				partialResult,
			});
		});
	} catch (e) {
		result = {
			content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
			details: {} as T,
		};
		isError = true;
	}

	stream.push({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError,
	});

	const toolResultMessage: ToolResultMessage<T> = {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: result.content,
		details: result.details,
		isError,
		timestamp: Date.now(),
	};

	stream.push({ type: "message_start", message: toolResultMessage });
	stream.push({ type: "message_end", message: toolResultMessage });

	return toolResultMessage;
}

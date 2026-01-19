import { Agent, type AgentTransport, type ThinkingLevel } from "@yeshwanthyk/agent-core";
import type { Api, AgentTool, Model } from "@yeshwanthyk/ai";
import { Context, Effect, Layer } from "effect";
import { ConfigTag } from "./config.js";
import { ToolServiceTag } from "./tools.js";
import { TransportTag } from "./transports.js";

export interface AgentFactoryService {
  readonly bootstrapAgent: Agent;
  readonly createAgent: (options?: { model?: Model<Api>; thinking?: ThinkingLevel }) => Agent;
  readonly transport: AgentTransport;
  readonly tools: AgentTool[];
}

export const AgentFactoryTag = Context.GenericTag<AgentFactoryService>("runtime-effect/AgentFactory");

export const AgentFactoryLayer = Layer.effect(
  AgentFactoryTag,
  Effect.gen(function* () {
    const config = yield* ConfigTag;
    const { transport } = yield* TransportTag;
    const toolService = yield* ToolServiceTag;
    const tools = yield* toolService.loadBuiltinTools();

    const createAgent = (options?: { model?: Model<Api>; thinking?: ThinkingLevel }) =>
      new Agent({
        transport: transport.router,
        initialState: {
          systemPrompt: config.config.systemPrompt,
          model: options?.model ?? config.config.model,
          thinkingLevel: options?.thinking ?? config.config.thinking,
          tools,
        },
      });

    return {
      bootstrapAgent: createAgent(),
      createAgent,
      transport: transport.router,
      tools,
    } satisfies AgentFactoryService;
  }),
);

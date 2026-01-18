import type { AgentTool } from "@marvin-agents/ai";
import { toolRegistry } from "@marvin-agents/base-tools";
import { Context, Effect, Layer } from "effect";

export interface ToolService {
  readonly registry: typeof toolRegistry;
  readonly loadBuiltinTools: () => Effect.Effect<AgentTool<any, any>[], Error>;
}

const loadToolsEffect = (): Effect.Effect<AgentTool<any, any>[], Error> =>
  Effect.tryPromise(async () => {
    const tools: AgentTool<any, any>[] = [];
    for (const def of Object.values(toolRegistry)) {
      const tool = await def.load();
      tools.push(tool);
    }
    return tools;
  });

export const ToolServiceTag = Context.GenericTag<ToolService>("runtime-effect/ToolService");

export const ToolLayer = Layer.succeed(ToolServiceTag, {
  registry: toolRegistry,
  loadBuiltinTools: () => loadToolsEffect(),
});

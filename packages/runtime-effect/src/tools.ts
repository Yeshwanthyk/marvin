import type { AgentTool } from "@marvin-agents/ai";
import { createToolRegistry, type ToolRegistry } from "@marvin-agents/base-tools";
import { Context, Effect, Layer } from "effect";

export interface ToolService {
  readonly registry: ToolRegistry;
  readonly loadBuiltinTools: () => Effect.Effect<AgentTool[], Error>;
}

const loadToolsEffect = (registry: ToolRegistry): Effect.Effect<AgentTool[], Error> =>
  Effect.tryPromise(async () => {
    const tools: AgentTool[] = [];
    for (const def of Object.values(registry)) {
      const tool = await def.load();
      tools.push(tool);
    }
    return tools;
  });

export const ToolServiceTag = Context.GenericTag<ToolService>("runtime-effect/ToolService");

export const ToolLayer = (cwd: string) => {
  const registry = createToolRegistry(cwd);
  return Layer.succeed(ToolServiceTag, {
    registry,
    loadBuiltinTools: () => loadToolsEffect(registry),
  });
};

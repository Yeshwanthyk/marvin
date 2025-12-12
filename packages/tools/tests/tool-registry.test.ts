import { describe, it, expect } from "bun:test";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "../src/core/tool-registry";

describe("@mu-agents/tools ToolRegistry", () => {
  it("passes merged truncation config into tool context", async () => {
    const registry = new ToolRegistry({
      defaultContext: { truncation: { text: { maxBytes: 10 } as any } },
    });

    registry.register({
      name: "readContext",
      description: "read truncation config",
      schema: Type.Object({}),
      handler: async (_input, ctx) => ({ maxBytes: ctx.truncation.text.maxBytes }),
    });

    const out = await registry.invoke("readContext", {}, { truncation: { text: { maxBytes: 42 } as any } });
    expect((out as any).maxBytes).toBe(42);
  });
});


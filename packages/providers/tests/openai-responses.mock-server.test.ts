import { describe, it, expect } from "bun:test";
import { createOpenAIResponsesAdapter } from "../src/providers/openai-responses";
import type { AgentConversation } from "@mu-agents/types";
import { startMockSseServer, writeSse } from "./mock/sse-server";

describe("openai-responses adapter (mock server)", () => {
  it("streams text + tool-call deltas without network", async () => {
    const server = await startMockSseServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/responses") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      writeSse(res, {
        type: "response.output_text.delta",
        delta: { content: [{ type: "output_text.delta", text: "hi " }] },
      });

      // Simulate streamed function-call arguments in two chunks.
      writeSse(res, {
        type: "response.function_call.arguments.delta",
        delta: {
          function_call: { id: "c1", name: "echo", arguments: "{\"value\":" },
        },
      });
      writeSse(res, {
        type: "response.function_call.arguments.delta",
        delta: {
          function_call: { id: "c1", name: "echo", arguments: "\"x\"}" },
        },
      });

      writeSse(res, {
        type: "response.output_text.delta",
        delta: { content: [{ type: "output_text.delta", text: "there" }] },
      });

      writeSse(res, {
        type: "response.completed",
        metadata: { provider: "openai", model: "gpt-test", mode: "chat" },
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      });

      writeSse(res, "[DONE]");
      res.end();
    });

    try {
      const adapter = createOpenAIResponsesAdapter({
        getApiKey: () => "test",
        fetchImplementation: (url, init) => {
          const target =
            typeof url === "string" && url === "https://api.openai.com/v1/responses"
              ? `${server.baseUrl}/v1/responses`
              : url;
          return fetch(target as any, init as any);
        },
      });

      const conversation: AgentConversation = [
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ];

      const { stream } = await adapter.invoke({
        config: { provider: "openai", model: "gpt-test" },
        conversation,
      } as any);

      const events: Array<{ type: string; [k: string]: unknown }> = [];
      stream.subscribe((e) => {
        events.push(e as any);
      });
      // Use the public API to verify we got the expected high-level outputs.
      expect(stream.getAggregatedText()).toBe("hi there");

      // Ensure tool-call deltas were emitted (arguments come through as deltas).
      const toolCallEvents = events.filter((e) => e.type === "tool-call-delta");
      expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);

      expect(stream.getResponse()?.metadata?.provider).toBe("openai");
    } finally {
      await server.close();
    }
  });
});

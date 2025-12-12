import { describe, it, expect } from "bun:test";
import { ToolRegistry, registerShellTools } from "@mu-agents/tools";
import { ProviderStream } from "@mu-agents/providers";
import type { AgentTransport } from "../src/agent/types";
import { Agent } from "../src/agent/agent";
import { AgentLoop } from "../src/agent/agent-loop";

const fakeResponse = {
  metadata: { provider: "fake", model: "fake", mode: "chat" as const },
};

const makeStream = (emit: (s: ProviderStream) => void) => {
  const stream = new ProviderStream({ replayEvents: true });
  emit(stream);
  stream.close();
  return stream;
};

class ScriptedTransport implements AgentTransport {
  private callIndex = 0;
  constructor(private readonly scripts: Array<() => ProviderStream>) {}
  async invoke(): Promise<any> {
    const stream = this.scripts[this.callIndex++]?.() ?? makeStream(() => {});
    return { response: fakeResponse, stream };
  }
}

describe("runtime/tool/provider integration", () => {
  it("accumulates streamed tool arguments and preserves truncated tool output", async () => {
    const tools = new ToolRegistry({
      defaultContext: {
        truncation: {
          command: { maxBytes: 20, tailIndicator: "\n--- (truncated) ---\n" },
        } as any,
      },
    });
    registerShellTools(tools);

    const transport = new ScriptedTransport([
      () =>
        makeStream((s) => {
          // Stream JSON args in two chunks.
          s.emit({
            type: "tool-call-delta",
            toolName: "shell.bash",
            callId: "c1",
            argumentsText:
              "{\"command\":\"for i in {1..200}; do printf x; done; echo\"",
          });
          s.emit({
            type: "tool-call-delta",
            toolName: "shell.bash",
            callId: "c1",
            argumentsText: "}",
          });
        }),
      () => makeStream((s) => s.emit({ type: "text-delta", text: "done" })),
    ]);

    const agent = new Agent({
      config: { provider: "fake", model: "fake", tools: tools.listDefinitions() },
      transport,
      tools,
    });
    agent.enqueueUserText("use tool");

    const loop = new AgentLoop(agent);
    await loop.start();

    const convo = agent.getConversation();
    const toolMsg = convo.find((m) => m.role === "tool");
    expect(toolMsg).toBeTruthy();

    const toolResultBlock = (toolMsg as any).content?.find((b: any) => b.type === "tool-result");
    expect(toolResultBlock?.toolName).toBe("shell.bash");

    const stdout: string = toolResultBlock?.result?.stdout ?? "";
    expect(stdout).toContain("--- (truncated) ---");

    const assistants = convo.filter((m) => m.role === "assistant");
    expect(assistants[assistants.length - 1]?.content[0].text).toBe("done");
  });
});


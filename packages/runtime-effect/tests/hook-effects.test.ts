import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { HookRunner } from "../src/hooks/index.js";
import { createHookEffects } from "../src/hooks/effects.js";
import type { HookEvent } from "../src/hooks/types.js";

const createStubRunner = () => {
  const events: string[] = [];
  const beforeStart: string[] = [];
  let active = 0;
  let concurrent = false;

  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const runner = {
    async emit(event: HookEvent) {
      active += 1;
      if (active > 1) concurrent = true;
      await delay(5);
      const label = (event as { sessionId?: string | null }).sessionId;
      events.push(label ?? event.type);
      active -= 1;
    },
    async emitBeforeAgentStart(prompt: string) {
      beforeStart.push(prompt);
      return { message: { role: "hookMessage", customType: "test", content: prompt, display: true, timestamp: Date.now() } };
    },
    async emitChatMessage() {},
    async emitToolExecuteBefore() {
      return undefined;
    },
    async emitToolExecuteAfter() {
      return undefined;
    },
    async emitContext(messages: unknown[]) {
      return messages as any;
    },
    async applyRunConfig(cfg: unknown) {
      return cfg;
    },
    get state() {
      return { events, beforeStart, concurrent };
    },
  };

  return runner;
};

describe("HookEffects", () => {
  it("serializes hook emits through a channel", async () => {
    const stub = createStubRunner();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const effects = yield* createHookEffects(stub as unknown as HookRunner);
          yield* Effect.forEach(
            ["one", "two", "three", "four"],
            (label) => effects.emit({ type: "session.start", sessionId: label } as HookEvent),
            { concurrency: "unbounded" },
          );
        }),
      ),
    );

    expect(stub.state.concurrent).toBe(false);
    expect(stub.state.events).toEqual(["one", "two", "three", "four"]);
  });

  it("returns results from hook invocations", async () => {
    const stub = createStubRunner();

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const effects = yield* createHookEffects(stub as unknown as HookRunner);
          return yield* effects.emitBeforeAgentStart("hello world");
        }),
      ),
    );

    expect(stub.state.beforeStart).toEqual(["hello world"]);
    expect(result?.message?.content).toBe("hello world");
  });
});

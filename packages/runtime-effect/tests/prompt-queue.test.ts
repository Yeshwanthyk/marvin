import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import * as Runtime from "effect/Runtime";
import {
  PromptQueueLayer,
  PromptQueueTag,
  promptQueueToScript,
  scriptToPromptQueueItems,
  type PromptQueueItem,
  type PromptQueueService,
} from "../src/session/prompt-queue.js";

const runWithPromptQueue = async <A>(program: (service: PromptQueueService) => Effect.Effect<A>) => {
  const scoped = Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* Layer.toRuntime(PromptQueueLayer);
      return yield* Effect.promise(() =>
        Runtime.runPromise(
          runtime,
          Effect.gen(function* () {
            const service = yield* PromptQueueTag;
            return yield* program(service);
          }),
        ),
      );
    }),
  );
  return await Effect.runPromise(scoped);
};

describe("PromptQueueLayer", () => {
  it("tracks ordering and counts when enqueueing/taking", async () => {
    const result = await runWithPromptQueue((service) =>
      Effect.gen(function* () {
        yield* service.enqueue({ text: "alpha", mode: "followUp" });
        yield* service.enqueue({ text: "beta", mode: "steer" });
        const before = yield* service.countsSnapshot;
        const first = yield* service.take;
        const second = yield* service.take;
        const after = yield* service.countsSnapshot;
        return { before, after, first, second };
      }),
    );

    expect(result.before).toEqual({ followUp: 1, steer: 1 });
    expect(result.first).toEqual({ text: "alpha", mode: "followUp" });
    expect(result.second).toEqual({ text: "beta", mode: "steer" });
    expect(result.after).toEqual({ followUp: 0, steer: 0 });
  });

  it("drains to script and clears state", async () => {
    const result = await runWithPromptQueue((service) =>
      Effect.gen(function* () {
        yield* service.enqueue({ text: "line 1", mode: "followUp" });
        yield* service.enqueue({ text: "line 2", mode: "steer" });
        const script = yield* service.drainToScript;
        const counts = yield* service.countsSnapshot;
        const pending = yield* service.pendingSnapshot;
        return { script, counts, pending };
      }),
    );

    expect(result.script).toBe("/followup line 1\n/steer line 2");
    expect(result.counts).toEqual({ followUp: 0, steer: 0 });
    expect(result.pending).toEqual([]);
  });

  it("restores items from script and exposes snapshots", async () => {
    const script = "/steer do something\n/followup verify";
    const result = await runWithPromptQueue((service) =>
      Effect.gen(function* () {
        yield* service.restoreFromScript(script);
        const pending = yield* service.pendingSnapshot;
        const first = yield* service.take;
        const second = yield* service.take;
        const after = yield* service.countsSnapshot;
        return { pending, first, second, after };
      }),
    );

    expect(result.pending).toHaveLength(2);
    expect(result.first).toEqual({ text: "do something", mode: "steer" });
    expect(result.second).toEqual({ text: "verify", mode: "followUp" });
    expect(result.after).toEqual({ followUp: 0, steer: 0 });
  });
});

describe("prompt queue serialization helpers", () => {
  it("round-trips script content", () => {
    const items: PromptQueueItem[] = [
      { text: "inspect feature flag", mode: "followUp" },
      { text: "apply patch", mode: "steer" },
      { text: "", mode: "followUp" },
    ];
    const script = promptQueueToScript(items);
    expect(script).toBe("/followup inspect feature flag\n/steer apply patch\n/followup");
    const parsed = scriptToPromptQueueItems(script);
    expect(parsed).toEqual(items);
  });

  it("ignores invalid script lines", () => {
    const parsed = scriptToPromptQueueItems("plain text\n/unknown stuff\n/steer valid");
    expect(parsed).toEqual([{ text: "valid", mode: "steer" }]);
  });
});

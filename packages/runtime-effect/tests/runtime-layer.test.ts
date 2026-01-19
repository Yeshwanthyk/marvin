import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Agent, CodexTransport, ProviderTransport, RouterTransport } from "@yeshwanthyk/agent-core";
import { getModels } from "@yeshwanthyk/ai";
import type { LspManager } from "@yeshwanthyk/lsp";
import { Effect, Layer } from "effect";
import * as Runtime from "effect/Runtime";
import { RuntimeLayer, RuntimeServicesTag } from "../src/runtime.js";

const createTempConfig = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "runtime-layer-"));
  await mkdir(path.join(dir, "hooks"), { recursive: true });
  await mkdir(path.join(dir, "tools"), { recursive: true });
  await mkdir(path.join(dir, "commands"), { recursive: true });

  const model = getModels("anthropic")[0]!;
  const configPath = path.join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        provider: "anthropic",
        model: model.id,
        thinking: "medium",
        theme: "marvin",
        lsp: { enabled: false, autoInstall: false },
      },
      null,
      2,
    ),
    "utf8",
  );

  return { dir, configPath, model };
};

const stubLspManager = (): LspManager => ({
  touchFile: async () => {},
  diagnostics: async () => ({}),
  shutdown: async () => {},
  activeServers: () => [],
  diagnosticCounts: () => ({ errors: 0, warnings: 0 }),
});

const runLayer = async <A>(layer: Layer.Layer<never, never, A>) => {
  const scoped = Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* Layer.toRuntime(layer);
      return yield* Effect.promise(() =>
        Runtime.runPromise(
          runtime,
          Effect.gen(function* () {
            return yield* RuntimeServicesTag;
          }),
        ),
      );
    }),
  );

  return await Effect.runPromise(scoped);
};

describe("RuntimeLayer", () => {
  it("creates runtime services from config", async () => {
    const temp = await createTempConfig();
    try {
      const services = await runLayer(
        RuntimeLayer({
          adapter: "headless",
          configDir: temp.dir,
          configPath: temp.configPath,
          instrumentation: { record: () => {} },
          lspFactory: () => stubLspManager(),
        }),
      );

      expect(services.adapter).toBe("headless");
      expect(services.config.modelId).toBe(temp.model.id);
      expect(services.agent).toBeInstanceOf(Agent);
      expect(typeof services.sessionOrchestrator.submitPrompt).toBe("function");
      expect(typeof services.sessionOrchestrator.submitPromptAndWait).toBe("function");
      expect(typeof services.promptQueue.enqueue).toBe("function");
      expect(Array.isArray(services.cycleModels)).toBe(true);
    } finally {
      await rm(temp.dir, { recursive: true, force: true });
    }
  });

  it("uses custom transport factory when provided", async () => {
    const temp = await createTempConfig();
    const providerTransport = new ProviderTransport({ getApiKey: () => "test" });
    const codexTransport = new CodexTransport({
      getTokens: async () => null,
      setTokens: async () => {},
      clearTokens: async () => {},
    });
    const routerTransport = new RouterTransport({ provider: providerTransport, codex: codexTransport });

    try {
      const services = await runLayer(
        RuntimeLayer({
          adapter: "headless",
          configDir: temp.dir,
          configPath: temp.configPath,
          instrumentation: { record: () => {} },
          lspFactory: () => stubLspManager(),
          transportFactory: (_config, _resolver) => ({
            provider: providerTransport,
            codex: codexTransport,
            router: routerTransport,
          }),
        }),
      );

      expect(services.providerTransport).toBe(providerTransport);
      expect(services.codexTransport).toBe(codexTransport);
      expect(services.transport).toBe(routerTransport);
    } finally {
      await rm(temp.dir, { recursive: true, force: true });
    }
  });
});

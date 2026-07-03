import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { getModels } from "@yeshwanthyk/ai";
import { Effect } from "effect";
import { createProjectRuntimeBundle } from "../src/project-bundle.js";
import { createHookUIContext } from "../src/hooks/index.js";
import { createJsonlOwnershipIndex, JsonlOwnershipConflictError } from "../src/session/jsonl-ownership.js";
import { SessionManager } from "../src/session-manager.js";

const createTempConfig = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "project-bundle-"));
  await mkdir(path.join(dir, "hooks"), { recursive: true });
  await mkdir(path.join(dir, "tools"), { recursive: true });
  await mkdir(path.join(dir, "commands"), { recursive: true });

  const model = getModels("anthropic")[0];
  if (model === undefined) throw new Error("anthropic model fixture unavailable");
  const configPath = path.join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        provider: "anthropic",
        model: model.id,
        thinking: "medium",
        theme: "marvin",
      },
      null,
      2,
    ),
    "utf8",
  );

  return { dir, configPath, model };
};

const descriptor = (cwd: string, laneId: string, sessionId: string | null = null, sessionPath: string | null = null) => ({
  laneId,
  projectId: "project",
  cwd,
  sessionId,
  sessionPath,
});

describe("ProjectRuntimeBundle", () => {
  it("shares project resources while creating actor-owned services", async () => {
    const temp = await createTempConfig();
    const cwd = path.join(temp.dir, "project");
    try {
      await mkdir(cwd, { recursive: true });
      const bundle = await createProjectRuntimeBundle({
        configDir: temp.dir,
        configPath: temp.configPath,
        cwd,
        instrumentation: { record: () => {} },
      });

      const first = await bundle.createActorServices(descriptor(cwd, "lane-1"));
      const second = await bundle.createActorServices(descriptor(cwd, "lane-2"));

      expect(first.agent).not.toBe(second.agent);
      expect(first.sessionManager).not.toBe(second.sessionManager);
      expect(first.promptQueue).not.toBe(second.promptQueue);
      expect(first.sessionOrchestrator).not.toBe(second.sessionOrchestrator);
      expect(bundle.config).toBe(bundle.config);
      expect(bundle.transports.router).toBe(bundle.transports.router);
      expect(bundle.customCommands).toBe(bundle.customCommands);

      await first.close();
      await second.close();
      await bundle.close();
    } finally {
      await rm(temp.dir, { recursive: true, force: true });
    }
  });

  it("keeps hook context actor-local for concurrent actors", async () => {
    const temp = await createTempConfig();
    const cwd = path.join(temp.dir, "project");
    try {
      await mkdir(cwd, { recursive: true });
      const hookPath = path.join(temp.dir, "hooks", "record.ts");
      await writeFile(
        hookPath,
        `
export default function hook(marvin) {
  marvin.on("app.start", (_event, ctx) => {
    globalThis.__marvinHookEvents.push({ cwd: ctx.cwd, sessionId: ctx.sessionId })
  })
}
`,
        "utf8",
      );
      const events: Array<{ cwd: string; sessionId: string | null }> = [];
      Object.defineProperty(globalThis, "__marvinHookEvents", {
        value: events,
        configurable: true,
      });

      const bundle = await createProjectRuntimeBundle({
        configDir: temp.dir,
        configPath: temp.configPath,
        cwd,
        instrumentation: { record: () => {} },
      });
      const first = await bundle.createActorServices(descriptor(cwd, "lane-1"));
      const second = await bundle.createActorServices(descriptor(cwd, "lane-2"));
      first.sessionManager.startSession("anthropic", temp.model.id, "medium");
      second.sessionManager.startSession("anthropic", temp.model.id, "medium");
      const firstSessionId = first.sessionManager.sessionId;
      const secondSessionId = second.sessionManager.sessionId;

      await Effect.runPromise(first.hookContext.configure({
        sendHandler: () => {},
        sendMessageHandler: () => {},
        sendUserMessageHandler: () => {},
        steerHandler: () => {},
        followUpHandler: () => {},
        isIdleHandler: () => true,
        appendEntryHandler: () => {},
        getSessionId: () => first.sessionManager.sessionId,
        getModel: () => first.agent.state.model,
      }));
      await Effect.runPromise(second.hookContext.configure({
        sendHandler: () => {},
        sendMessageHandler: () => {},
        sendUserMessageHandler: () => {},
        steerHandler: () => {},
        followUpHandler: () => {},
        isIdleHandler: () => true,
        appendEntryHandler: () => {},
        getSessionId: () => second.sessionManager.sessionId,
        getModel: () => second.agent.state.model,
      }));

      events.length = 0;
      await Promise.all([
        first.hookRunner.emit({ type: "app.start" }),
        second.hookRunner.emit({ type: "app.start" }),
      ]);

      expect(events).toContainEqual({ cwd, sessionId: firstSessionId });
      expect(events).toContainEqual({ cwd, sessionId: secondSessionId });
      expect(first.hookRunner).not.toBe(second.hookRunner);

      await first.close();
      await second.close();
      await bundle.close();
      delete globalThis.__marvinHookEvents;
    } finally {
      await rm(temp.dir, { recursive: true, force: true });
    }
  });

  it("rejects a second actor for an owned session JSONL", async () => {
    const temp = await createTempConfig();
    const cwd = path.join(temp.dir, "project");
    try {
      await mkdir(cwd, { recursive: true });
      const seed = new SessionManager(temp.dir, cwd);
      const sessionId = seed.startSession("anthropic", temp.model.id, "medium");
      const sessionPath = seed.sessionPath;
      if (sessionPath === null) throw new Error("session path fixture unavailable");

      const ownership = createJsonlOwnershipIndex();
      const bundle = await createProjectRuntimeBundle({
        configDir: temp.dir,
        configPath: temp.configPath,
        cwd,
        jsonlOwnership: ownership,
        instrumentation: { record: () => {} },
      });
      const first = await bundle.createActorServices(descriptor(cwd, "lane-1", sessionId, sessionPath));
      await expect(bundle.createActorServices(descriptor(cwd, "lane-2", sessionId, sessionPath)))
        .rejects.toBeInstanceOf(JsonlOwnershipConflictError);

      await first.close();
      await bundle.close();
    } finally {
      await rm(temp.dir, { recursive: true, force: true });
    }
  });

  it("routes hidden interactive hook prompts through actor UI policy", async () => {
    const temp = await createTempConfig();
    const cwd = path.join(temp.dir, "project");
    try {
      await mkdir(cwd, { recursive: true });
      await writeFile(
        path.join(temp.dir, "hooks", "prompt.ts"),
        `
export default function hook(marvin) {
  marvin.on("app.start", async (_event, ctx) => {
    await ctx.ui.input("Hidden approval", "decision")
  })
}
`,
        "utf8",
      );
      const prompts: string[] = [];
      const bundle = await createProjectRuntimeBundle({
        configDir: temp.dir,
        configPath: temp.configPath,
        cwd,
        instrumentation: { record: () => {} },
      });

      const services = await bundle.createActorServices(descriptor(cwd, "lane-hidden"), {
        hasUI: false,
        hookUIContext: createHookUIContext({
          setEditorText: () => {},
          getEditorText: () => "",
          showSelect: async () => undefined,
          showInput: async (title) => {
            prompts.push(title);
            return undefined;
          },
          showConfirm: async () => false,
          showNotify: () => {},
        }),
      });

      expect(prompts).toEqual(["Hidden approval"]);

      await services.close();
      await bundle.close();
    } finally {
      await rm(temp.dir, { recursive: true, force: true });
    }
  });
});

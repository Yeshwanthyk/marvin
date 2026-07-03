import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getApiKey, getModels } from "@yeshwanthyk/ai";
import { loadAppConfig } from "../src/config.js";

const getAnthropicModel = () => {
  const models = getModels("anthropic");
  if (models.length === 0) {
    throw new Error("No anthropic models available");
  }
  return models[0];
};

const writeConfig = async (dir: string, modelId: string) => {
  const configPath = path.join(dir, "config.json");
  const payload = {
    provider: "anthropic",
    model: modelId,
    thinking: "medium",
    theme: "marvin",
  };
  await writeFile(configPath, JSON.stringify(payload, null, 2), "utf8");
  return configPath;
};

describe("loadAppConfig", () => {
  it("resolves project AGENTS.md using explicit cwd", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-cwd-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-cwd-"));
    try {
      const model = getAnthropicModel();
      const configPath = await writeConfig(configDir, model.id);
      const agentsPath = path.join(projectDir, "AGENTS.md");
      await writeFile(agentsPath, "project agents", "utf8");

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
      });

      expect(config.agentsConfig.project?.path).toBe(agentsPath);
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("uses systemPrompt override before appending agents", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-prompt-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-prompt-"));
    try {
      const model = getAnthropicModel();
      const configPath = await writeConfig(configDir, model.id);

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
        systemPrompt: "Override prompt",
      });

      expect(config.systemPrompt.startsWith("Override prompt")).toBe(true);
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("adds Marvin docs paths to the default system prompt", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-docs-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-docs-"));
    try {
      const model = getAnthropicModel();
      const configPath = await writeConfig(configDir, model.id);

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
        docs: {
          readmePath: "/marvin/README.md",
          docsPath: "/marvin/docs",
          examplesPath: "/marvin/examples",
        },
      });

      expect(config.systemPrompt).toContain("Marvin documentation");
      expect(config.systemPrompt).toContain("/marvin/docs");
      expect(config.systemPrompt).toContain("docs/extensions.md");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("ignores stale lsp config", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-stale-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-stale-"));
    try {
      const model = getAnthropicModel();
      const configPath = path.join(configDir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify(
          {
            provider: "anthropic",
            model: model.id,
            lsp: { enabled: true, autoInstall: false },
          },
          null,
          2,
        ),
        "utf8",
      );

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
      });

      expect("lsp" in config).toBe(false);
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("loads default lane keymap config", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-keymap-default-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-keymap-default-"));
    try {
      const model = getAnthropicModel();
      const configPath = await writeConfig(configDir, model.id);

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
      });

      expect(config.keymap.lanes.activation).toEqual({
        behavior: "sticky",
        enter: ["escape", "ctrl+["],
        exit: ["return"],
      });
      expect(config.keymap.lanes.prefixKey).toEqual(["ctrl+b"]);
      expect(config.keymap.lanes.bindings.sessionPrev).toEqual(["shift+left"]);
      expect(config.keymap.lanes.bindings.projectNext).toEqual(["shift+down"]);
      expect(config.keymap.lanes.bindings.moveSessionPrev).toEqual(["shift+left", "shift+h"]);
      expect(config.keymap.lanes.bindings.newSession).toEqual(["n"]);
      expect(config.keymap.lanes.bindings.jumpProject9).toEqual(["9"]);
      expect(config.keymap.lanes.bindings.restore).toEqual(["mod+shift+r", "super+shift+r", "ctrl+shift+r"]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("parses workspace project roots", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-workspace-roots-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-workspace-roots-"));
    try {
      const model = getAnthropicModel();
      const configPath = path.join(configDir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify(
          {
            provider: "anthropic",
            model: model.id,
            workspace: {
              projectRoots: [
                "~/code",
                { path: "~/Documents/work", depth: 2 },
                { path: "", depth: 1 },
              ],
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
      });

      expect(config.workspace.projectRoots).toEqual([
        { path: "~/code", depth: 1 },
        { path: "~/Documents/work", depth: 2 },
      ]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("parses custom lane keymap config and normalizes common aliases", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-keymap-custom-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-keymap-custom-"));
    try {
      const model = getAnthropicModel();
      const configPath = path.join(configDir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify(
          {
            provider: "anthropic",
            model: model.id,
            keymap: {
              lanes: {
                prefixKey: "Ctrl+G",
                activation: {
                  behavior: "oneshot",
                  prefix: ["Ctrl+["],
                  cancel: "Enter",
                },
                bindings: {
                  sessionPrev: ["h"],
                  sessionNext: ["l"],
                  projectPrev: ["k"],
                  projectNext: ["j"],
                  moveSessionPrev: ["Shift+H"],
                  moveSessionNext: ["Shift+L"],
                  moveProjectPrev: ["Shift+K"],
                  moveProjectNext: ["Shift+J"],
                  overview: "O",
                  newSession: "N",
                  rename: "$",
                  jump: ["Cmd+K"],
                  jumpProject3: "3",
                  archive: ["Cmd+Shift+A"],
                  restore: ["Cmd+Shift+R"],
                },
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
      });

      expect(config.keymap.lanes.activation).toEqual({
        behavior: "oneshot",
        prefix: ["ctrl+[", "escape"],
        cancel: ["return"],
      });
      expect(config.keymap.lanes.prefixKey).toEqual(["ctrl+g"]);
      expect(config.keymap.lanes.bindings).toEqual({
        sessionPrev: ["h"],
        sessionNext: ["l"],
        projectPrev: ["k"],
        projectNext: ["j"],
        moveSessionPrev: ["shift+h"],
        moveSessionNext: ["shift+l"],
        moveProjectPrev: ["shift+k"],
        moveProjectNext: ["shift+j"],
        overview: ["o"],
        newSession: ["n"],
        rename: ["$"],
        jump: ["mod+k"],
        jumpProject1: ["1"],
        jumpProject2: ["2"],
        jumpProject3: ["3"],
        jumpProject4: ["4"],
        jumpProject5: ["5"],
        jumpProject6: ["6"],
        jumpProject7: ["7"],
        jumpProject8: ["8"],
        jumpProject9: ["9"],
        archive: ["mod+shift+a"],
        restore: ["mod+shift+r"],
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("accepts comma-separated model list and uses first entry", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-model-list-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-model-list-"));
    try {
      const model = getAnthropicModel();
      const configPath = await writeConfig(configDir, model.id);

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
        model: `${model.id},${model.id}`,
      });

      expect(config.modelId).toBe(model.id);
      expect(config.provider).toBe("anthropic");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("accepts provider-prefixed model list entries", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-model-prefix-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-model-prefix-"));
    try {
      const model = getAnthropicModel();
      const configPath = await writeConfig(configDir, model.id);

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
        model: `anthropic/${model.id},${model.id}`,
      });

      expect(config.modelId).toBe(model.id);
      expect(config.provider).toBe("anthropic");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("accepts Pi provider aliases", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-pi-alias-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-pi-alias-"));
    try {
      const config = await loadAppConfig({
        configDir,
        cwd: projectDir,
        provider: "openai-codex",
        model: "gpt-5.5",
      });

      expect(config.provider).toBe("codex");
      expect(config.modelId).toBe("gpt-5.5");
      expect(config.model.provider).toBe("codex");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("loads Pi-style custom model providers from Marvin models.json", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-custom-models-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-custom-models-"));
    const provider = `vibeproxy-test-${Date.now()}`;
    try {
      await writeFile(
        path.join(configDir, "models.json"),
        JSON.stringify(
          {
            providers: {
              [provider]: {
                baseUrl: "http://localhost:8317",
                api: "anthropic-messages",
                apiKey: "dummy",
                models: [
                  {
                    id: "claude-opus-4-7",
                    name: "VP Claude Opus 4.7",
                    reasoning: true,
                    input: ["text", "image"],
                    contextWindow: 200000,
                    maxTokens: 64000,
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const config = await loadAppConfig({
        configDir,
        cwd: projectDir,
        model: `${provider}/claude-opus-4-7`,
      });

      expect(config.provider).toBe(provider);
      expect(config.model.provider).toBe(provider);
      expect(config.model.api).toBe("anthropic-messages");
      expect(config.model.baseUrl).toBe("http://localhost:8317");
      expect(config.model.reasoning).toBe(true);
      expect(config.model.input).toEqual(["text", "image"]);
      expect(config.model.contextWindow).toBe(200000);
      expect(config.model.maxTokens).toBe(64000);
      expect(getApiKey(provider)).toBe("dummy");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("resolves Pi-style custom provider auth, headers, and compat", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-custom-auth-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-custom-auth-"));
    const provider = `custom-auth-${Date.now()}`;
    const keyEnv = `${provider.replace(/-/g, "_").toUpperCase()}_KEY`;
    const headerEnv = `${provider.replace(/-/g, "_").toUpperCase()}_HEADER`;
    process.env[keyEnv] = "resolved-key";
    process.env[headerEnv] = "resolved-header";
    try {
      await writeFile(
        path.join(configDir, "models.json"),
        JSON.stringify(
          {
            providers: {
              [provider]: {
                baseUrl: "http://localhost:8317",
                api: "anthropic-messages",
                apiKey: keyEnv,
                authHeader: true,
                headers: { "X-Provider": headerEnv },
                compat: { supportsEagerToolInputStreaming: false },
                models: [
                  {
                    id: "claude-opus-4-7",
                    headers: { "X-Model": "literal-model-header" },
                    compat: { supportsLongCacheRetention: true },
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const config = await loadAppConfig({
        configDir,
        cwd: projectDir,
        model: `${provider}/claude-opus-4-7`,
      });

      expect(getApiKey(provider)).toBe("resolved-key");
      expect(config.model.headers).toEqual({
        "X-Provider": "resolved-header",
        Authorization: "Bearer resolved-key",
        "X-Model": "literal-model-header",
      });
      expect(config.model.compat).toEqual({
        supportsEagerToolInputStreaming: false,
        supportsLongCacheRetention: true,
      });
    } finally {
      delete process.env[keyEnv];
      delete process.env[headerEnv];
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

});

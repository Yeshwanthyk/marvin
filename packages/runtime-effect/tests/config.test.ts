import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getModels } from "@marvin-agents/ai";
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
    lsp: { enabled: true, autoInstall: true },
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

  it("allows LoadConfigOptions to override lsp settings", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "config-lsp-"));
    const projectDir = await mkdtemp(path.join(tmpdir(), "project-lsp-"));
    try {
      const model = getAnthropicModel();
      const configPath = await writeConfig(configDir, model.id);

      const config = await loadAppConfig({
        configDir,
        configPath,
        cwd: projectDir,
        lsp: { enabled: false, autoInstall: false },
      });

      expect(config.lsp).toEqual({ enabled: false, autoInstall: false });
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

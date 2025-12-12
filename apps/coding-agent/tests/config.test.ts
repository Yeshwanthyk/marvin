import { describe, it, expect } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { loadAppConfig } from "../src/config";

describe("coding-agent config overrides", () => {
  it("allows running without config file when provider+model are provided", async () => {
    const configDir = path.join(os.tmpdir(), `mu-agent-no-config-${Date.now()}`);
    const loaded = await loadAppConfig({ configDir, provider: "openai", model: "gpt-4.1" });
    expect(loaded.agentConfig.provider).toBe("openai");
    expect(loaded.agentConfig.model).toBe("gpt-4.1");
  });

  it("CLI overrides config file values", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "mu-agent-config-"));
    await fs.writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify(
        {
          config: { provider: "anthropic", model: "claude-3-5-sonnet" },
          thinking: "off",
        },
        null,
        2
      )
    );

    const loaded = await loadAppConfig({
      configDir,
      provider: "openai",
      model: "gpt-4.1",
      thinking: "high",
    });

    expect(loaded.agentConfig.provider).toBe("openai");
    expect(loaded.agentConfig.model).toBe("gpt-4.1");
    expect(loaded.thinking).toBe("high");
  });
});


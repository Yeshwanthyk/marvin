import { describe, it, expect } from "bun:test";
import { parseArgs } from "../src/args";

describe("coding-agent args", () => {
  it("parses headless and prompt", () => {
    const args = parseArgs(["--headless", "hello", "world"]);
    expect(args.headless).toBe(true);
    expect(args.prompt).toBe("hello world");
  });

  it("parses config flags", () => {
    const args = parseArgs(["--config-dir", "x", "--config", "y"]);
    expect(args.configDir).toBe("x");
    expect(args.configPath).toBe("y");
  });

  it("parses provider/model/thinking", () => {
    const args = parseArgs(["--provider", "openai", "--model", "gpt-4.1", "--thinking", "high"]);
    expect(args.provider).toBe("openai");
    expect(args.model).toBe("gpt-4.1");
    expect(args.thinking).toBe("high");
  });

  it("parses help/version short flags", () => {
    const args = parseArgs(["-h", "-v"]);
    expect(args.help).toBe(true);
    expect(args.version).toBe(true);
  });
});

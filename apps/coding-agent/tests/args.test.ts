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
});


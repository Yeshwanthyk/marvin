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

  it("parses session flags -c and -r", () => {
    const args1 = parseArgs(["-c"]);
    expect(args1.continue).toBe(true);
    expect(args1.resume).toBe(false);
    
    const args2 = parseArgs(["--continue"]);
    expect(args2.continue).toBe(true);
    
    const args3 = parseArgs(["-r"]);
    expect(args3.resume).toBe(true);
    expect(args3.continue).toBe(false);
    
    const args4 = parseArgs(["--resume"]);
    expect(args4.resume).toBe(true);
  });

  it("parses --open flag for OpenTUI", () => {
    const args = parseArgs(["--open"]);
    expect(args.open).toBe(true);
    expect(args.headless).toBe(false);
    
    const args2 = parseArgs(["--open", "--provider", "anthropic"]);
    expect(args2.open).toBe(true);
    expect(args2.provider).toBe("anthropic");
  });
});

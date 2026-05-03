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

  it("parses comma-separated thinking levels", () => {
    const args = parseArgs(["--model", "codex/gpt-5.5,vibeproxy-anthropic/claude-opus-4-7", "--thinking", "low,high"]);
    expect(args.model).toBe("codex/gpt-5.5,vibeproxy-anthropic/claude-opus-4-7");
    expect(args.thinking).toBe("low,high");
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

  it("detects validate subcommand", () => {
    const args = parseArgs(["validate", "--config-dir", "/tmp/config"]);
    expect(args.command).toBe("validate");
    expect(args.configDir).toBe("/tmp/config");
    expect(args.prompt).toBeUndefined();
  });

  it("detects install subcommand", () => {
    const args = parseArgs(["install", "npm:pi-web-access", "--config-dir", "/tmp/config"]);
    expect(args.command).toBe("install");
    expect(args.configDir).toBe("/tmp/config");
    expect(args.prompt).toBe("npm:pi-web-access");
  });

  it("does not consume following flags as option values", () => {
    const args = parseArgs(["--model", "--headless", "hello"]);
    expect(args.model).toBeUndefined();
    expect(args.headless).toBe(true);
    expect(args.prompt).toBe("--model hello");
  });

  it("keeps missing option values in prompt for visibility", () => {
    const args = parseArgs(["--provider"]);
    expect(args.provider).toBeUndefined();
    expect(args.prompt).toBe("--provider");
  });

  it("does not skip flags after missing thinking value", () => {
    const args = parseArgs(["--thinking", "--headless"]);
    expect(args.thinking).toBeUndefined();
    expect(args.headless).toBe(true);
    expect(args.prompt).toBe("--thinking");
  });

  it("parses extension flags", () => {
    const args = parseArgs(["-e", "./one.ts", "--extension", "./two", "--no-extensions"]);
    expect(args.extensions).toEqual(["./one.ts", "./two"]);
    expect(args.noExtensions).toBe(true);
  });
});

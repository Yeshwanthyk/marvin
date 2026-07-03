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

  it("detects session rename subcommand", () => {
    const args = parseArgs(["session", "rename", "fix", "lane", "navigation", "--session", "b17f0285"]);
    expect(args.command).toBe("session");
    expect(args.sessionAction).toBe("rename");
    expect(args.session).toBe("b17f0285");
    expect(args.prompt).toBe("fix lane navigation");
  });

  it("detects scratchpad subcommands and options", () => {
    const args = parseArgs([
      "scratchpad",
      "add",
      "--title",
      "fix auth flow",
      "--cwd",
      "/work/nora",
      "--tag",
      "auth",
      "--tag",
      "handoff",
      "--json",
      "body",
      "text",
    ]);
    expect(args.command).toBe("scratchpad");
    expect(args.scratchpadAction).toBe("add");
    expect(args.title).toBe("fix auth flow");
    expect(args.cwd).toBe("/work/nora");
    expect(args.tags).toEqual(["auth", "handoff"]);
    expect(args.json).toBe(true);
    expect(args.prompt).toBe("body text");
  });

  it("parses scratchpad list flags", () => {
    const args = parseArgs(["scratchpad", "list", "--all", "--json"]);
    expect(args.command).toBe("scratchpad");
    expect(args.scratchpadAction).toBe("list");
    expect(args.all).toBe(true);
    expect(args.json).toBe(true);
  });

  it("detects cockpit subcommands and agent selector", () => {
    const args = parseArgs(["cockpit", "install", "--agent", "codex"]);
    expect(args.command).toBe("cockpit");
    expect(args.cockpitAction).toBe("install");
    expect(args.agent).toBe("codex");
    expect(args.prompt).toBeUndefined();
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

  it("keeps missing cockpit agent value in prompt for visibility", () => {
    const args = parseArgs(["cockpit", "status", "--agent"]);
    expect(args.command).toBe("cockpit");
    expect(args.cockpitAction).toBe("status");
    expect(args.agent).toBeUndefined();
    expect(args.prompt).toBe("--agent");
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

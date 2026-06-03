import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createScratchpadStore } from "@yeshwanthyk/runtime-effect/scratchpads.js";
import { runScratchpadCommand } from "../src/adapters/cli/scratchpad.js";

describe("scratchpad CLI", () => {
  it("adds a scratchpad from prompt body", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "marvin-scratchpad-cli-"));
    const output: string[] = [];
    try {
      process.exitCode = undefined;
      await runScratchpadCommand({
        action: "add",
        title: "fix auth flow",
        body: "reproduce the failed handoff",
        cwd: "/work/nora",
        tags: ["auth"],
        configDir: dir,
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
      });

      const items = createScratchpadStore(dir).list({ cwd: "/work/nora" });
      expect(process.exitCode).toBeUndefined();
      expect(output.join("")).toContain("Saved scratchpad: fix auth flow");
      expect(items).toHaveLength(1);
      expect(items[0]?.title).toBe("fix auth flow");
      expect(items[0]?.tags).toEqual(["auth"]);
    } finally {
      process.exitCode = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists, reads, and archives scratchpads", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "marvin-scratchpad-cli-"));
    const output: string[] = [];
    try {
      const store = createScratchpadStore(dir);
      const item = store.add({ cwd: "/work/nora", title: "review search jump", body: "Check command palette filtering." });

      process.exitCode = undefined;
      await runScratchpadCommand({
        action: "list",
        configDir: dir,
        json: true,
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
      });
      expect(JSON.parse(output.pop() ?? "[]")).toMatchObject([{ id: item.id, title: "review search jump" }]);

      await runScratchpadCommand({
        action: "read",
        body: item.id.slice(0, 8),
        configDir: dir,
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
      });
      expect(output.pop()).toContain("Check command palette filtering.");

      await runScratchpadCommand({
        action: "archive",
        body: item.id.slice(0, 8),
        configDir: dir,
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
      });
      expect(store.list()).toEqual([]);
      expect(store.list({ includeArchived: true })[0]?.status).toBe("archived");
    } finally {
      process.exitCode = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads add body from stdin when no prompt body is provided", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "marvin-scratchpad-cli-"));
    try {
      await runScratchpadCommand({
        action: "add",
        title: "save stdin note",
        configDir: dir,
        stdin: async () => "body from stdin",
        stdout: () => {},
        stderr: () => {},
      });
      expect(createScratchpadStore(dir).list()[0]?.bodyPreview).toBe("body from stdin");
    } finally {
      process.exitCode = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

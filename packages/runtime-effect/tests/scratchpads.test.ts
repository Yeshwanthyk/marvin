import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createScratchpadStore, scratchpadIndexPath, scratchpadRootPath } from "../src/scratchpads.js";

describe("scratchpads", () => {
  it("adds, lists, and reads scratchpad bodies under config dir", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "marvin-scratchpads-"));
    try {
      const store = createScratchpadStore(dir);
      const item = store.add({
        cwd: "/work/nora",
        title: "fix auth flow",
        body: "Look into session handoff\nand save the exact failure.",
        tags: [" Auth ", "handoff", "auth"],
        source: { kind: "cli" },
      });

      expect(item.cwd).toBe("/work/nora");
      expect(item.title).toBe("fix auth flow");
      expect(item.tags).toEqual(["auth", "handoff"]);
      expect(item.status).toBe("open");
      expect(item.bodyPath.startsWith(scratchpadRootPath(dir))).toBe(true);
      expect(item.bodyPath).toContain(path.join("scratchpad", "work", "nora"));
      expect(existsSync(scratchpadIndexPath(dir))).toBe(true);
      expect(readFileSync(item.bodyPath, "utf8")).toBe("Look into session handoff\nand save the exact failure.\n");

      expect(store.list()).toEqual([item]);
      expect(store.list({ cwd: "/work/other" })).toEqual([]);
      expect(store.read(item.id)).toEqual({
        item,
        body: "Look into session handoff\nand save the exact failure.",
      });
      expect(store.read(item.id.slice(0, 8)).item.id).toBe(item.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("archives and marks triggered scratchpads", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "marvin-scratchpads-"));
    try {
      const store = createScratchpadStore(dir);
      const item = store.add({ cwd: "/work/nora", title: "start migration plan", body: "Draft the first pass." });

      const triggered = store.markTriggered(item.id, "session-a");
      expect(triggered.status).toBe("triggered");
      expect(triggered.triggeredSessionId).toBe("session-a");
      expect(triggered.triggeredAt).toBeDefined();
      expect(store.list().map((entry) => entry.id)).toEqual([item.id]);

      const archived = store.archive(item.id);
      expect(archived.status).toBe("archived");
      expect(store.list()).toEqual([]);
      expect(store.list({ includeArchived: true }).map((entry) => entry.status)).toEqual(["archived"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects empty titles and bodies", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "marvin-scratchpads-"));
    try {
      const store = createScratchpadStore(dir);
      expect(() => store.add({ cwd: "/work/nora", title: " ", body: "body" })).toThrow("title");
      expect(() => store.add({ cwd: "/work/nora", title: "title", body: " " })).toThrow("body");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

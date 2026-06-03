import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "../src/session-manager.js";

describe("SessionManager cwd isolation", () => {
  it("stores sessions under the runtime cwd instead of ambient process cwd", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "session-cwd-"));
    try {
      const projectA = new SessionManager(dir, "/work/project-a");
      const projectB = new SessionManager(dir, "/work/project-b");

      const idA = projectA.startSession("anthropic", "claude-test", "off");
      const idB = projectB.startSession("openai", "gpt-test", "low");

      expect(projectA.projectCwd).toBe("/work/project-a");
      expect(projectB.projectCwd).toBe("/work/project-b");
      expect(projectA.listSessions().map((session) => session.id)).toEqual([idA]);
      expect(projectB.listSessions().map((session) => session.id)).toEqual([idB]);

      const loadedA = projectA.loadLatest();
      const loadedB = projectB.loadLatest();
      expect(loadedA?.metadata.cwd).toBe("/work/project-a");
      expect(loadedB?.metadata.cwd).toBe("/work/project-b");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

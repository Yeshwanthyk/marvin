import { describe, expect, it } from "bun:test";
import type { AppMessage } from "@yeshwanthyk/agent-core";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager, type SessionEntry, type SessionNodeEntry } from "../src/session-manager.js";

function isNodeEntry(entry: SessionEntry): entry is SessionNodeEntry {
  return entry.type === "message" || entry.type === "custom";
}

async function readNodeEntries(sessionPath: string): Promise<SessionNodeEntry[]> {
  const content = await readFile(sessionPath, "utf8");
  return content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as SessionEntry)
    .filter(isNodeEntry);
}

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

  it("keeps appended node ids unique after continuing a session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "session-ids-"));
    try {
      const firstManager = new SessionManager(dir, "/work/project");
      const sessionId = firstManager.startSession("anthropic", "claude-test", "off");
      const sessionPath = firstManager.sessionPath;
      if (!sessionPath) throw new Error("expected session path");

      const firstMessage: AppMessage = {
        role: "user",
        content: [{ type: "text", text: "first" }],
        timestamp: Date.now(),
      };
      firstManager.appendMessage(firstMessage);

      const continuedManager = new SessionManager(dir, "/work/project");
      continuedManager.continueSession(sessionPath, sessionId);
      continuedManager.appendEntry("marker", { ok: true });

      const secondMessage: AppMessage = {
        role: "user",
        content: [{ type: "text", text: "second" }],
        timestamp: Date.now(),
      };
      continuedManager.appendMessage(secondMessage);

      const nodes = await readNodeEntries(sessionPath);
      const ids = nodes.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(nodes.map((entry) => entry.parentId)).toEqual([null, ids[0], ids[1]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

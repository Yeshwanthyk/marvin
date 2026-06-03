import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionInfo } from "../src/session-manager.js";
import {
  activeSessionLanes,
  archiveSessionLane,
  findActiveCursor,
  moveLaneCursor,
  readWorkspaceLanes,
  renameSessionLane,
  restoreSessionLane,
  selectLane,
  upsertProjectLane,
  upsertSessionLane,
  writeWorkspaceLanes,
} from "../src/workspace-lanes.js";

const sessionInfo = (id: string, cwd: string, timestamp: number): SessionInfo => ({
  id,
  timestamp,
  path: path.join(cwd, `${id}.jsonl`),
  provider: "anthropic",
  modelId: "claude-test",
  cwd,
});

describe("workspace lanes", () => {
  it("persists projects, sessions, and active selection", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-lanes-"));
    try {
      const lanes = readWorkspaceLanes(dir);
      const project = upsertProjectLane(lanes, "/work/project-a", "2026-06-03T00:00:00.000Z");
      const session = upsertSessionLane(
        lanes,
        project,
        sessionInfo("session-a", project.cwd, Date.parse("2026-06-03T00:00:00.000Z")),
        "session a",
        "2026-06-03T00:00:01.000Z",
      );

      writeWorkspaceLanes(dir, selectLane(lanes, { project, session }));

      const loaded = readWorkspaceLanes(dir);
      expect(loaded.projects).toHaveLength(1);
      expect(loaded.sessions).toHaveLength(1);
      expect(loaded.selection).toEqual({ projectId: project.id, sessionLaneId: session.id });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renames a session lane without changing blank titles", () => {
    const lanes = readWorkspaceLanes("/missing");
    const project = upsertProjectLane(lanes, "/work/a", "2026-06-03T00:00:00.000Z");
    const session = upsertSessionLane(lanes, project, sessionInfo("session-a", project.cwd, 1), "old", "2026-06-03T00:00:01.000Z");

    const renamed = renameSessionLane(lanes, session.id, "  new title  ", "2026-06-03T00:00:02.000Z");
    expect(renamed.sessions.find((entry) => entry.id === session.id)?.title).toBe("new title");
    expect(renamed.sessions.find((entry) => entry.id === session.id)?.updatedAt).toBe("2026-06-03T00:00:02.000Z");

    const unchanged = renameSessionLane(renamed, session.id, "   ", "2026-06-03T00:00:03.000Z");
    expect(unchanged.sessions.find((entry) => entry.id === session.id)?.title).toBe("new title");
    expect(unchanged.sessions.find((entry) => entry.id === session.id)?.updatedAt).toBe("2026-06-03T00:00:02.000Z");
  });

  it("moves left-right within sessions and up-down between projects", () => {
    const lanes = readWorkspaceLanes("/missing");
    const projectA = upsertProjectLane(lanes, "/work/a", "2026-06-03T00:00:00.000Z");
    const projectB = upsertProjectLane(lanes, "/work/b", "2026-06-03T00:00:00.000Z");
    const a1 = upsertSessionLane(lanes, projectA, sessionInfo("a1", projectA.cwd, 1), "a1", "2026-06-03T00:00:01.000Z");
    const a2 = upsertSessionLane(lanes, projectA, sessionInfo("a2", projectA.cwd, 2), "a2", "2026-06-03T00:00:02.000Z");
    const b1 = upsertSessionLane(lanes, projectB, sessionInfo("b1", projectB.cwd, 3), "b1", "2026-06-03T00:00:03.000Z");
    const selected = selectLane(lanes, { project: projectA, session: a2 });

    expect(moveLaneCursor(selected, "right")?.session.id).toBe(a1.id);
    expect(moveLaneCursor(selected, "left")?.session.id).toBe(a1.id);
    expect(moveLaneCursor(selected, "down")?.session.id).toBe(b1.id);
    expect(moveLaneCursor(selectLane(lanes, { project: projectB, session: b1 }), "up")?.session.id).toBe(a2.id);
  });

  it("excludes archived sessions from active movement and restores them", () => {
    const lanes = readWorkspaceLanes("/missing");
    const project = upsertProjectLane(lanes, "/work/a", "2026-06-03T00:00:00.000Z");
    const first = upsertSessionLane(lanes, project, sessionInfo("first", project.cwd, 1), "first", "2026-06-03T00:00:01.000Z");
    const second = upsertSessionLane(lanes, project, sessionInfo("second", project.cwd, 2), "second", "2026-06-03T00:00:02.000Z");

    const archived = archiveSessionLane(selectLane(lanes, { project, session: second }), second.id, "2026-06-03T00:00:03.000Z");
    expect(activeSessionLanes(archived).map((session) => session.id)).toEqual([first.id]);
    expect(findActiveCursor(archived)?.session.id).toBe(first.id);

    const restored = restoreSessionLane(archived, second.id, "2026-06-03T00:00:04.000Z");
    expect(activeSessionLanes(restored).map((session) => session.id)).toEqual([second.id, first.id]);
  });
});

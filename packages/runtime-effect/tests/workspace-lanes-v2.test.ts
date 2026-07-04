import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WorkspaceLanes } from "../src/workspace-lanes.js";
import { writeWorkspaceLanes, workspaceLanesPath } from "../src/workspace-lanes.js";
import {
  activeSessionIdsForProject,
  createWorkspaceLaneStore,
  emptyWorkspaceLanesV2,
  focusCursor,
  loadWorkspaceLanesV2,
  moveSessionToProject,
  reduceWorkspaceLanePatch,
  reduceWorkspaceLanePatches,
  reorderSession,
  workspaceLanesV2Path,
  workspaceLanesV2TempPath,
  type LaneId,
  type ProjectId,
  type SessionLaneInput,
  type WorkspaceLanesV2,
} from "../src/workspace-lanes-v2.js";

const now = "2026-06-03T00:00:00.000Z";

const sessionInput = (laneId: LaneId, projectId: ProjectId, updatedAt: string = now): SessionLaneInput => ({
  laneId,
  projectId,
  sessionId: `${laneId}-session`,
  sessionPath: `/sessions/${laneId}.jsonl`,
  title: laneId,
  provider: "anthropic",
  modelId: "claude-test",
  createdAt: now,
  updatedAt,
});

const withProject = (lanes: WorkspaceLanesV2, projectId: ProjectId): WorkspaceLanesV2 =>
  reduceWorkspaceLanePatch(lanes, {
    type: "upsertProject",
    project: {
      id: projectId,
      cwd: projectId,
      title: projectId.split("/").filter(Boolean).at(-1) ?? projectId,
      createdAt: now,
      updatedAt: now,
    },
  });

const fixture = (): WorkspaceLanesV2 =>
  reduceWorkspaceLanePatches(emptyWorkspaceLanesV2(), [
    { type: "upsertProject", project: { id: "/work/a", cwd: "/work/a", title: "a", createdAt: now, updatedAt: now } },
    { type: "upsertProject", project: { id: "/work/b", cwd: "/work/b", title: "b", createdAt: now, updatedAt: now } },
    { type: "upsertProject", project: { id: "/work/c", cwd: "/work/c", title: "c", createdAt: now, updatedAt: now } },
    { type: "upsertSession", session: sessionInput("a1", "/work/a"), insert: { type: "end", projectId: "/work/a" } },
    { type: "upsertSession", session: sessionInput("a2", "/work/a"), insert: { type: "end", projectId: "/work/a" } },
    { type: "upsertSession", session: sessionInput("b1", "/work/b"), insert: { type: "end", projectId: "/work/b" } },
    { type: "upsertSession", session: sessionInput("b2", "/work/b"), insert: { type: "end", projectId: "/work/b" } },
    { type: "upsertSession", session: sessionInput("c1", "/work/c"), insert: { type: "end", projectId: "/work/c" } },
    { type: "select", projectId: "/work/a", laneId: "a1" },
  ]);

describe("workspace lanes v2", () => {
  it("migrates a v1 fixture with preserved project order, selected lane, and updatedAt-desc session seed order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-lanes-v2-"));
    try {
      const v1: WorkspaceLanes = {
        version: 1,
        projects: [
          { id: "/work/a", cwd: "/work/a", title: "a", updatedAt: "2026-06-03T00:00:00.000Z" },
          { id: "/work/b", cwd: "/work/b", title: "b", updatedAt: "2026-06-03T00:00:00.000Z" },
        ],
        sessions: [
          {
            id: "/work/a:a-old",
            projectId: "/work/a",
            sessionId: "a-old",
            sessionPath: "/work/a/a-old.jsonl",
            title: "old",
            provider: "anthropic",
            modelId: "claude-test",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:01.000Z",
          },
          {
            id: "/work/a:a-new",
            projectId: "/work/a",
            sessionId: "a-new",
            sessionPath: "/work/a/a-new.jsonl",
            title: "new",
            provider: "anthropic",
            modelId: "claude-test",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:03.000Z",
          },
          {
            id: "/work/b:b-only",
            projectId: "/work/b",
            sessionId: "b-only",
            sessionPath: "/work/b/b-only.jsonl",
            title: "b",
            provider: "anthropic",
            modelId: "claude-test",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:02.000Z",
          },
        ],
        selection: { projectId: "/work/a", sessionLaneId: "/work/a:a-old" },
      };
      writeWorkspaceLanes(dir, v1);

      const result = loadWorkspaceLanesV2(dir);
      expect(result.migrated).toBe(true);
      expect(result.droppedSessionIds).toEqual([]);
      expect(result.lanes.projectOrder).toEqual(["/work/a", "/work/b"]);
      const projectAOrder = result.lanes.sessionOrderByProject["/work/a"] ?? [];
      const projectASessions = projectAOrder.map((laneId) => result.lanes.sessionsById[laneId]?.sessionId);
      expect(projectASessions).toEqual(["a-new", "a-old"]);
      expect(result.lanes.selection?.projectId).toBe("/work/a");
      const selected = result.lanes.selection ? result.lanes.sessionsById[result.lanes.selection.laneId] : undefined;
      expect(selected?.sessionId).toBe("a-old");
      expect(result.lanes.selection?.laneId).not.toBe("/work/a:a-old");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("moves a session across projects while preserving lane identity and session file identity", () => {
    const lanes = fixture();
    const before = lanes.sessionsById.a2;
    const moved = moveSessionToProject(lanes, "a2", "down");
    const after = moved.sessionsById.a2;

    expect(before?.laneId).toBe("a2");
    expect(after?.laneId).toBe("a2");
    expect(after?.sessionId).toBe(before?.sessionId);
    expect(after?.sessionPath).toBe(before?.sessionPath);
    expect(after?.projectId).toBe("/work/b");
    expect(activeSessionIdsForProject(moved, "/work/a")).toEqual(["a1"]);
    expect(activeSessionIdsForProject(moved, "/work/b")).toEqual(["a2", "b1", "b2"]);
  });

  it("loads v2 lanes with absent location as local and preserves explicit cloud markers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-lanes-v2-"));
    try {
      const lanes = withProject(emptyWorkspaceLanesV2(), "/work/a");
      const local = reduceWorkspaceLanePatch(lanes, { type: "upsertSession", session: sessionInput("a1", "/work/a") });
      const cloud = reduceWorkspaceLanePatch(local, {
        type: "setSessionLocation",
        laneId: "a1",
        location: { kind: "cloud", beamId: "beam-123", movedAt: 123 },
      });

      await writeFile(workspaceLanesV2Path(dir), `${JSON.stringify(local)}\n`, "utf8");
      expect(loadWorkspaceLanesV2(dir).lanes.sessionsById.a1?.location).toBeUndefined();

      await writeFile(workspaceLanesV2Path(dir), `${JSON.stringify(cloud)}\n`, "utf8");
      expect(loadWorkspaceLanesV2(dir).lanes.sessionsById.a1?.location).toEqual({
        kind: "cloud",
        beamId: "beam-123",
        movedAt: 123,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves cloud location through ordinary session upserts and clears it explicitly", () => {
    const lanes = reduceWorkspaceLanePatches(withProject(emptyWorkspaceLanesV2(), "/work/a"), [
      { type: "upsertSession", session: sessionInput("a1", "/work/a") },
      { type: "setSessionLocation", laneId: "a1", location: { kind: "cloud", beamId: "beam-123", movedAt: 123 } },
    ]);

    const synced = reduceWorkspaceLanePatch(lanes, { type: "upsertSession", session: { ...sessionInput("a1", "/work/a"), title: "renamed" } });
    expect(synced.sessionsById.a1?.location).toEqual({ kind: "cloud", beamId: "beam-123", movedAt: 123 });

    const local = reduceWorkspaceLanePatch(synced, { type: "setSessionLocation", laneId: "a1" });
    expect(local.sessionsById.a1?.location).toBeUndefined();
  });

  it("reorders a session within its project without changing updatedAt-driven layout", () => {
    const lanes = fixture();
    const reordered = reorderSession(lanes, "a1", "right");

    expect(activeSessionIdsForProject(reordered, "/work/a")).toEqual(["a2", "a1"]);
    expect(reordered.sessionsById.a1?.updatedAt).toBe(now);
    expect(reordered.selection).toEqual({ projectId: "/work/a", laneId: "a1" });
  });

  it("focuses up and down onto remembered columns", () => {
    const lanes = {
      ...fixture(),
      focusByProject: {
        "/work/a": { focusedLaneId: "a1", focusedColumn: 0 },
        "/work/b": { focusedLaneId: "b2", focusedColumn: 1 },
        "/work/c": { focusedLaneId: "c1", focusedColumn: 0 },
      },
      selection: { projectId: "/work/a", laneId: "a1" },
    };

    expect(focusCursor(lanes, "down")?.session.laneId).toBe("b2");
    expect(focusCursor(lanes, "up")?.session.laneId).toBe("c1");
  });

  it("applies transact patches to the latest document without lost updates", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-lanes-v2-"));
    try {
      const store = createWorkspaceLaneStore(dir, undefined, { delayMs: 60_000 });
      store.transact([
        { type: "upsertProject", project: { id: "/work/a", cwd: "/work/a", title: "a", createdAt: now, updatedAt: now } },
        { type: "upsertProject", project: { id: "/work/b", cwd: "/work/b", title: "b", createdAt: now, updatedAt: now } },
        { type: "upsertSession", session: sessionInput("a1", "/work/a") },
      ]);
      store.dispatch({ type: "upsertSession", session: sessionInput("b1", "/work/b") });

      await store.flush();
      const loaded = loadWorkspaceLanesV2(dir).lanes;
      expect(loaded.projectOrder).toEqual(["/work/a", "/work/b"]);
      expect(Object.keys(loaded.sessionsById).sort()).toEqual(["a1", "b1"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses unique atomic temp paths and leaves no temp files after flush", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-lanes-v2-"));
    try {
      const finalPath = workspaceLanesV2Path(dir);
      expect(workspaceLanesV2TempPath(finalPath)).not.toBe(workspaceLanesV2TempPath(finalPath));

      const store = createWorkspaceLaneStore(dir, undefined, { delayMs: 60_000 });
      store.dispatch({ type: "upsertProject", project: { id: "/work/a", cwd: "/work/a", title: "a", createdAt: now, updatedAt: now } });
      await store.flush();

      expect(existsSync(finalPath)).toBe(true);
      const files = await readdir(dir);
      expect(files.filter((file) => file.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("archive and restore preserve order", () => {
    const lanes = fixture();
    const archived = reduceWorkspaceLanePatch(lanes, { type: "archiveSession", laneId: "a1" });
    expect(activeSessionIdsForProject(archived, "/work/a")).toEqual(["a2"]);
    expect(archived.sessionOrderByProject["/work/a"]).toEqual(["a1", "a2"]);

    const restored = reduceWorkspaceLanePatch(archived, { type: "restoreSession", laneId: "a1" });
    expect(activeSessionIdsForProject(restored, "/work/a")).toEqual(["a1", "a2"]);
    expect(restored.sessionOrderByProject["/work/a"]).toEqual(["a1", "a2"]);
  });

  it("discards empty sessions instead of archiving dead lanes", () => {
    const lanes = reduceWorkspaceLanePatches(fixture(), [
      {
        type: "upsertSession",
        session: {
          ...sessionInput("empty", "/work/a"),
          sessionId: null,
          sessionPath: null,
          title: "new session",
        },
        insert: { type: "after", laneId: "a1" },
      },
      { type: "select", projectId: "/work/a", laneId: "empty" },
    ]);

    const discarded = reduceWorkspaceLanePatch(lanes, { type: "discardSession", laneId: "empty" });

    expect(discarded.sessionsById.empty).toBeUndefined();
    expect(activeSessionIdsForProject(discarded, "/work/a")).toEqual(["a1", "a2"]);
    expect(discarded.sessionOrderByProject["/work/a"]).toEqual(["a1", "a2"]);
    expect(discarded.selection).toEqual({ projectId: "/work/a", laneId: "a1" });
    expect(discarded.focusByProject["/work/a"]).toEqual({ focusedLaneId: "a1", focusedColumn: 0 });
  });

  it("does not discard sessions that already have JSONL identity", () => {
    const lanes = fixture();
    const discarded = reduceWorkspaceLanePatch(lanes, { type: "discardSession", laneId: "a1" });

    expect(discarded).toEqual(lanes);
  });

  it("restores project order and focus after a failed cross-project move", () => {
    const lanes = fixture();
    const destinationProject = lanes.projectsById["/work/b"];
    const destinationOrder = lanes.sessionOrderByProject["/work/b"];
    const destinationFocus = lanes.focusByProject["/work/b"];
    if (!destinationProject || !destinationOrder || !destinationFocus) throw new Error("fixture missing destination");
    const moved = reduceWorkspaceLanePatches(lanes, [
      {
        type: "upsertSession",
        session: { ...sessionInput("a1", "/work/a"), projectId: "/work/b" },
        insert: { type: "index", projectId: "/work/b", index: 1 },
      },
      { type: "select", projectId: "/work/b", laneId: "a1" },
    ]);
    const sourceRestored = reduceWorkspaceLanePatch(moved, {
      type: "upsertSession",
      session: sessionInput("a1", "/work/a"),
      insert: { type: "index", projectId: "/work/a", index: 0 },
    });

    const restored = reduceWorkspaceLanePatch(sourceRestored, {
      type: "restoreProjectSnapshot",
      projectId: "/work/b",
      project: destinationProject,
      order: destinationOrder,
      focus: destinationFocus,
    });

    expect(activeSessionIdsForProject(restored, "/work/a")).toEqual(["a1", "a2"]);
    expect(activeSessionIdsForProject(restored, "/work/b")).toEqual(["b1", "b2"]);
    expect(restored.sessionOrderByProject["/work/b"]).toEqual(destinationOrder);
    expect(restored.focusByProject["/work/b"]).toEqual(destinationFocus);
  });

  it("removes a newly created project snapshot on failed move rollback", () => {
    const lanes = fixture();
    const moved = reduceWorkspaceLanePatches(lanes, [
      { type: "upsertProject", project: { id: "/work/new", cwd: "/work/new", title: "new", createdAt: now, updatedAt: now } },
      {
        type: "upsertSession",
        session: { ...sessionInput("a1", "/work/a"), projectId: "/work/new" },
        insert: { type: "index", projectId: "/work/new", index: 0 },
      },
      { type: "select", projectId: "/work/new", laneId: "a1" },
    ]);
    const sourceRestored = reduceWorkspaceLanePatch(moved, {
      type: "upsertSession",
      session: sessionInput("a1", "/work/a"),
      insert: { type: "index", projectId: "/work/a", index: 0 },
    });

    const restored = reduceWorkspaceLanePatch(sourceRestored, {
      type: "restoreProjectSnapshot",
      projectId: "/work/new",
    });

    expect(restored.projectsById["/work/new"]).toBeUndefined();
    expect(restored.projectOrder).not.toContain("/work/new");
    expect(restored.sessionOrderByProject["/work/new"]).toBeUndefined();
    expect(restored.focusByProject["/work/new"]).toBeUndefined();
    expect(activeSessionIdsForProject(restored, "/work/a")).toEqual(["a1", "a2"]);
  });

  it("clears selection when discarding the final empty session", () => {
    const lanes = reduceWorkspaceLanePatches(withProject(emptyWorkspaceLanesV2(), "/work/a"), [
      {
        type: "upsertSession",
        session: {
          ...sessionInput("empty", "/work/a"),
          sessionId: null,
          sessionPath: null,
          title: "new session",
        },
      },
      { type: "select", projectId: "/work/a", laneId: "empty" },
    ]);

    const discarded = reduceWorkspaceLanePatch(lanes, { type: "discardSession", laneId: "empty" });

    expect(discarded.sessionsById.empty).toBeUndefined();
    expect(activeSessionIdsForProject(discarded, "/work/a")).toEqual([]);
    expect(discarded.selection).toBeUndefined();
    expect(discarded.focusByProject["/work/a"]).toEqual({ focusedColumn: 0 });
  });

  it("handles empty and corrupt files without persisting replacement data", async () => {
    const missingDir = await mkdtemp(path.join(tmpdir(), "workspace-lanes-v2-"));
    const corruptDir = await mkdtemp(path.join(tmpdir(), "workspace-lanes-v2-"));
    try {
      expect(loadWorkspaceLanesV2(missingDir)).toEqual({ lanes: emptyWorkspaceLanesV2(), migrated: false, droppedSessionIds: [] });

      await writeFile(workspaceLanesPath(corruptDir), "{", "utf8");
      const loaded = loadWorkspaceLanesV2(corruptDir);
      expect(loaded).toEqual({ lanes: emptyWorkspaceLanesV2(), migrated: false, droppedSessionIds: [] });
      expect(await Bun.file(workspaceLanesPath(corruptDir)).text()).toBe("{");
    } finally {
      await rm(missingDir, { recursive: true, force: true });
      await rm(corruptDir, { recursive: true, force: true });
    }
  });

  it("inserts a session after another lane", () => {
    const lanes = withProject(emptyWorkspaceLanesV2(), "/work/a");
    const seeded = reduceWorkspaceLanePatches(lanes, [
      { type: "upsertSession", session: sessionInput("a1", "/work/a") },
      { type: "upsertSession", session: sessionInput("a3", "/work/a") },
      { type: "upsertSession", session: sessionInput("a2", "/work/a"), insert: { type: "after", laneId: "a1" } },
    ]);

    expect(activeSessionIdsForProject(seeded, "/work/a")).toEqual(["a1", "a2", "a3"]);
  });
});

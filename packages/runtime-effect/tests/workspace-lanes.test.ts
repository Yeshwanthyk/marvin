import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
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
  scheduleWriteWorkspaceLanes,
  selectLane,
  upsertProjectLane,
  upsertSessionLane,
  flushWorkspaceLanes,
  writeWorkspaceLanes,
  workspaceLanesPath,
  workspaceLanesTempPath,
  type LaneCursor,
  type LaneDirection,
  type WorkspaceLanes,
  type WorkspaceSelection,
} from "../src/workspace-lanes.js";

const sessionInfo = (id: string, cwd: string, timestamp: number): SessionInfo => ({
  id,
  timestamp,
  path: path.join(cwd, `${id}.jsonl`),
  provider: "anthropic",
  modelId: "claude-test",
  cwd,
});

const legacyActiveProjects = (lanes: WorkspaceLanes) => lanes.projects.filter((project) => project.archivedAt === undefined);

const legacyActiveSessionsForProject = (lanes: WorkspaceLanes, projectId: string) =>
  lanes.sessions
    .filter((session) => session.projectId === projectId && session.archivedAt === undefined)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

const legacyFindActiveCursor = (lanes: WorkspaceLanes, preferred?: WorkspaceSelection): LaneCursor | null => {
  const projects = legacyActiveProjects(lanes);
  if (projects.length === 0) return null;

  const selectedProject = preferred?.projectId ?? lanes.selection?.projectId;
  const selectedSession = preferred?.sessionLaneId ?? lanes.selection?.sessionLaneId;
  const orderedProjects = selectedProject
    ? [...projects.filter((project) => project.id === selectedProject), ...projects.filter((project) => project.id !== selectedProject)]
    : projects;

  for (const project of orderedProjects) {
    const sessions = legacyActiveSessionsForProject(lanes, project.id);
    if (sessions.length === 0) continue;
    const session = sessions.find((entry) => entry.id === selectedSession) ?? sessions[0];
    if (session) return { project, session };
  }

  return null;
};

const legacyMoveLaneCursor = (lanes: WorkspaceLanes, direction: LaneDirection, preferred?: WorkspaceSelection): LaneCursor | null => {
  const current = legacyFindActiveCursor(lanes, preferred);
  if (!current) return null;

  const projects = legacyActiveProjects(lanes);
  const projectIndex = Math.max(0, projects.findIndex((project) => project.id === current.project.id));
  const projectStep = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  if (projectStep !== 0) {
    for (let offset = 1; offset <= projects.length; offset++) {
      const nextProject = projects[(projectIndex + projectStep * offset + projects.length) % projects.length];
      if (!nextProject) continue;
      const nextSession = legacyActiveSessionsForProject(lanes, nextProject.id)[0];
      if (nextSession) return { project: nextProject, session: nextSession };
    }
    return current;
  }

  const sessions = legacyActiveSessionsForProject(lanes, current.project.id);
  if (sessions.length <= 1) return current;
  const sessionIndex = Math.max(0, sessions.findIndex((session) => session.id === current.session.id));
  const sessionStep = direction === "left" ? -1 : 1;
  const nextSession = sessions[(sessionIndex + sessionStep + sessions.length) % sessions.length];
  return nextSession ? { project: current.project, session: nextSession } : current;
};

const cursorIds = (cursor: LaneCursor | null) =>
  cursor ? { projectId: cursor.project.id, sessionLaneId: cursor.session.id } : null;

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

  it("matches previous navigation behavior from an indexed fixture", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-lanes-"));
    try {
      const lanes: WorkspaceLanes = {
        version: 1,
        projects: [
          { id: "/work/alpha", cwd: "/work/alpha", title: "alpha", updatedAt: "2026-06-03T00:00:00.000Z" },
          { id: "/work/empty", cwd: "/work/empty", title: "empty", updatedAt: "2026-06-03T00:00:00.000Z" },
          { id: "/work/beta", cwd: "/work/beta", title: "beta", updatedAt: "2026-06-03T00:00:00.000Z" },
          { id: "/work/old", cwd: "/work/old", title: "old", updatedAt: "2026-06-03T00:00:00.000Z", archivedAt: "2026-06-03T01:00:00.000Z" },
        ],
        sessions: [
          {
            id: "/work/alpha:a-old",
            projectId: "/work/alpha",
            sessionId: "a-old",
            sessionPath: "/work/alpha/a-old.jsonl",
            title: "alpha old",
            provider: "anthropic",
            modelId: "claude-test",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:01.000Z",
          },
          {
            id: "/work/alpha:a-new",
            projectId: "/work/alpha",
            sessionId: "a-new",
            sessionPath: "/work/alpha/a-new.jsonl",
            title: "alpha new",
            provider: "anthropic",
            modelId: "claude-test",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:03.000Z",
          },
          {
            id: "/work/alpha:a-archived",
            projectId: "/work/alpha",
            sessionId: "a-archived",
            sessionPath: "/work/alpha/a-archived.jsonl",
            title: "alpha archived",
            provider: "anthropic",
            modelId: "claude-test",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:04.000Z",
            archivedAt: "2026-06-03T02:00:00.000Z",
          },
          {
            id: "/work/beta:b-only",
            projectId: "/work/beta",
            sessionId: "b-only",
            sessionPath: "/work/beta/b-only.jsonl",
            title: "beta only",
            provider: "anthropic",
            modelId: "claude-test",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:02.000Z",
          },
          {
            id: "/work/old:o-hidden",
            projectId: "/work/old",
            sessionId: "o-hidden",
            sessionPath: "/work/old/o-hidden.jsonl",
            title: "old hidden",
            provider: "anthropic",
            modelId: "claude-test",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:05.000Z",
          },
        ],
        selection: { projectId: "/work/alpha", sessionLaneId: "/work/alpha:a-new" },
      };
      writeWorkspaceLanes(dir, lanes);
      const loaded = readWorkspaceLanes(dir);
      const preferences: Array<WorkspaceSelection | undefined> = [
        undefined,
        { projectId: "/work/alpha", sessionLaneId: "/work/alpha:a-old" },
        { projectId: "/work/empty", sessionLaneId: "missing" },
        { projectId: "/work/beta", sessionLaneId: "/work/beta:b-only" },
      ];
      const directions: LaneDirection[] = ["left", "right", "up", "down"];

      for (const preferred of preferences) {
        expect(cursorIds(findActiveCursor(loaded, preferred))).toEqual(cursorIds(legacyFindActiveCursor(loaded, preferred)));
        for (const direction of directions) {
          expect(cursorIds(moveLaneCursor(loaded, direction, preferred))).toEqual(cursorIds(legacyMoveLaneCursor(loaded, direction, preferred)));
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  it("coalesces scheduled writes and leaves the final atomic file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-lanes-"));
    try {
      const first = readWorkspaceLanes(dir);
      const firstProject = upsertProjectLane(first, "/work/first", "2026-06-03T00:00:00.000Z");
      const firstSession = upsertSessionLane(first, firstProject, sessionInfo("first", firstProject.cwd, 1), "first", "2026-06-03T00:00:01.000Z");
      scheduleWriteWorkspaceLanes(dir, selectLane(first, { project: firstProject, session: firstSession }), { delayMs: 60_000 });

      const final = readWorkspaceLanes("/missing");
      const finalProject = upsertProjectLane(final, "/work/final", "2026-06-03T00:00:02.000Z");
      const finalSession = upsertSessionLane(final, finalProject, sessionInfo("final", finalProject.cwd, 2), "final", "2026-06-03T00:00:03.000Z");
      scheduleWriteWorkspaceLanes(dir, selectLane(final, { project: finalProject, session: finalSession }), { delayMs: 60_000 });

      expect(existsSync(workspaceLanesPath(dir))).toBe(false);
      await flushWorkspaceLanes(dir);

      const loaded = readWorkspaceLanes(dir);
      expect(loaded.projects.map((project) => project.id)).toEqual(["/work/final"]);
      expect(loaded.sessions.map((session) => session.id)).toEqual([finalSession.id]);
      expect(loaded.selection).toEqual({ projectId: finalProject.id, sessionLaneId: finalSession.id });
      expect(existsSync(workspaceLanesTempPath(dir))).toBe(false);
    } finally {
      await flushWorkspaceLanes(dir);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

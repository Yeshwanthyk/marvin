import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SessionInfo } from "./session-manager.js";

export const WORKSPACE_LANES_VERSION = 1;

export interface ProjectLane {
  id: string;
  cwd: string;
  title: string;
  archivedAt?: string;
  updatedAt: string;
}

export interface ProjectSessionLane {
  id: string;
  projectId: string;
  sessionId: string;
  sessionPath: string;
  title: string;
  provider: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface WorkspaceSelection {
  projectId: string;
  sessionLaneId: string;
}

export interface WorkspaceLanes {
  version: typeof WORKSPACE_LANES_VERSION;
  projects: ProjectLane[];
  sessions: ProjectSessionLane[];
  selection?: WorkspaceSelection;
}

export interface LaneCursor {
  project: ProjectLane;
  session: ProjectSessionLane;
}

export type LaneDirection = "left" | "right" | "up" | "down";

export const workspaceLanesPath = (configDir: string): string => join(configDir, "workspace-lanes.json");

const emptyWorkspaceLanes = (): WorkspaceLanes => ({
  version: WORKSPACE_LANES_VERSION,
  projects: [],
  sessions: [],
});

const toTitle = (cwd: string): string => {
  const normalized = cwd.replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
};

const sessionLaneId = (projectId: string, sessionId: string): string => `${projectId}:${sessionId}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const readString = (value: Record<string, unknown>, key: string): string | undefined => {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
};

const parseProject = (value: unknown): ProjectLane | undefined => {
  if (!isRecord(value)) return undefined;
  const id = readString(value, "id");
  const cwd = readString(value, "cwd");
  const title = readString(value, "title");
  const updatedAt = readString(value, "updatedAt");
  if (!id || !cwd || !title || !updatedAt) return undefined;
  const project: ProjectLane = { id, cwd, title, updatedAt };
  const archivedAt = readString(value, "archivedAt");
  if (archivedAt) project.archivedAt = archivedAt;
  return project;
};

const parseSession = (value: unknown): ProjectSessionLane | undefined => {
  if (!isRecord(value)) return undefined;
  const id = readString(value, "id");
  const projectId = readString(value, "projectId");
  const sessionId = readString(value, "sessionId");
  const sessionPath = readString(value, "sessionPath");
  const title = readString(value, "title");
  const provider = readString(value, "provider");
  const modelId = readString(value, "modelId");
  const createdAt = readString(value, "createdAt");
  const updatedAt = readString(value, "updatedAt");
  if (!id || !projectId || !sessionId || !sessionPath || !title || !provider || !modelId || !createdAt || !updatedAt) {
    return undefined;
  }
  const session: ProjectSessionLane = {
    id,
    projectId,
    sessionId,
    sessionPath,
    title,
    provider,
    modelId,
    createdAt,
    updatedAt,
  };
  const archivedAt = readString(value, "archivedAt");
  if (archivedAt) session.archivedAt = archivedAt;
  return session;
};

const parseSelection = (value: unknown): WorkspaceSelection | undefined => {
  if (!isRecord(value)) return undefined;
  const projectId = readString(value, "projectId");
  const sessionLaneId = readString(value, "sessionLaneId");
  return projectId && sessionLaneId ? { projectId, sessionLaneId } : undefined;
};

export const readWorkspaceLanes = (configDir: string): WorkspaceLanes => {
  const path = workspaceLanesPath(configDir);
  if (!existsSync(path)) return emptyWorkspaceLanes();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(raw)) return emptyWorkspaceLanes();
    const projects = Array.isArray(raw.projects) ? raw.projects.map(parseProject).filter((p): p is ProjectLane => Boolean(p)) : [];
    const sessions = Array.isArray(raw.sessions)
      ? raw.sessions.map(parseSession).filter((s): s is ProjectSessionLane => Boolean(s))
      : [];
    const lanes: WorkspaceLanes = {
      version: WORKSPACE_LANES_VERSION,
      projects,
      sessions,
    };
    const selection = parseSelection(raw.selection);
    if (selection) lanes.selection = selection;
    return lanes;
  } catch {
    return emptyWorkspaceLanes();
  }
};

export const writeWorkspaceLanes = (configDir: string, lanes: WorkspaceLanes): void => {
  const path = workspaceLanesPath(configDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...lanes, version: WORKSPACE_LANES_VERSION }, null, 2)}\n`, "utf8");
};

export const upsertProjectLane = (lanes: WorkspaceLanes, cwd: string, now: string = new Date().toISOString()): ProjectLane => {
  const id = cwd;
  const existing = lanes.projects.find((project) => project.id === id);
  if (existing) {
    existing.cwd = cwd;
    existing.title ||= toTitle(cwd);
    existing.updatedAt = now;
    return existing;
  }
  const project: ProjectLane = { id, cwd, title: toTitle(cwd), updatedAt: now };
  lanes.projects.push(project);
  return project;
};

export const upsertSessionLane = (
  lanes: WorkspaceLanes,
  project: ProjectLane,
  session: SessionInfo,
  title?: string,
  now: string = new Date().toISOString(),
): ProjectSessionLane => {
  const id = sessionLaneId(project.id, session.id);
  const existing = lanes.sessions.find((entry) => entry.id === id);
  if (existing) {
    existing.sessionPath = session.path;
    existing.provider = session.provider;
    existing.modelId = session.modelId;
    existing.title = title ?? existing.title;
    existing.updatedAt = now;
    return existing;
  }
  const createdAt = new Date(session.timestamp).toISOString();
  const entry: ProjectSessionLane = {
    id,
    projectId: project.id,
    sessionId: session.id,
    sessionPath: session.path,
    title: title ?? session.id.slice(0, 8),
    provider: session.provider,
    modelId: session.modelId,
    createdAt,
    updatedAt: now,
  };
  lanes.sessions.push(entry);
  return entry;
};

export const activeProjects = (lanes: WorkspaceLanes): ProjectLane[] =>
  lanes.projects.filter((project) => project.archivedAt === undefined);

export const activeSessionsForProject = (lanes: WorkspaceLanes, projectId: string): ProjectSessionLane[] =>
  lanes.sessions
    .filter((session) => session.projectId === projectId && session.archivedAt === undefined)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

export const activeSessionLanes = (lanes: WorkspaceLanes): ProjectSessionLane[] =>
  activeProjects(lanes).flatMap((project) => activeSessionsForProject(lanes, project.id));

export const findActiveCursor = (lanes: WorkspaceLanes, preferred?: WorkspaceSelection): LaneCursor | null => {
  const projects = activeProjects(lanes);
  if (projects.length === 0) return null;

  const selectedProject = preferred?.projectId ?? lanes.selection?.projectId;
  const selectedSession = preferred?.sessionLaneId ?? lanes.selection?.sessionLaneId;
  const orderedProjects = selectedProject
    ? [...projects.filter((project) => project.id === selectedProject), ...projects.filter((project) => project.id !== selectedProject)]
    : projects;

  for (const project of orderedProjects) {
    const sessions = activeSessionsForProject(lanes, project.id);
    if (sessions.length === 0) continue;
    const session = sessions.find((entry) => entry.id === selectedSession) ?? sessions[0];
    if (session) return { project, session };
  }

  return null;
};

export const selectLane = (lanes: WorkspaceLanes, cursor: LaneCursor): WorkspaceLanes => ({
  ...lanes,
  selection: {
    projectId: cursor.project.id,
    sessionLaneId: cursor.session.id,
  },
});

export const moveLaneCursor = (
  lanes: WorkspaceLanes,
  direction: LaneDirection,
  preferred?: WorkspaceSelection,
): LaneCursor | null => {
  const current = findActiveCursor(lanes, preferred);
  if (!current) return null;

  const projects = activeProjects(lanes);
  const projectIndex = Math.max(0, projects.findIndex((project) => project.id === current.project.id));
  const projectStep = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  if (projectStep !== 0) {
    for (let offset = 1; offset <= projects.length; offset++) {
      const nextProject = projects[(projectIndex + projectStep * offset + projects.length) % projects.length];
      if (!nextProject) continue;
      const nextSession = activeSessionsForProject(lanes, nextProject.id)[0];
      if (nextSession) return { project: nextProject, session: nextSession };
    }
    return current;
  }

  const sessions = activeSessionsForProject(lanes, current.project.id);
  if (sessions.length <= 1) return current;
  const sessionIndex = Math.max(0, sessions.findIndex((session) => session.id === current.session.id));
  const sessionStep = direction === "left" ? -1 : 1;
  const nextSession = sessions[(sessionIndex + sessionStep + sessions.length) % sessions.length];
  return nextSession ? { project: current.project, session: nextSession } : current;
};

export const archiveSessionLane = (
  lanes: WorkspaceLanes,
  sessionLaneId: string,
  now: string = new Date().toISOString(),
): WorkspaceLanes => ({
  ...lanes,
  sessions: lanes.sessions.map((session) =>
    session.id === sessionLaneId ? { ...session, archivedAt: session.archivedAt ?? now, updatedAt: now } : session,
  ),
});

export const restoreSessionLane = (
  lanes: WorkspaceLanes,
  sessionLaneId: string,
  now: string = new Date().toISOString(),
): WorkspaceLanes => ({
  ...lanes,
  sessions: lanes.sessions.map((session) => {
    if (session.id !== sessionLaneId) return session;
    const { archivedAt: _archivedAt, ...rest } = session;
    return { ...rest, updatedAt: now };
  }),
});

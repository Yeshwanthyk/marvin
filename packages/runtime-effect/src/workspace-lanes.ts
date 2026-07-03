import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
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

export interface WorkspaceLaneIndex {
  activeProjects: ProjectLane[];
  sessionsByProject: ReadonlyMap<string, ProjectSessionLane[]>;
}

export interface WriteWorkspaceLanesOptions {
  immediate?: boolean;
  delayMs?: number;
}

interface CachedLaneIndex {
  signature: string;
  index: WorkspaceLaneIndex;
}

interface PendingWorkspaceLanesWrite {
  lanes: WorkspaceLanes;
  timer: ReturnType<typeof setTimeout> | null;
  promise: Promise<void> | null;
}

export const workspaceLanesPath = (configDir: string): string => join(configDir, "workspace-lanes.json");

export const workspaceLanesTempPath = (configDir: string): string => `${workspaceLanesPath(configDir)}.tmp`;

const laneIndexCache = new WeakMap<WorkspaceLanes, CachedLaneIndex>();
const pendingWorkspaceLanesWrites = new Map<string, PendingWorkspaceLanesWrite>();

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

const serializeWorkspaceLanes = (lanes: WorkspaceLanes): string =>
  `${JSON.stringify({ ...lanes, version: WORKSPACE_LANES_VERSION }, null, 2)}\n`;

const fsyncDirSync = (path: string): void => {
  let fd: number | null = null;
  try {
    fd = openSync(dirname(path), "r");
    fsyncSync(fd);
  } catch {
    // Best effort: some filesystems do not allow opening directories.
  } finally {
    if (fd !== null) closeSync(fd);
  }
};

const atomicWriteWorkspaceLanesSync = (path: string, data: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "w");
    writeFileSync(fd, data, "utf8");
    fsyncSync(fd);
  } finally {
    if (fd !== null) closeSync(fd);
  }
  renameSync(tempPath, path);
  fsyncDirSync(path);
};

const fsyncDir = async (path: string): Promise<void> => {
  let dirHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    dirHandle = await open(dirname(path), "r");
    await dirHandle.sync();
  } catch {
    // Best effort: some filesystems do not allow opening directories.
  } finally {
    await dirHandle?.close();
  }
};

const atomicWriteWorkspaceLanes = async (path: string, data: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  const handle = await open(tempPath, "w");
  try {
    await writeFile(handle, data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, path);
  await fsyncDir(path);
};

export const writeWorkspaceLanes = (configDir: string, lanes: WorkspaceLanes): void => {
  const path = workspaceLanesPath(configDir);
  atomicWriteWorkspaceLanesSync(path, serializeWorkspaceLanes(lanes));
};

const startWorkspaceLanesWrite = (path: string, pending: PendingWorkspaceLanesWrite): void => {
  pending.timer = null;
  const writePromise = atomicWriteWorkspaceLanes(path, serializeWorkspaceLanes(pending.lanes));
  const trackedPromise = writePromise.finally(() => {
    if (pendingWorkspaceLanesWrites.get(path) === pending && pending.promise === trackedPromise && pending.timer === null) {
      pendingWorkspaceLanesWrites.delete(path);
    }
  });
  pending.promise = trackedPromise;
};

const queueWorkspaceLanesWrite = (path: string, pending: PendingWorkspaceLanesWrite, delayMs: number): void => {
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = setTimeout(() => startWorkspaceLanesWrite(path, pending), delayMs);
};

export const scheduleWriteWorkspaceLanes = (
  configDir: string,
  lanes: WorkspaceLanes,
  options: WriteWorkspaceLanesOptions = {},
): void => {
  if (options.immediate === true) {
    writeWorkspaceLanes(configDir, lanes);
    return;
  }

  const path = workspaceLanesPath(configDir);
  const existing = pendingWorkspaceLanesWrites.get(path);
  if (existing) {
    existing.lanes = lanes;
    queueWorkspaceLanesWrite(path, existing, options.delayMs ?? 0);
    return;
  }

  const pending: PendingWorkspaceLanesWrite = {
    lanes,
    timer: null,
    promise: null,
  };
  pendingWorkspaceLanesWrites.set(path, pending);
  queueWorkspaceLanesWrite(path, pending, options.delayMs ?? 0);
};

export const flushWorkspaceLanes = async (configDir?: string): Promise<void> => {
  const entries = [...pendingWorkspaceLanesWrites.entries()].filter(([path]) =>
    configDir === undefined ? true : path === workspaceLanesPath(configDir),
  );
  await Promise.all(
    entries.map(async ([path, pending]) => {
      if (pending.timer) {
        clearTimeout(pending.timer);
        startWorkspaceLanesWrite(path, pending);
      }
      await pending.promise;
      if (pendingWorkspaceLanesWrites.get(path) === pending) pendingWorkspaceLanesWrites.delete(path);
    }),
  );
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

const laneIndexSignature = (lanes: WorkspaceLanes): string =>
  JSON.stringify({
    projects: lanes.projects.map((project) => [project.id, project.archivedAt]),
    sessions: lanes.sessions.map((session) => [session.id, session.projectId, session.updatedAt, session.archivedAt]),
  });

export const createWorkspaceLaneIndex = (lanes: WorkspaceLanes): WorkspaceLaneIndex => {
  const cached = laneIndexCache.get(lanes);
  const signature = laneIndexSignature(lanes);
  if (cached?.signature === signature) return cached.index;

  const activeProjectList = lanes.projects.filter((project) => project.archivedAt === undefined);
  const sessionsByProject = new Map<string, ProjectSessionLane[]>();
  for (const session of lanes.sessions) {
    if (session.archivedAt !== undefined) continue;
    const sessions = sessionsByProject.get(session.projectId);
    if (sessions) {
      sessions.push(session);
    } else {
      sessionsByProject.set(session.projectId, [session]);
    }
  }
  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  const index: WorkspaceLaneIndex = {
    activeProjects: activeProjectList,
    sessionsByProject,
  };
  laneIndexCache.set(lanes, { signature, index });
  return index;
};

export const activeProjects = (lanes: WorkspaceLanes): ProjectLane[] => [...createWorkspaceLaneIndex(lanes).activeProjects];

export const activeSessionsForProject = (lanes: WorkspaceLanes, projectId: string): ProjectSessionLane[] =>
  [...(createWorkspaceLaneIndex(lanes).sessionsByProject.get(projectId) ?? [])];

export const activeSessionLanes = (lanes: WorkspaceLanes): ProjectSessionLane[] => {
  const index = createWorkspaceLaneIndex(lanes);
  return index.activeProjects.flatMap((project) => index.sessionsByProject.get(project.id) ?? []);
};

export const findActiveCursor = (lanes: WorkspaceLanes, preferred?: WorkspaceSelection): LaneCursor | null => {
  const index = createWorkspaceLaneIndex(lanes);
  const projects = index.activeProjects;
  if (projects.length === 0) return null;

  const selectedProject = preferred?.projectId ?? lanes.selection?.projectId;
  const selectedSession = preferred?.sessionLaneId ?? lanes.selection?.sessionLaneId;
  const orderedProjects = selectedProject
    ? [...projects.filter((project) => project.id === selectedProject), ...projects.filter((project) => project.id !== selectedProject)]
    : projects;

  for (const project of orderedProjects) {
    const sessions = index.sessionsByProject.get(project.id) ?? [];
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
  const index = createWorkspaceLaneIndex(lanes);
  const current = findActiveCursor(lanes, preferred);
  if (!current) return null;

  const projects = index.activeProjects;
  const projectIndex = Math.max(0, projects.findIndex((project) => project.id === current.project.id));
  const projectStep = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  if (projectStep !== 0) {
    for (let offset = 1; offset <= projects.length; offset++) {
      const nextProject = projects[(projectIndex + projectStep * offset + projects.length) % projects.length];
      if (!nextProject) continue;
      const nextSession = index.sessionsByProject.get(nextProject.id)?.[0];
      if (nextSession) return { project: nextProject, session: nextSession };
    }
    return current;
  }

  const sessions = index.sessionsByProject.get(current.project.id) ?? [];
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

export const renameSessionLane = (
  lanes: WorkspaceLanes,
  sessionLaneId: string,
  title: string,
  now: string = new Date().toISOString(),
): WorkspaceLanes => {
  const trimmed = title.trim();
  if (!trimmed) return lanes;
  return {
    ...lanes,
    sessions: lanes.sessions.map((session) =>
      session.id === sessionLaneId ? { ...session, title: trimmed, updatedAt: now } : session,
    ),
  };
};

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

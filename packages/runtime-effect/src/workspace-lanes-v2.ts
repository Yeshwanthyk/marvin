import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { readWorkspaceLanes, type WorkspaceLanes } from "./workspace-lanes.js";

export const WORKSPACE_LANES_VERSION_V2 = 2;
export const WORKSPACE_LANES_VERSION = WORKSPACE_LANES_VERSION_V2;

export type Accessor<T> = () => T;
export type LaneId = string;
export type ProjectId = string;
export type LaneDirection = "left" | "right" | "up" | "down";

export interface WorkspaceLanesV2 {
  readonly version: 2;
  readonly projectsById: Record<ProjectId, ProjectLaneV2>;
  readonly projectOrder: ProjectId[];
  readonly sessionsById: Record<LaneId, SessionLaneV2>;
  readonly sessionOrderByProject: Record<ProjectId, LaneId[]>;
  readonly focusByProject: Record<ProjectId, ProjectFocusV2>;
  readonly selection?: WorkspaceSelectionV2;
}

export interface ProjectLaneV2 {
  readonly id: ProjectId;
  readonly cwd: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export interface SessionLaneV2 {
  readonly laneId: LaneId;
  readonly projectId: ProjectId;
  readonly sessionId: string | null;
  readonly sessionPath: string | null;
  readonly title: string;
  readonly provider: string;
  readonly modelId: string;
  readonly location?: SessionLaneLocationV2;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export type SessionLaneLocationV2 =
  | { readonly kind: "local" }
  | { readonly kind: "cloud"; readonly beamId: string; readonly movedAt: number };

export interface ProjectFocusV2 {
  readonly focusedLaneId?: LaneId;
  readonly focusedColumn: number;
}

export interface WorkspaceSelectionV2 {
  readonly projectId: ProjectId;
  readonly laneId: LaneId;
}

export interface LaneCursorV2 {
  readonly project: ProjectLaneV2;
  readonly session: SessionLaneV2;
  readonly projectIndex: number;
  readonly sessionIndex: number;
}

export interface ProjectLaneInput {
  readonly id: ProjectId;
  readonly cwd: string;
  readonly title?: string;
  readonly createdAt?: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export interface SessionLaneInput {
  readonly laneId: LaneId;
  readonly projectId: ProjectId;
  readonly sessionId: string | null;
  readonly sessionPath: string | null;
  readonly title: string;
  readonly provider: string;
  readonly modelId: string;
  readonly location?: SessionLaneLocationV2;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export type InsertPosition =
  | { readonly type: "index"; readonly projectId: ProjectId; readonly index: number }
  | { readonly type: "after"; readonly laneId: LaneId }
  | { readonly type: "end"; readonly projectId: ProjectId };

export type WorkspaceLanePatch =
  | { readonly type: "upsertProject"; readonly project: ProjectLaneInput }
  | { readonly type: "upsertSession"; readonly session: SessionLaneInput; readonly insert?: InsertPosition }
  | { readonly type: "select"; readonly projectId: ProjectId; readonly laneId: LaneId }
  | { readonly type: "focus"; readonly direction: LaneDirection }
  | { readonly type: "reorderSession"; readonly laneId: LaneId; readonly direction: "left" | "right" }
  | { readonly type: "moveSessionToProject"; readonly laneId: LaneId; readonly direction: "up" | "down" }
  | { readonly type: "archiveSession"; readonly laneId: LaneId }
  | { readonly type: "restoreSession"; readonly laneId: LaneId; readonly projectId?: ProjectId; readonly insert?: InsertPosition }
  | { readonly type: "renameSession"; readonly laneId: LaneId; readonly title: string }
  | { readonly type: "setSessionLocation"; readonly laneId: LaneId; readonly location?: SessionLaneLocationV2 }
  | { readonly type: "touchSession"; readonly laneId: LaneId; readonly updatedAt: string };

export interface WorkspaceLaneStore {
  readonly lanes: Accessor<WorkspaceLanesV2>;
  readonly revision: Accessor<number>;
  dispatch(patch: WorkspaceLanePatch): WorkspaceLanesV2;
  transact(patches: readonly WorkspaceLanePatch[]): WorkspaceLanesV2;
  subscribe(listener: WorkspaceLaneStoreListener): () => void;
  flush(): Promise<void>;
}

export interface WorkspaceLaneStoreListener {
  (lanes: WorkspaceLanesV2, revision: number): void;
}

export interface WriteWorkspaceLanesV2Options {
  readonly immediate?: boolean;
  readonly delayMs?: number;
}

export interface WorkspaceLanesMigrationResult {
  readonly lanes: WorkspaceLanesV2;
  readonly migrated: boolean;
  readonly droppedSessionIds: string[];
}

interface PendingWorkspaceLanesV2Write {
  lanes: WorkspaceLanesV2;
  timer: ReturnType<typeof setTimeout> | null;
  promise: Promise<void> | null;
}

let tempPathCounter = 0;

const pendingWorkspaceLanesV2Writes = new Map<string, PendingWorkspaceLanesV2Write>();

export const workspaceLanesV2Path = (configDir: string): string => join(configDir, "workspace-lanes.json");

export const workspaceLanesV2TempPath = (path: string): string => {
  tempPathCounter += 1;
  return `${path}.${process.pid}.${tempPathCounter}.tmp`;
};

export const emptyWorkspaceLanesV2 = (): WorkspaceLanesV2 => ({
  version: WORKSPACE_LANES_VERSION_V2,
  projectsById: {},
  projectOrder: [],
  sessionsById: {},
  sessionOrderByProject: {},
  focusByProject: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const readString = (value: Record<string, unknown>, key: string): string | undefined => {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
};

const readNullableString = (value: Record<string, unknown>, key: string): string | null | undefined => {
  const raw = value[key];
  if (raw === null) return null;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
};

const readNumber = (value: Record<string, unknown>, key: string): number | undefined => {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
};

const toTitle = (cwd: string): string => {
  const normalized = cwd.replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
};

const withoutUndefined = <T extends Record<string, unknown>>(value: T): T => value;

const parseProject = (value: unknown): ProjectLaneV2 | undefined => {
  if (!isRecord(value)) return undefined;
  const id = readString(value, "id");
  const cwd = readString(value, "cwd");
  const title = readString(value, "title");
  const createdAt = readString(value, "createdAt");
  const updatedAt = readString(value, "updatedAt");
  if (!id || !cwd || !title || !createdAt || !updatedAt) return undefined;
  const archivedAt = readString(value, "archivedAt");
  if (archivedAt) return { id, cwd, title, createdAt, updatedAt, archivedAt };
  return { id, cwd, title, createdAt, updatedAt };
};

const parseSession = (value: unknown): SessionLaneV2 | undefined => {
  if (!isRecord(value)) return undefined;
  const laneId = readString(value, "laneId");
  const projectId = readString(value, "projectId");
  const sessionId = readNullableString(value, "sessionId");
  const sessionPath = readNullableString(value, "sessionPath");
  const title = readString(value, "title");
  const provider = readString(value, "provider");
  const modelId = readString(value, "modelId");
  const createdAt = readString(value, "createdAt");
  const updatedAt = readString(value, "updatedAt");
  const location = parseSessionLocation(value.location);
  if (value.location !== undefined && location === undefined) return undefined;
  if (
    !laneId ||
    !projectId ||
    sessionId === undefined ||
    sessionPath === undefined ||
    !title ||
    !provider ||
    !modelId ||
    !createdAt ||
    !updatedAt
  ) {
    return undefined;
  }
  const archivedAt = readString(value, "archivedAt");
  const parsed = {
    laneId,
    projectId,
    sessionId,
    sessionPath,
    title,
    provider,
    modelId,
    ...(location !== undefined ? { location } : {}),
    createdAt,
    updatedAt,
  };
  if (archivedAt) return { ...parsed, archivedAt };
  return parsed;
};

const parseFocus = (value: unknown): ProjectFocusV2 | undefined => {
  if (!isRecord(value)) return undefined;
  const focusedColumn = readNumber(value, "focusedColumn");
  if (focusedColumn === undefined) return undefined;
  const focusedLaneId = readString(value, "focusedLaneId");
  if (focusedLaneId) return { focusedColumn, focusedLaneId };
  return { focusedColumn };
};

const parseSelection = (value: unknown): WorkspaceSelectionV2 | undefined => {
  if (!isRecord(value)) return undefined;
  const projectId = readString(value, "projectId");
  const laneId = readString(value, "laneId");
  return projectId && laneId ? { projectId, laneId } : undefined;
};

const parseSessionLocation = (value: unknown): SessionLaneLocationV2 | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  if (value.kind === "local") return { kind: "local" };
  if (value.kind === "cloud") {
    const beamId = readString(value, "beamId");
    const movedAt = readNumber(value, "movedAt");
    if (!beamId || movedAt === undefined) return undefined;
    return { kind: "cloud", beamId, movedAt };
  }
  return undefined;
};

const parseRecordValues = <T>(
  value: unknown,
  parse: (entry: unknown) => T | undefined,
): Record<string, T> | undefined => {
  if (!isRecord(value)) return undefined;
  const output: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parse(entry);
    if (parsed === undefined) return undefined;
    output[key] = parsed;
  }
  return output;
};

const parseStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return undefined;
    output.push(entry);
  }
  return output;
};

const parseStringArrayRecord = (value: unknown): Record<string, string[]> | undefined => {
  if (!isRecord(value)) return undefined;
  const output: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseStringArray(entry);
    if (parsed === undefined) return undefined;
    output[key] = parsed;
  }
  return output;
};

const parseWorkspaceLanesV2 = (value: unknown): WorkspaceLanesV2 | undefined => {
  if (!isRecord(value) || value.version !== WORKSPACE_LANES_VERSION_V2) return undefined;
  const projectsById = parseRecordValues(value.projectsById, parseProject);
  const projectOrder = parseStringArray(value.projectOrder);
  const sessionsById = parseRecordValues(value.sessionsById, parseSession);
  const sessionOrderByProject = parseStringArrayRecord(value.sessionOrderByProject);
  const focusByProject = parseRecordValues(value.focusByProject, parseFocus);
  if (!projectsById || !projectOrder || !sessionsById || !sessionOrderByProject || !focusByProject) return undefined;
  const selection = parseSelection(value.selection);
  if (selection) return { version: WORKSPACE_LANES_VERSION_V2, projectsById, projectOrder, sessionsById, sessionOrderByProject, focusByProject, selection };
  return { version: WORKSPACE_LANES_VERSION_V2, projectsById, projectOrder, sessionsById, sessionOrderByProject, focusByProject };
};

const maybeWithArchivedAt = <T extends object>(value: T, archivedAt?: string): T | (T & { readonly archivedAt: string }) =>
  archivedAt ? { ...value, archivedAt } : value;

export const migrateWorkspaceLanesV1ToV2 = (lanes: WorkspaceLanes): WorkspaceLanesMigrationResult => {
  const projectsById: Record<ProjectId, ProjectLaneV2> = {};
  const projectOrder: ProjectId[] = [];
  const sessionsById: Record<LaneId, SessionLaneV2> = {};
  const sessionOrderByProject: Record<ProjectId, LaneId[]> = {};
  const focusByProject: Record<ProjectId, ProjectFocusV2> = {};
  const legacyLaneIdsById: Record<string, LaneId> = {};
  const droppedSessionIds: string[] = [];

  for (const project of lanes.projects) {
    projectsById[project.id] = maybeWithArchivedAt(
      {
        id: project.id,
        cwd: project.cwd,
        title: project.title,
        createdAt: project.updatedAt,
        updatedAt: project.updatedAt,
      },
      project.archivedAt,
    );
    projectOrder.push(project.id);
    sessionOrderByProject[project.id] = [];
  }

  const activeSessionsByProject: Record<ProjectId, SessionLaneV2[]> = {};
  for (const session of lanes.sessions) {
    if (projectsById[session.projectId] === undefined) {
      droppedSessionIds.push(session.id);
      continue;
    }
    const laneId = randomUUID();
    legacyLaneIdsById[session.id] = laneId;
    const migrated = maybeWithArchivedAt(
      {
        laneId,
        projectId: session.projectId,
        sessionId: session.sessionId,
        sessionPath: session.sessionPath,
        title: session.title,
        provider: session.provider,
        modelId: session.modelId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      session.archivedAt,
    );
    sessionsById[laneId] = migrated;
    if (session.archivedAt === undefined) {
      const projectSessions = activeSessionsByProject[session.projectId] ?? [];
      projectSessions.push(migrated);
      activeSessionsByProject[session.projectId] = projectSessions;
    } else {
      const order = sessionOrderByProject[session.projectId] ?? [];
      order.push(laneId);
      sessionOrderByProject[session.projectId] = order;
    }
  }

  for (const projectId of projectOrder) {
    const activeSessions = activeSessionsByProject[projectId] ?? [];
    activeSessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const existingOrder = sessionOrderByProject[projectId] ?? [];
    sessionOrderByProject[projectId] = [...activeSessions.map((session) => session.laneId), ...existingOrder];
  }

  const selectedLaneId = lanes.selection ? legacyLaneIdsById[lanes.selection.sessionLaneId] : undefined;
  const selectedProjectId = lanes.selection?.projectId;
  for (const projectId of projectOrder) {
    const activeOrder = activeSessionIdsForProject(
      { version: WORKSPACE_LANES_VERSION_V2, projectsById, projectOrder, sessionsById, sessionOrderByProject, focusByProject },
      projectId,
    );
    const selectedIndex =
      selectedProjectId === projectId && selectedLaneId ? Math.max(0, activeOrder.indexOf(selectedLaneId)) : 0;
    const focusedLaneId = activeOrder[selectedIndex];
    focusByProject[projectId] = focusedLaneId
      ? { focusedLaneId, focusedColumn: selectedIndex }
      : { focusedColumn: 0 };
  }

  const selection =
    selectedProjectId && selectedLaneId && projectsById[selectedProjectId] !== undefined
      ? { projectId: selectedProjectId, laneId: selectedLaneId }
      : undefined;
  const migrated: WorkspaceLanesV2 = selection
    ? { version: 2, projectsById, projectOrder, sessionsById, sessionOrderByProject, focusByProject, selection }
    : { version: 2, projectsById, projectOrder, sessionsById, sessionOrderByProject, focusByProject };

  return { lanes: migrated, migrated: true, droppedSessionIds };
};

export const loadWorkspaceLanesV2 = (configDir: string): WorkspaceLanesMigrationResult => {
  const path = workspaceLanesV2Path(configDir);
  if (!existsSync(path)) return { lanes: emptyWorkspaceLanesV2(), migrated: false, droppedSessionIds: [] };
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const parsedV2 = parseWorkspaceLanesV2(raw);
    if (parsedV2) return { lanes: parsedV2, migrated: false, droppedSessionIds: [] };
    if (isRecord(raw) && raw.version === 1) return migrateWorkspaceLanesV1ToV2(readWorkspaceLanes(configDir));
    return { lanes: emptyWorkspaceLanesV2(), migrated: false, droppedSessionIds: [] };
  } catch {
    return { lanes: emptyWorkspaceLanesV2(), migrated: false, droppedSessionIds: [] };
  }
};

const serializeWorkspaceLanesV2 = (lanes: WorkspaceLanesV2): string =>
  `${JSON.stringify({ ...lanes, version: WORKSPACE_LANES_VERSION_V2 }, null, 2)}\n`;

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

const atomicWriteWorkspaceLanesV2Sync = (path: string, data: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = workspaceLanesV2TempPath(path);
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

const atomicWriteWorkspaceLanesV2 = async (path: string, data: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = workspaceLanesV2TempPath(path);
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

export const writeWorkspaceLanesV2 = (configDir: string, lanes: WorkspaceLanesV2): void => {
  atomicWriteWorkspaceLanesV2Sync(workspaceLanesV2Path(configDir), serializeWorkspaceLanesV2(lanes));
};

const startWorkspaceLanesV2Write = (path: string, pending: PendingWorkspaceLanesV2Write): void => {
  pending.timer = null;
  const writePromise = atomicWriteWorkspaceLanesV2(path, serializeWorkspaceLanesV2(pending.lanes));
  const trackedPromise = writePromise.finally(() => {
    if (pendingWorkspaceLanesV2Writes.get(path) === pending && pending.promise === trackedPromise && pending.timer === null) {
      pendingWorkspaceLanesV2Writes.delete(path);
    }
  });
  pending.promise = trackedPromise;
};

const queueWorkspaceLanesV2Write = (path: string, pending: PendingWorkspaceLanesV2Write, delayMs: number): void => {
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = setTimeout(() => startWorkspaceLanesV2Write(path, pending), delayMs);
};

export const scheduleWriteWorkspaceLanesV2 = (
  configDir: string,
  lanes: WorkspaceLanesV2,
  options: WriteWorkspaceLanesV2Options = {},
): void => {
  if (options.immediate === true) {
    writeWorkspaceLanesV2(configDir, lanes);
    return;
  }

  const path = workspaceLanesV2Path(configDir);
  const existing = pendingWorkspaceLanesV2Writes.get(path);
  if (existing) {
    existing.lanes = lanes;
    queueWorkspaceLanesV2Write(path, existing, options.delayMs ?? 0);
    return;
  }

  const pending: PendingWorkspaceLanesV2Write = {
    lanes,
    timer: null,
    promise: null,
  };
  pendingWorkspaceLanesV2Writes.set(path, pending);
  queueWorkspaceLanesV2Write(path, pending, options.delayMs ?? 0);
};

export const flushWorkspaceLanesV2 = async (configDir?: string): Promise<void> => {
  const entries = [...pendingWorkspaceLanesV2Writes.entries()].filter(([path]) =>
    configDir === undefined ? true : path === workspaceLanesV2Path(configDir),
  );
  await Promise.all(
    entries.map(async ([path, pending]) => {
      if (pending.timer) {
        clearTimeout(pending.timer);
        startWorkspaceLanesV2Write(path, pending);
      }
      await pending.promise;
      if (pendingWorkspaceLanesV2Writes.get(path) === pending) pendingWorkspaceLanesV2Writes.delete(path);
    }),
  );
};

const activeProjectIds = (lanes: WorkspaceLanesV2): ProjectId[] =>
  lanes.projectOrder.filter((projectId) => lanes.projectsById[projectId]?.archivedAt === undefined);

export const activeSessionIdsForProject = (lanes: WorkspaceLanesV2, projectId: ProjectId): LaneId[] =>
  (lanes.sessionOrderByProject[projectId] ?? []).filter((laneId) => {
    const session = lanes.sessionsById[laneId];
    return session !== undefined && session.projectId === projectId && session.archivedAt === undefined;
  });

export const activeSessionsForProject = (lanes: WorkspaceLanesV2, projectId: ProjectId): SessionLaneV2[] =>
  activeSessionIdsForProject(lanes, projectId).flatMap((laneId) => {
    const session = lanes.sessionsById[laneId];
    return session ? [session] : [];
  });

export const findActiveCursorV2 = (lanes: WorkspaceLanesV2, preferred?: WorkspaceSelectionV2): LaneCursorV2 | null => {
  const projects = activeProjectIds(lanes);
  if (projects.length === 0) return null;
  const selectedProjectId = preferred?.projectId ?? lanes.selection?.projectId;
  const selectedLaneId = preferred?.laneId ?? lanes.selection?.laneId;
  const orderedProjects = selectedProjectId
    ? [...projects.filter((projectId) => projectId === selectedProjectId), ...projects.filter((projectId) => projectId !== selectedProjectId)]
    : projects;

  for (const projectId of orderedProjects) {
    const project = lanes.projectsById[projectId];
    if (!project) continue;
    const sessions = activeSessionIdsForProject(lanes, projectId);
    if (sessions.length === 0) continue;
    const selectedIndex = selectedLaneId ? sessions.indexOf(selectedLaneId) : -1;
    const focus = lanes.focusByProject[projectId];
    const focusedIndex = focus?.focusedLaneId ? sessions.indexOf(focus.focusedLaneId) : -1;
    const sessionIndex = selectedIndex >= 0 ? selectedIndex : focusedIndex >= 0 ? focusedIndex : 0;
    const laneId = sessions[sessionIndex];
    const session = laneId ? lanes.sessionsById[laneId] : undefined;
    const projectIndex = projects.indexOf(projectId);
    if (session && projectIndex >= 0) return { project, session, projectIndex, sessionIndex };
  }

  return null;
};

const clampIndex = (index: number, length: number): number => {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
};

export const focusCursor = (lanes: WorkspaceLanesV2, direction: LaneDirection): LaneCursorV2 | null => {
  const current = findActiveCursorV2(lanes);
  if (!current) return null;
  const projects = activeProjectIds(lanes);
  if (direction === "up" || direction === "down") {
    const step = direction === "up" ? -1 : 1;
    for (let offset = 1; offset <= projects.length; offset += 1) {
      const projectId = projects[(current.projectIndex + step * offset + projects.length) % projects.length];
      if (!projectId) continue;
      const project = lanes.projectsById[projectId];
      const sessions = activeSessionIdsForProject(lanes, projectId);
      if (!project || sessions.length === 0) continue;
      const rememberedColumn = lanes.focusByProject[projectId]?.focusedColumn ?? current.sessionIndex;
      const sessionIndex = clampIndex(rememberedColumn, sessions.length);
      const laneId = sessions[sessionIndex];
      const session = laneId ? lanes.sessionsById[laneId] : undefined;
      const projectIndex = projects.indexOf(projectId);
      if (session && projectIndex >= 0) return { project, session, projectIndex, sessionIndex };
    }
    return current;
  }

  const sessions = activeSessionIdsForProject(lanes, current.project.id);
  if (sessions.length <= 1) return current;
  const step = direction === "left" ? -1 : 1;
  const sessionIndex = (current.sessionIndex + step + sessions.length) % sessions.length;
  const laneId = sessions[sessionIndex];
  const session = laneId ? lanes.sessionsById[laneId] : undefined;
  return session ? { project: current.project, session, projectIndex: current.projectIndex, sessionIndex } : current;
};

const focusForCursor = (cursor: LaneCursorV2): ProjectFocusV2 => ({
  focusedLaneId: cursor.session.laneId,
  focusedColumn: cursor.sessionIndex,
});

const selectCursor = (lanes: WorkspaceLanesV2, cursor: LaneCursorV2): WorkspaceLanesV2 => ({
  ...lanes,
  focusByProject: {
    ...lanes.focusByProject,
    [cursor.project.id]: focusForCursor(cursor),
  },
  selection: {
    projectId: cursor.project.id,
    laneId: cursor.session.laneId,
  },
});

const insertLaneId = (order: readonly LaneId[], laneId: LaneId, position: InsertPosition): LaneId[] => {
  const withoutLane = order.filter((id) => id !== laneId);
  if (position.type === "after") {
    const afterIndex = withoutLane.indexOf(position.laneId);
    const index = afterIndex >= 0 ? afterIndex + 1 : withoutLane.length;
    return [...withoutLane.slice(0, index), laneId, ...withoutLane.slice(index)];
  }
  if (position.type === "index") {
    const index = Math.min(Math.max(position.index, 0), withoutLane.length);
    return [...withoutLane.slice(0, index), laneId, ...withoutLane.slice(index)];
  }
  return [...withoutLane, laneId];
};

const removeLaneIdFromAllOrders = (orders: Record<ProjectId, LaneId[]>, laneId: LaneId): Record<ProjectId, LaneId[]> => {
  const next: Record<ProjectId, LaneId[]> = {};
  for (const [projectId, order] of Object.entries(orders)) {
    next[projectId] = order.filter((id) => id !== laneId);
  }
  return next;
};

export const insertSessionAfter = (lanes: WorkspaceLanesV2, laneId: LaneId, afterLaneId: LaneId): WorkspaceLanesV2 => {
  const session = lanes.sessionsById[laneId];
  const afterSession = lanes.sessionsById[afterLaneId];
  if (!session || !afterSession) return lanes;
  return reduceWorkspaceLanePatch(lanes, {
    type: "upsertSession",
    session: { ...session, projectId: afterSession.projectId },
    insert: { type: "after", laneId: afterLaneId },
  });
};

export const reorderSession = (lanes: WorkspaceLanesV2, laneId: LaneId, direction: "left" | "right"): WorkspaceLanesV2 => {
  const session = lanes.sessionsById[laneId];
  if (!session) return lanes;
  const order = lanes.sessionOrderByProject[session.projectId] ?? [];
  const index = order.indexOf(laneId);
  if (index < 0 || order.length <= 1) return lanes;
  const step = direction === "left" ? -1 : 1;
  const nextIndex = (index + step + order.length) % order.length;
  const nextOrder = [...order];
  nextOrder[index] = order[nextIndex] ?? laneId;
  nextOrder[nextIndex] = laneId;
  const nextLanes = {
    ...lanes,
    sessionOrderByProject: { ...lanes.sessionOrderByProject, [session.projectId]: nextOrder },
  };
  const cursor = findActiveCursorV2(nextLanes, { projectId: session.projectId, laneId });
  return cursor ? selectCursor(nextLanes, cursor) : nextLanes;
};

export const moveSessionToProject = (lanes: WorkspaceLanesV2, laneId: LaneId, direction: "up" | "down"): WorkspaceLanesV2 => {
  const session = lanes.sessionsById[laneId];
  if (!session) return lanes;
  const projects = activeProjectIds(lanes);
  const sourceProjectIndex = projects.indexOf(session.projectId);
  if (sourceProjectIndex < 0 || projects.length <= 1) return lanes;
  const step = direction === "up" ? -1 : 1;
  const destinationProjectId = projects[(sourceProjectIndex + step + projects.length) % projects.length];
  if (!destinationProjectId || destinationProjectId === session.projectId) return lanes;
  const destinationOrder = lanes.sessionOrderByProject[destinationProjectId] ?? [];
  const destinationColumn = lanes.focusByProject[destinationProjectId]?.focusedColumn ?? destinationOrder.length;
  const destinationIndex = Math.min(Math.max(destinationColumn, 0), destinationOrder.length);
  const nextOrders = removeLaneIdFromAllOrders(lanes.sessionOrderByProject, laneId);
  nextOrders[destinationProjectId] = insertLaneId(nextOrders[destinationProjectId] ?? [], laneId, {
    type: "index",
    projectId: destinationProjectId,
    index: destinationIndex,
  });
  const nextSession = maybeWithArchivedAt(
    { ...session, projectId: destinationProjectId },
    session.archivedAt,
  );
  const nextLanes = {
    ...lanes,
    sessionsById: { ...lanes.sessionsById, [laneId]: nextSession },
    sessionOrderByProject: nextOrders,
  };
  const cursor = findActiveCursorV2(nextLanes, { projectId: destinationProjectId, laneId });
  return cursor ? selectCursor(nextLanes, cursor) : nextLanes;
};

export const reduceWorkspaceLanePatch = (lanes: WorkspaceLanesV2, patch: WorkspaceLanePatch): WorkspaceLanesV2 => {
  switch (patch.type) {
    case "upsertProject": {
      const existing = lanes.projectsById[patch.project.id];
      const project = maybeWithArchivedAt(
        {
          id: patch.project.id,
          cwd: patch.project.cwd,
          title: patch.project.title ?? existing?.title ?? toTitle(patch.project.cwd),
          createdAt: patch.project.createdAt ?? existing?.createdAt ?? patch.project.updatedAt,
          updatedAt: patch.project.updatedAt,
        },
        patch.project.archivedAt ?? existing?.archivedAt,
      );
      const projectOrder = existing ? lanes.projectOrder : [...lanes.projectOrder, patch.project.id];
      return {
        ...lanes,
        projectsById: { ...lanes.projectsById, [patch.project.id]: project },
        projectOrder,
        sessionOrderByProject: { ...lanes.sessionOrderByProject, [patch.project.id]: lanes.sessionOrderByProject[patch.project.id] ?? [] },
        focusByProject: { ...lanes.focusByProject, [patch.project.id]: lanes.focusByProject[patch.project.id] ?? { focusedColumn: 0 } },
      };
    }
    case "upsertSession": {
      if (lanes.projectsById[patch.session.projectId] === undefined) return lanes;
      const location = patch.session.location ?? lanes.sessionsById[patch.session.laneId]?.location;
      const session = maybeWithArchivedAt(
        {
          laneId: patch.session.laneId,
          projectId: patch.session.projectId,
          sessionId: patch.session.sessionId,
          sessionPath: patch.session.sessionPath,
          title: patch.session.title,
          provider: patch.session.provider,
          modelId: patch.session.modelId,
          ...(location !== undefined ? { location } : {}),
          createdAt: patch.session.createdAt,
          updatedAt: patch.session.updatedAt,
        },
        patch.session.archivedAt,
      );
      const nextOrders = removeLaneIdFromAllOrders(lanes.sessionOrderByProject, patch.session.laneId);
      const position = patch.insert ?? { type: "end", projectId: patch.session.projectId };
      nextOrders[patch.session.projectId] = insertLaneId(nextOrders[patch.session.projectId] ?? [], patch.session.laneId, position);
      return {
        ...lanes,
        sessionsById: { ...lanes.sessionsById, [patch.session.laneId]: session },
        sessionOrderByProject: nextOrders,
      };
    }
    case "select": {
      const cursor = findActiveCursorV2(lanes, { projectId: patch.projectId, laneId: patch.laneId });
      return cursor ? selectCursor(lanes, cursor) : lanes;
    }
    case "focus": {
      const cursor = focusCursor(lanes, patch.direction);
      return cursor ? selectCursor(lanes, cursor) : lanes;
    }
    case "reorderSession":
      return reorderSession(lanes, patch.laneId, patch.direction);
    case "moveSessionToProject":
      return moveSessionToProject(lanes, patch.laneId, patch.direction);
    case "archiveSession": {
      const session = lanes.sessionsById[patch.laneId];
      if (!session || session.archivedAt !== undefined) return lanes;
      return {
        ...lanes,
        sessionsById: { ...lanes.sessionsById, [patch.laneId]: { ...session, archivedAt: session.updatedAt } },
      };
    }
    case "restoreSession": {
      const session = lanes.sessionsById[patch.laneId];
      if (!session) return lanes;
      const projectId = patch.projectId ?? session.projectId;
      if (lanes.projectsById[projectId] === undefined) return lanes;
      const restored: SessionLaneV2 = {
        laneId: session.laneId,
        projectId,
        sessionId: session.sessionId,
        sessionPath: session.sessionPath,
        title: session.title,
        provider: session.provider,
        modelId: session.modelId,
        ...(session.location !== undefined ? { location: session.location } : {}),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
      const nextOrders = removeLaneIdFromAllOrders(lanes.sessionOrderByProject, patch.laneId);
      const existingOrder = lanes.sessionOrderByProject[projectId] ?? [];
      const preserveIndex = existingOrder.indexOf(patch.laneId);
      const insert = patch.insert ?? { type: "index", projectId, index: preserveIndex >= 0 ? preserveIndex : existingOrder.length };
      nextOrders[projectId] = insertLaneId(nextOrders[projectId] ?? [], patch.laneId, insert);
      return {
        ...lanes,
        sessionsById: { ...lanes.sessionsById, [patch.laneId]: restored },
        sessionOrderByProject: nextOrders,
      };
    }
    case "renameSession": {
      const session = lanes.sessionsById[patch.laneId];
      const title = patch.title.trim();
      if (!session || title.length === 0) return lanes;
      return {
        ...lanes,
        sessionsById: { ...lanes.sessionsById, [patch.laneId]: { ...session, title } },
      };
    }
    case "setSessionLocation": {
      const session = lanes.sessionsById[patch.laneId];
      if (!session) return lanes;
      const { location: _location, ...rest } = session;
      const nextSession = patch.location === undefined ? rest : { ...rest, location: patch.location };
      return {
        ...lanes,
        sessionsById: { ...lanes.sessionsById, [patch.laneId]: nextSession },
      };
    }
    case "touchSession": {
      const session = lanes.sessionsById[patch.laneId];
      if (!session) return lanes;
      return {
        ...lanes,
        sessionsById: { ...lanes.sessionsById, [patch.laneId]: { ...session, updatedAt: patch.updatedAt } },
      };
    }
  }
};

export const reduceWorkspaceLanePatches = (lanes: WorkspaceLanesV2, patches: readonly WorkspaceLanePatch[]): WorkspaceLanesV2 =>
  patches.reduce(reduceWorkspaceLanePatch, lanes);

export const createWorkspaceLaneStore = (
  configDir: string,
  onChange?: WorkspaceLaneStoreListener,
  options: WriteWorkspaceLanesV2Options = {},
): WorkspaceLaneStore => {
  const loaded = loadWorkspaceLanesV2(configDir);
  let current = loaded.lanes;
  let currentRevision = 0;
  const listeners = new Set<WorkspaceLaneStoreListener>();
  if (onChange) listeners.add(onChange);

  const notify = (): void => {
    for (const listener of listeners) listener(current, currentRevision);
  };

  const persist = (): void => scheduleWriteWorkspaceLanesV2(configDir, current, options);

  if (loaded.migrated) scheduleWriteWorkspaceLanesV2(configDir, current, { ...options, immediate: true });

  return {
    lanes: () => current,
    revision: () => currentRevision,
    dispatch: (patch: WorkspaceLanePatch): WorkspaceLanesV2 => {
      current = reduceWorkspaceLanePatch(current, patch);
      currentRevision += 1;
      notify();
      persist();
      return current;
    },
    transact: (patches: readonly WorkspaceLanePatch[]): WorkspaceLanesV2 => {
      current = reduceWorkspaceLanePatches(current, patches);
      currentRevision += 1;
      notify();
      persist();
      return current;
    },
    subscribe: (listener: WorkspaceLaneStoreListener): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flush: () => flushWorkspaceLanesV2(configDir),
  };
};

export const createSessionLaneInput = (
  input: Omit<SessionLaneInput, "laneId"> & { readonly laneId?: LaneId },
): SessionLaneInput => ({
  laneId: input.laneId ?? randomUUID(),
  projectId: input.projectId,
  sessionId: input.sessionId,
  sessionPath: input.sessionPath,
  title: input.title,
  provider: input.provider,
  modelId: input.modelId,
  ...(input.location !== undefined ? { location: input.location } : {}),
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
  ...withoutUndefined(input.archivedAt ? { archivedAt: input.archivedAt } : {}),
});

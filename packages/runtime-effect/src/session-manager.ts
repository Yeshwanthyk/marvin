import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppMessage, ThinkingLevel } from "@yeshwanthyk/agent-core";
import { Context, Effect, Layer } from "effect";

let lastSessionTimestamp = 0;
const CURRENT_SESSION_VERSION = 3;

export interface CompactionState {
  lastSummary: string;
  readFiles: string[];
  modifiedFiles: string[];
}

export interface SessionMetadata {
  type: "session";
  id: string;
  version?: number;
  timestamp: number | string;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  compaction?: CompactionState;
}

export interface SessionMessageEntry {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: number | string;
  message: AppMessage;
}

export interface SessionCustomEntry<T = unknown> {
  type: "custom";
  id: string;
  parentId: string | null;
  timestamp: number | string;
  customType: string;
  data?: T;
}

export type SessionEntry = SessionMetadata | SessionMessageEntry | SessionCustomEntry;
export type SessionNodeEntry = SessionMessageEntry | SessionCustomEntry;

export interface SessionTreeNode {
  entry: SessionNodeEntry;
  children: SessionTreeNode[];
}

export interface SessionInfo {
  id: string;
  timestamp: number;
  path: string;
  provider: string;
  modelId: string;
}

export interface SessionDetails extends SessionInfo {
  messageCount: number;
  firstMessage: string;
  lastActivity: number;
}

export interface LoadedSession {
  metadata: SessionMetadata;
  messages: AppMessage[];
  leafId: string | null;
}

export interface ReadonlySessionManager {
  sessionId: string | null;
  sessionPath: string | null;
  getCompactionState(): CompactionState | undefined;
  getEntries(): SessionEntry[];
  getTree(): SessionTreeNode[];
  getBranch(fromId?: string | null): SessionNodeEntry[];
  getLeafId(): string | null;
  getEntry(id: string): SessionNodeEntry | undefined;
  listSessions(): SessionInfo[];
  loadSession(sessionPath: string): LoadedSession | null;
  loadLatest(): LoadedSession | null;
  findSession(identifier: string): SessionInfo | null;
}

const safeCwd = (cwd: string): string => `--${cwd.replace(/\//g, "--")}--`;

function isSessionEntry(value: unknown): value is SessionEntry {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as Record<string, unknown>).type;
  return type === "session" || type === "message" || type === "custom";
}

function isNodeEntry(entry: SessionEntry): entry is SessionNodeEntry {
  return entry.type === "message" || entry.type === "custom";
}

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEntryId(existingIds: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().replace(/-/g, "").slice(0, 8);
    if (!existingIds.has(id)) {
      existingIds.add(id);
      return id;
    }
  }
  const fallback = randomUUID();
  existingIds.add(fallback);
  return fallback;
}

function parseTimestamp(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function ensureTreeFields(entries: SessionEntry[]): boolean {
  let previousId: string | null = null;
  let migrated = false;
  const ids = new Set<string>();

  for (const entry of entries) {
    if (entry.type === "session") {
      if (entry.version !== CURRENT_SESSION_VERSION) {
        entry.version = CURRENT_SESSION_VERSION;
        migrated = true;
      }
      if (typeof entry.timestamp === "number") {
        entry.timestamp = new Date(entry.timestamp).toISOString();
        migrated = true;
      }
      continue;
    }

    const mutable = entry as unknown as { id?: string; parentId?: string | null };
    if (typeof mutable.id !== "string" || mutable.id.length === 0) {
      mutable.id = createEntryId(ids);
      migrated = true;
    } else {
      ids.add(mutable.id);
    }
    if (typeof mutable.parentId === "undefined") {
      mutable.parentId = previousId;
      migrated = true;
    }
    if (typeof entry.timestamp === "number") {
      entry.timestamp = new Date(entry.timestamp).toISOString();
      migrated = true;
    }
    previousId = mutable.id;
  }

  return migrated;
}

export class SessionManager implements ReadonlySessionManager {
  private cwd: string;
  private sessionDir: string;
  private currentSessionPath: string | null = null;
  private currentSessionId: string | null = null;
  private leafId: string | null = null;

  constructor(configDir: string = join(process.env.HOME || "", ".config", "marvin")) {
    this.cwd = process.cwd();
    this.sessionDir = join(configDir, "sessions", safeCwd(this.cwd));
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  startSession(provider: string, modelId: string, thinkingLevel: ThinkingLevel): string {
    this.ensureDir();

    const id = randomUUID();
    const now = Date.now();
    const timestamp = now <= lastSessionTimestamp ? lastSessionTimestamp + 1 : now;
    lastSessionTimestamp = timestamp;
    const filename = `${timestamp}_${id}.jsonl`;
    this.currentSessionPath = join(this.sessionDir, filename);
    this.currentSessionId = id;

    const metadata: SessionMetadata = {
      type: "session",
      id,
      timestamp: new Date(timestamp).toISOString(),
      cwd: this.cwd,
      provider,
      modelId,
      thinkingLevel,
      version: CURRENT_SESSION_VERSION,
    };

    writeFileSync(this.currentSessionPath, `${JSON.stringify(metadata)}\n`, "utf8");
    this.leafId = null;
    return id;
  }

  continueSession(sessionPath: string, sessionId: string): void {
    this.currentSessionPath = sessionPath;
    this.currentSessionId = sessionId;
    this.leafId = this.findLastNodeId(sessionPath);
  }

  appendMessage(message: AppMessage): void {
    if (!this.currentSessionPath) return;

    const entry: SessionMessageEntry = {
      type: "message",
      id: createEntryId(new Set(this.readSessionEntries(this.currentSessionPath).filter(isNodeEntry).map((e) => e.id))),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      message,
    };

    appendFileSync(this.currentSessionPath, `${JSON.stringify(entry)}\n`, "utf8");
    this.leafId = entry.id;
  }

  appendEntry<T = unknown>(customType: string, data?: T): void {
    if (!this.currentSessionPath) return;

    const entry: SessionCustomEntry<T> = {
      type: "custom",
      id: createEntryId(new Set(this.readSessionEntries(this.currentSessionPath).filter(isNodeEntry).map((e) => e.id))),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      customType,
    };
    if (data !== undefined) {
      entry.data = data;
    }

    appendFileSync(this.currentSessionPath, `${JSON.stringify(entry)}\n`, "utf8");
    this.leafId = entry.id;
  }

  updateCompactionState(state: CompactionState): void {
    if (!this.currentSessionPath) return;
    try {
      const content = readFileSync(this.currentSessionPath, "utf8");
      const lines = content.trim().split("\n");
      if (lines.length === 0) return;
      const metadata = JSON.parse(lines[0]!) as SessionMetadata;
      metadata.compaction = state;
      metadata.version = CURRENT_SESSION_VERSION;
      lines[0] = JSON.stringify(metadata);
      writeFileSync(this.currentSessionPath, `${lines.join("\n")}\n`, "utf8");
    } catch (err) {
      console.error("Failed to update compaction state:", err);
    }
  }

  getCompactionState(): CompactionState | undefined {
    if (!this.currentSessionPath) return undefined;
    try {
      const content = readFileSync(this.currentSessionPath, "utf8");
      const firstLine = content.split("\n")[0];
      if (!firstLine) return undefined;
      const metadata = JSON.parse(firstLine) as SessionMetadata;
      return metadata.compaction;
    } catch {
      return undefined;
    }
  }

  listSessions(): SessionInfo[] {
    if (!existsSync(this.sessionDir)) return [];

    const files = readdirSync(this.sessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();

    const sessions: SessionInfo[] = [];
    for (const file of files) {
      const path = join(this.sessionDir, file);
      try {
        const firstLine = readFileSync(path, "utf8").split("\n")[0];
        if (!firstLine) continue;
        const metadata = JSON.parse(firstLine) as SessionMetadata;
        if (metadata.type !== "session") continue;
        sessions.push({
          id: metadata.id,
          timestamp: parseTimestamp(metadata.timestamp),
          path,
          provider: metadata.provider,
          modelId: metadata.modelId,
        });
      } catch {
        // skip invalid files
      }
    }

    return sessions;
  }

  loadAllSessions(): SessionDetails[] {
    if (!existsSync(this.sessionDir)) return [];

    const files = readdirSync(this.sessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();

    const sessions: SessionDetails[] = [];
    for (const file of files) {
      const path = join(this.sessionDir, file);
      try {
        const content = readFileSync(path, "utf8");
        const lines = content.trim().split("\n").filter((l) => l.length > 0);
        if (lines.length === 0) continue;

        const metadata = JSON.parse(lines[0]!) as SessionMetadata;
        if (metadata.type !== "session") continue;

        let messageCount = 0;
        let firstMessage = "";

        for (let i = 1; i < lines.length; i++) {
          const entry = JSON.parse(lines[i]!) as SessionEntry;
          if (entry.type === "message") {
            messageCount++;
            if (!firstMessage && entry.message.role === "user") {
              const contentBlock = entry.message.content;
              if (typeof contentBlock === "string") {
                firstMessage = contentBlock;
              } else if (Array.isArray(contentBlock)) {
                const textBlock = contentBlock.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
                if (textBlock) firstMessage = textBlock.text;
              }
            }
          }
        }

        // Use file mtime for last activity (more accurate than creation timestamp)
        const lastActivity = statSync(path).mtimeMs;

        sessions.push({
          id: metadata.id,
          timestamp: parseTimestamp(metadata.timestamp),
          path,
          provider: metadata.provider,
          modelId: metadata.modelId,
          messageCount,
          firstMessage: firstMessage || "(empty session)",
          lastActivity,
        });
      } catch {
        // skip invalid files
      }
    }

    // Sort by last activity (most recent first)
    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  loadLatest(): LoadedSession | null {
    const sessions = this.listSessions();
    if (sessions.length === 0) return null;
    return this.loadSession(sessions[0]!.path);
  }

  loadSession(sessionPath: string): LoadedSession | null {
    if (!existsSync(sessionPath)) return null;

    try {
      const entries = this.readSessionEntries(sessionPath, { migrate: true });
      if (entries.length === 0) return null;

      const metadata = entries[0] as SessionMetadata;
      if (metadata.type !== "session") return null;

      const branch = this.getBranchFromEntries(entries);
      const messages = branch
        .filter((entry): entry is SessionMessageEntry => entry.type === "message")
        .map((entry) => entry.message);
      const leafId = branch.at(-1)?.id ?? null;

      return { metadata, messages, leafId };
    } catch {
      return null;
    }
  }

  findSession(identifier: string): SessionInfo | null {
    // If it looks like an absolute path or contains .jsonl, try direct path load
    if (identifier.startsWith("/") || identifier.includes(".jsonl")) {
      const resolvedPath = identifier.startsWith("/") ? identifier : join(this.sessionDir, identifier);
      if (!existsSync(resolvedPath)) return null;
      try {
        const firstLine = readFileSync(resolvedPath, "utf8").split("\n")[0];
        if (!firstLine) return null;
        const metadata = JSON.parse(firstLine) as SessionMetadata;
        if (metadata.type !== "session") return null;
        return {
          id: metadata.id,
          timestamp: parseTimestamp(metadata.timestamp),
          path: resolvedPath,
          provider: metadata.provider,
          modelId: metadata.modelId,
        };
      } catch {
        return null;
      }
    }

    // Otherwise search by UUID or UUID prefix in current directory's sessions
    const sessions = this.listSessions();
    // Try exact match first
    const exact = sessions.find((s) => s.id === identifier);
    if (exact) return exact;
    // Try prefix match (most recent if multiple match)
    const prefixMatch = sessions.find((s) => s.id.startsWith(identifier));
    return prefixMatch ?? null;
  }

  get sessionId(): string | null {
    return this.currentSessionId;
  }

  get sessionPath(): string | null {
    return this.currentSessionPath;
  }

  forkSession(): { id: string; path: string } | null {
    if (!this.currentSessionPath || !existsSync(this.currentSessionPath)) {
      return null;
    }

    try {
      const content = readFileSync(this.currentSessionPath, "utf8");
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      if (lines.length === 0) return null;

      const originalMetadata = JSON.parse(lines[0]!) as SessionMetadata;
      if (originalMetadata.type !== "session") return null;

      const newId = randomUUID();
      const now = Date.now();
      const timestamp = now <= lastSessionTimestamp ? lastSessionTimestamp + 1 : now;
      lastSessionTimestamp = timestamp;

      const newMetadata: SessionMetadata & { forkedFrom?: string } = {
        ...originalMetadata,
        id: newId,
        timestamp: new Date(timestamp).toISOString(),
        version: CURRENT_SESSION_VERSION,
        forkedFrom: originalMetadata.id,
      };

      const newLines = [JSON.stringify(newMetadata), ...lines.slice(1)];
      const filename = `${timestamp}_${newId}.jsonl`;
      const newPath = join(this.sessionDir, filename);

      this.ensureDir();
      writeFileSync(newPath, `${newLines.join("\n")}\n`, "utf8");

      return { id: newId, path: newPath };
    } catch {
      return null;
    }
  }

  getEntries(): SessionEntry[] {
    if (!this.currentSessionPath || !existsSync(this.currentSessionPath)) return [];

    return this.readSessionEntries(this.currentSessionPath, { migrate: true });
  }

  getLeafId(): string | null {
    return this.leafId;
  }

  getEntry(id: string): SessionNodeEntry | undefined {
    return this.getEntries().find((entry): entry is SessionNodeEntry => isNodeEntry(entry) && entry.id === id);
  }

  getBranch(fromId: string | null = this.leafId): SessionNodeEntry[] {
    if (!this.currentSessionPath || !existsSync(this.currentSessionPath)) return [];
    const entries = this.readSessionEntries(this.currentSessionPath, { migrate: true });
    return this.getBranchFromEntries(entries, fromId);
  }

  getTree(): SessionTreeNode[] {
    const nodes = this.getEntries().filter(isNodeEntry);
    const byId = new Map<string, SessionTreeNode>();
    const roots: SessionTreeNode[] = [];

    for (const entry of nodes) {
      byId.set(entry.id, { entry: cloneJson(entry), children: [] });
    }

    for (const entry of nodes) {
      const node = byId.get(entry.id);
      if (!node) continue;
      if (entry.parentId === null || entry.parentId === entry.id) {
        roots.push(node);
        continue;
      }
      const parent = byId.get(entry.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortStack = [...roots];
    while (sortStack.length > 0) {
      const node = sortStack.pop();
      if (!node) continue;
      node.children.sort((a, b) => parseTimestamp(a.entry.timestamp) - parseTimestamp(b.entry.timestamp));
      sortStack.push(...node.children);
    }

    return roots;
  }

  branch(entryId: string): void {
    if (!this.getEntry(entryId)) {
      throw new Error(`Entry ${entryId} not found`);
    }
    this.leafId = entryId;
  }

  resetLeaf(): void {
    this.leafId = null;
  }

  private readSessionEntries(sessionPath: string, options?: { migrate?: boolean }): SessionEntry[] {
    try {
      const content = readFileSync(sessionPath, "utf8");
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      const entries: SessionEntry[] = [];

      for (const line of lines) {
        const parsed: unknown = JSON.parse(line);
        if (isSessionEntry(parsed)) {
          entries.push(parsed);
        }
      }

      if (options?.migrate && ensureTreeFields(entries)) {
        writeFileSync(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
      }

      return entries;
    } catch {
      return [];
    }
  }

  private getBranchFromEntries(entries: SessionEntry[], fromId: string | null = this.findLastNodeIdInEntries(entries)): SessionNodeEntry[] {
    if (fromId === null) return [];
    const byId = new Map<string, SessionNodeEntry>();
    for (const entry of entries) {
      if (isNodeEntry(entry)) byId.set(entry.id, entry);
    }

    const branch: SessionNodeEntry[] = [];
    let current = byId.get(fromId);
    while (current) {
      branch.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return branch;
  }

  private findLastNodeId(sessionPath: string): string | null {
    return this.findLastNodeIdInEntries(this.readSessionEntries(sessionPath, { migrate: true }));
  }

  private findLastNodeIdInEntries(entries: SessionEntry[]): string | null {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry && isNodeEntry(entry)) return entry.id;
    }
    return null;
  }
}

export interface SessionManagerService {
  readonly sessionManager: SessionManager;
}

export const SessionManagerTag = Context.GenericTag<SessionManagerService>("runtime-effect/SessionManager");

export const SessionManagerLayer = (configDir?: string) =>
  Layer.effect(
    SessionManagerTag,
    Effect.sync(() => ({
      sessionManager: new SessionManager(configDir),
    })),
  );

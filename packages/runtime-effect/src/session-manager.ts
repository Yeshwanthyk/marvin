import { appendFile, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppMessage, ThinkingLevel } from "@yeshwanthyk/agent-core";
import { Context, Effect, Layer } from "effect";

let lastSessionTimestamp = 0;

export interface CompactionState {
  lastSummary: string;
  readFiles: string[];
  modifiedFiles: string[];
}

export interface SessionMetadata {
  type: "session";
  id: string;
  timestamp: number;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  compaction?: CompactionState;
}

export interface SessionMessageEntry {
  type: "message";
  timestamp: number;
  message: AppMessage;
}

export interface SessionCustomEntry<T = unknown> {
  type: "custom";
  timestamp: number;
  customType: string;
  data?: T;
}

export type SessionEntry = SessionMetadata | SessionMessageEntry | SessionCustomEntry;

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
}

export interface ReadonlySessionManager {
  sessionId: string | null;
  sessionPath: string | null;
  getCompactionState(): CompactionState | undefined;
  getEntries(): SessionEntry[];
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

export class SessionManager implements ReadonlySessionManager {
  private cwd: string;
  private sessionDir: string;
  private currentSessionPath: string | null = null;
  private currentSessionId: string | null = null;

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
      timestamp,
      cwd: this.cwd,
      provider,
      modelId,
      thinkingLevel,
    };

    writeFileSync(this.currentSessionPath, `${JSON.stringify(metadata)}\n`, "utf8");
    return id;
  }

  continueSession(sessionPath: string, sessionId: string): void {
    this.currentSessionPath = sessionPath;
    this.currentSessionId = sessionId;
  }

  appendMessage(message: AppMessage): void {
    if (!this.currentSessionPath) return;

    const entry: SessionMessageEntry = {
      type: "message",
      timestamp: Date.now(),
      message,
    };

    appendFile(this.currentSessionPath, `${JSON.stringify(entry)}\n`, (err) => {
      if (err) console.error("Session write error:", err.message);
    });
  }

  appendEntry<T = unknown>(customType: string, data?: T): void {
    if (!this.currentSessionPath) return;

    const entry: SessionCustomEntry<T> = {
      type: "custom",
      timestamp: Date.now(),
      customType,
    };
    if (data !== undefined) {
      entry.data = data;
    }

    appendFile(this.currentSessionPath, `${JSON.stringify(entry)}\n`, (err) => {
      if (err) console.error("Session write error:", err.message);
    });
  }

  updateCompactionState(state: CompactionState): void {
    if (!this.currentSessionPath) return;
    try {
      const content = readFileSync(this.currentSessionPath, "utf8");
      const lines = content.trim().split("\n");
      if (lines.length === 0) return;
      const metadata = JSON.parse(lines[0]!) as SessionMetadata;
      metadata.compaction = state;
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
          timestamp: metadata.timestamp,
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
          timestamp: metadata.timestamp,
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
      const content = readFileSync(sessionPath, "utf8");
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      if (lines.length === 0) return null;

      const metadata = JSON.parse(lines[0]!) as SessionMetadata;
      if (metadata.type !== "session") return null;

      const messages: AppMessage[] = [];
      for (let i = 1; i < lines.length; i++) {
        const entry = JSON.parse(lines[i]!) as SessionEntry;
        if (entry.type === "message") {
          messages.push(entry.message);
        }
      }

      return { metadata, messages };
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
          timestamp: metadata.timestamp,
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
        timestamp,
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

    try {
      const content = readFileSync(this.currentSessionPath, "utf8");
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      const entries: SessionEntry[] = [];

      for (const line of lines) {
        const parsed: unknown = JSON.parse(line);
        if (isSessionEntry(parsed)) {
          entries.push(parsed);
        }
      }

      return entries;
    } catch {
      return [];
    }
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

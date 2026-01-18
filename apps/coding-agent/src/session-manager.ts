import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFile } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { AppMessage, ThinkingLevel } from '@marvin-agents/agent-core';

// Ensure strictly increasing timestamps within a process, even if multiple sessions start in the same millisecond.
let lastSessionTimestamp = 0;

/**
 * Compaction state stored in session for iterative updates.
 */
export interface CompactionState {
  lastSummary: string;
  readFiles: string[];
  modifiedFiles: string[];
}

export interface SessionMetadata {
  type: 'session';
  id: string;
  timestamp: number;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  compaction?: CompactionState;
}

export interface SessionMessageEntry {
  type: 'message';
  timestamp: number;
  message: AppMessage;
}

export interface SessionCustomEntry<T = unknown> {
  type: 'custom';
  timestamp: number;
  customType: string;
  data?: T;
}

export type SessionEntry = SessionMetadata | SessionMessageEntry | SessionCustomEntry;

/** Read-only session manager interface for hooks */
export interface ReadonlySessionManager {
  sessionId: string | null
  sessionPath: string | null
  getCompactionState(): CompactionState | undefined
  getEntries(): SessionEntry[]
  listSessions(): SessionInfo[]
  loadSession(sessionPath: string): LoadedSession | null
  loadLatest(): LoadedSession | null
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
}

export interface LoadedSession {
  metadata: SessionMetadata;
  messages: AppMessage[];
}

// Convert cwd to safe directory name: /Users/foo/project → --Users--foo--project--
const safeCwd = (cwd: string): string => {
  return '--' + cwd.replace(/\//g, '--') + '--';
};

export class SessionManager {
  private cwd: string;
  private sessionDir: string;
  private currentSessionPath: string | null = null;
  private currentSessionId: string | null = null;

  constructor(configDir: string = join(process.env.HOME || '', '.config', 'marvin')) {
    this.cwd = process.cwd();
    this.sessionDir = join(configDir, 'sessions', safeCwd(this.cwd));
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  /**
   * Start a new session with metadata
   */
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
      type: 'session',
      id,
      timestamp,
      cwd: this.cwd,
      provider,
      modelId,
      thinkingLevel,
    };

    writeFileSync(this.currentSessionPath, JSON.stringify(metadata) + '\n');
    return id;
  }

  /**
   * Append a message to the current session (async, non-blocking)
   */
  appendMessage(message: AppMessage): void {
    if (!this.currentSessionPath) return;

    const entry: SessionMessageEntry = {
      type: 'message',
      timestamp: Date.now(),
      message,
    };

    // Fire-and-forget async write - errors logged but don't block UI
    appendFile(this.currentSessionPath, JSON.stringify(entry) + '\n', (err) => {
      if (err) console.error('Session write error:', err.message);
    });
  }

  /**
   * Continue existing session (set current path without writing header)
   */
  continueSession(sessionPath: string, sessionId: string): void {
    this.currentSessionPath = sessionPath;
    this.currentSessionId = sessionId;
  }

  /**
   * Update compaction state in current session metadata.
   * Rewrites the session file with updated metadata.
   */
  updateCompactionState(state: CompactionState): void {
    if (!this.currentSessionPath) return;
    
    try {
      const content = readFileSync(this.currentSessionPath, 'utf8');
      const lines = content.trim().split('\n');
      if (lines.length === 0) return;
      
      const metadata = JSON.parse(lines[0]!) as SessionMetadata;
      metadata.compaction = state;
      
      // Rewrite file with updated metadata
      lines[0] = JSON.stringify(metadata);
      writeFileSync(this.currentSessionPath, lines.join('\n') + '\n');
    } catch (err) {
      console.error('Failed to update compaction state:', err);
    }
  }

  /**
   * Get current compaction state from session metadata.
   */
  getCompactionState(): CompactionState | undefined {
    if (!this.currentSessionPath) return undefined;
    
    try {
      const content = readFileSync(this.currentSessionPath, 'utf8');
      const firstLine = content.split('\n')[0];
      if (!firstLine) return undefined;
      
      const metadata = JSON.parse(firstLine) as SessionMetadata;
      return metadata.compaction;
    } catch {
      return undefined;
    }
  }

  /**
   * List all sessions for current cwd, sorted by timestamp desc
   */
  listSessions(): SessionInfo[] {
    if (!existsSync(this.sessionDir)) return [];

    const files = readdirSync(this.sessionDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    const sessions: SessionInfo[] = [];
    for (const file of files) {
      const path = join(this.sessionDir, file);
      try {
        const firstLine = readFileSync(path, 'utf8').split('\n')[0];
        if (!firstLine) continue;
        const metadata = JSON.parse(firstLine) as SessionMetadata;
        if (metadata.type !== 'session') continue;
        sessions.push({
          id: metadata.id,
          timestamp: metadata.timestamp,
          path,
          provider: metadata.provider,
          modelId: metadata.modelId,
        });
      } catch {
        // Skip invalid files
      }
    }

    return sessions;
  }

  /**
   * Load all sessions with message details for picker display
   */
  loadAllSessions(): SessionDetails[] {
    if (!existsSync(this.sessionDir)) return [];

    const files = readdirSync(this.sessionDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    const sessions: SessionDetails[] = [];
    for (const file of files) {
      const path = join(this.sessionDir, file);
      try {
        const content = readFileSync(path, 'utf8');
        const lines = content.trim().split('\n').filter(l => l.length > 0);
        if (lines.length === 0) continue;

        const metadata = JSON.parse(lines[0]!) as SessionMetadata;
        if (metadata.type !== 'session') continue;

        let messageCount = 0;
        let firstMessage = '';

        for (let i = 1; i < lines.length; i++) {
          const entry = JSON.parse(lines[i]!) as SessionEntry;
          if (entry.type === 'message') {
            messageCount++;
            // Capture first user message for display
            if (!firstMessage && entry.message.role === 'user') {
              const content = entry.message.content;
              if (typeof content === 'string') {
                firstMessage = content;
              } else if (Array.isArray(content)) {
                const textBlock = content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
                if (textBlock) firstMessage = textBlock.text;
              }
            }
          }
        }

        sessions.push({
          id: metadata.id,
          timestamp: metadata.timestamp,
          path,
          provider: metadata.provider,
          modelId: metadata.modelId,
          messageCount,
          firstMessage: firstMessage || '(empty session)',
        });
      } catch {
        // Skip invalid files
      }
    }

    return sessions;
  }

  /**
   * Load the most recent session for current cwd
   */
  loadLatest(): LoadedSession | null {
    const sessions = this.listSessions();
    if (sessions.length === 0) return null;
    return this.loadSession(sessions[0]!.path);
  }

  /**
   * Load a specific session by path
   */
  loadSession(sessionPath: string): LoadedSession | null {
    if (!existsSync(sessionPath)) return null;

    try {
      const content = readFileSync(sessionPath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);
      
      if (lines.length === 0) return null;

      const metadata = JSON.parse(lines[0]!) as SessionMetadata;
      if (metadata.type !== 'session') return null;

      const messages: AppMessage[] = [];
      for (let i = 1; i < lines.length; i++) {
        const entry = JSON.parse(lines[i]!) as SessionEntry;
        if (entry.type === 'message') {
          messages.push(entry.message);
        }
      }

      return { metadata, messages };
    } catch {
      return null;
    }
  }

  get sessionId(): string | null {
    return this.currentSessionId;
  }

  get sessionPath(): string | null {
    return this.currentSessionPath;
  }

  /**
   * Append a custom entry to the current session (async, non-blocking)
   */
  appendEntry<T = unknown>(customType: string, data?: T): void {
    if (!this.currentSessionPath) return;

    const entry: SessionCustomEntry<T> = {
      type: 'custom',
      timestamp: Date.now(),
      customType,
      data,
    };

    appendFile(this.currentSessionPath, JSON.stringify(entry) + '\n', (err) => {
      if (err) console.error('Session write error:', err.message);
    });
  }

  /**
   * Get all entries from the current session
   */
  getEntries(): SessionEntry[] {
    if (!this.currentSessionPath || !existsSync(this.currentSessionPath)) return [];

    try {
      const content = readFileSync(this.currentSessionPath, 'utf8');
      const lines = content.trim().split('\n').filter((l) => l.length > 0);
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

function isSessionEntry(value: unknown): value is SessionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as Record<string, unknown>).type;
  return type === 'session' || type === 'message' || type === 'custom';
}

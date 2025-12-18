import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { AppMessage, ThinkingLevel } from '@mu-agents/agent-core';

// Ensure strictly increasing timestamps within a process, even if multiple sessions start in the same millisecond.
let lastSessionTimestamp = 0;

export interface SessionMetadata {
  type: 'session';
  id: string;
  timestamp: number;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export interface SessionMessageEntry {
  type: 'message';
  timestamp: number;
  message: AppMessage;
}

export type SessionEntry = SessionMetadata | SessionMessageEntry;

export interface SessionInfo {
  id: string;
  timestamp: number;
  path: string;
  provider: string;
  modelId: string;
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
  private configDir: string;
  private cwd: string;
  private sessionDir: string;
  private currentSessionPath: string | null = null;
  private currentSessionId: string | null = null;

  constructor(configDir: string = join(process.env.HOME || '', '.config', 'mu-agent')) {
    this.configDir = configDir;
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
   * Append a message to the current session
   */
  appendMessage(message: AppMessage): void {
    if (!this.currentSessionPath) return;

    const entry: SessionMessageEntry = {
      type: 'message',
      timestamp: Date.now(),
      message,
    };

    appendFileSync(this.currentSessionPath, JSON.stringify(entry) + '\n');
  }

  /**
   * Continue existing session (set current path without writing header)
   */
  continueSession(sessionPath: string, sessionId: string): void {
    this.currentSessionPath = sessionPath;
    this.currentSessionId = sessionId;
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
}

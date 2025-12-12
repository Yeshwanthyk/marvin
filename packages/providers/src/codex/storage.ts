import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CodexTokenPayload, CodexTokenStorage } from './types';

const defaultStoragePath = join(homedir(), '.config', 'mu', 'codex-token.json');

export interface FileTokenStorageOptions {
  path?: string;
}

export class FileTokenStorage implements CodexTokenStorage {
  private readonly path: string;

  constructor(options?: FileTokenStorageOptions) {
    this.path = options?.path ?? defaultStoragePath;
  }

  async load(): Promise<CodexTokenPayload | undefined> {
    try {
      const data = await readFile(this.path, 'utf-8');
      return JSON.parse(data) as CodexTokenPayload;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async save(payload?: CodexTokenPayload): Promise<void> {
    if (!payload) {
      await unlink(this.path).catch(() => undefined);
      return;
    }
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(payload), 'utf-8');
  }
}

export class MemoryTokenStorage implements CodexTokenStorage {
  private payload?: CodexTokenPayload;

  async load(): Promise<CodexTokenPayload | undefined> {
    return this.payload;
  }

  async save(payload?: CodexTokenPayload): Promise<void> {
    this.payload = payload;
  }
}

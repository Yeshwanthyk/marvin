import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { watch } from 'node:fs';

export interface GitBranchInfo {
  gitDir: string;
  headPath: string;
  branch?: string;
  detachedSha?: string;
}

const parseGitdirFile = (content: string): string | undefined => {
  const line = content.trim();
  const m = line.match(/^gitdir:\s*(.+)\s*$/i);
  return m?.[1];
};

export const findGitDir = async (startDir: string): Promise<string | undefined> => {
  let current = path.resolve(startDir);
  while (true) {
    const dotGit = path.join(current, '.git');
    try {
      const stat = await fs.stat(dotGit);
      if (stat.isDirectory()) return dotGit;
      if (stat.isFile()) {
        const content = await fs.readFile(dotGit, 'utf8');
        const gitdir = parseGitdirFile(content);
        if (!gitdir) return undefined;
        return path.resolve(current, gitdir);
      }
    } catch {
      // ignore
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

export const readHead = async (gitDir: string): Promise<GitBranchInfo> => {
  const headPath = path.join(gitDir, 'HEAD');
  const head = (await fs.readFile(headPath, 'utf8')).trim();
  if (head.startsWith('ref:')) {
    const ref = head.slice('ref:'.length).trim();
    const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    return { gitDir, headPath, branch };
  }
  const sha = head.replace(/\s+/g, '');
  return { gitDir, headPath, detachedSha: sha.slice(0, 7) };
};

export class GitBranchWatcher {
  private watcher?: ReturnType<typeof watch>;
  private last?: string;

  async start(
    cwd: string,
    onChange: (branch: string | undefined) => void
  ): Promise<{ stop: () => void; initial?: string }> {
    const gitDir = await findGitDir(cwd);
    if (!gitDir) return { stop: () => {}, initial: undefined };
    const head = await readHead(gitDir);
    const initial = head.branch ?? head.detachedSha;
    this.last = initial;
    onChange(head.branch ?? head.detachedSha);
    this.watcher = watch(head.headPath, { persistent: false }, async () => {
      try {
        const nextHead = await readHead(gitDir);
        const next = nextHead.branch ?? nextHead.detachedSha;
        if (next !== this.last) {
          this.last = next;
          onChange(nextHead.branch ?? nextHead.detachedSha);
        }
      } catch {
        // ignore transient read errors
      }
    });
    return {
      initial,
      stop: () => {
        this.watcher?.close();
      },
    };
  }
}

import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

let cachedShellConfig: { shell: string; args: string[] } | null = null;

const isExecutable = (path: string | undefined): path is string => !!path && existsSync(path);

const findOnPath = (exe: string): string | null => {
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('where', [exe], { encoding: 'utf-8', timeout: 5000 });
      if (result.status === 0 && result.stdout) {
        const first = result.stdout.trim().split(/\r?\n/)[0];
        return first && existsSync(first) ? first : null;
      }
      return null;
    }

    const result = spawnSync('which', [exe], { encoding: 'utf-8', timeout: 5000 });
    if (result.status === 0 && result.stdout) {
      const first = result.stdout.trim().split(/\r?\n/)[0];
      return first && existsSync(first) ? first : null;
    }
  } catch {
    // ignore
  }
  return null;
};

export function getShellConfig(): { shell: string; args: string[] } {
  if (cachedShellConfig) return cachedShellConfig;

  const envShell = process.env.SHELL;

  // Prefer bash when available (matches tool contract).
  const bashPath = process.platform === 'win32' ? findOnPath('bash.exe') : findOnPath('bash');
  if (bashPath) {
    cachedShellConfig = { shell: bashPath, args: ['-lc'] };
    return cachedShellConfig;
  }

  if (isExecutable(envShell)) {
    cachedShellConfig = { shell: envShell, args: ['-lc'] };
    return cachedShellConfig;
  }

  cachedShellConfig = { shell: 'sh', args: ['-c'] };
  return cachedShellConfig;
}

export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        detached: true,
      });
    } catch {
      // ignore
    }
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
}

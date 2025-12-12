import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AtomicWriteOptions {
  encoding?: BufferEncoding;
  mode?: number;
  tmpDir?: string;
}

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

export const writeFileAtomic = async (
  targetPath: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {}
) => {
  const dir = path.dirname(targetPath);
  await ensureDir(dir);
  const tempPath = path.join(dir, `.mu-tmp-${path.basename(targetPath)}-${randomUUID()}`);
  let committed = false;

  try {
    if (typeof data === 'string') {
      await fs.writeFile(tempPath, data, {
        encoding: options.encoding ?? 'utf8',
        mode: options.mode,
      });
    } else {
      await fs.writeFile(tempPath, data, { mode: options.mode });
    }

    if (process.platform === 'win32') {
      await fs.rm(targetPath, { force: true });
    }

    await fs.rename(tempPath, targetPath);
    committed = true;
  } finally {
    if (!committed) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }
};

export const writeTempFile = async (
  baseName: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {}
): Promise<string> => {
  const tmpRoot = options.tmpDir ?? os.tmpdir();
  await ensureDir(tmpRoot);
  const tempPath = path.join(tmpRoot, `${baseName}-${Date.now()}-${randomUUID()}`);

  if (typeof data === 'string') {
    await fs.writeFile(tempPath, data, {
      encoding: options.encoding ?? 'utf8',
      mode: options.mode,
    });
  } else {
    await fs.writeFile(tempPath, data, { mode: options.mode });
  }

  return tempPath;
};

import path from 'node:path';

export const resolveWorkspacePath = (cwd: string, targetPath: string): string => {
  if (path.isAbsolute(targetPath)) {
    return path.normalize(targetPath);
  }

  return path.resolve(cwd, targetPath);
};

export const relativeToWorkspace = (cwd: string, targetPath: string): string => {
  const absolute = resolveWorkspacePath(cwd, targetPath);
  const relative = path.relative(cwd, absolute);
  return relative === '' ? '.' : relative;
};

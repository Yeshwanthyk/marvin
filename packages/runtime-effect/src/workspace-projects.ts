import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

export interface WorkspaceProjectRootConfig {
  path: string;
  depth: number;
}

export interface WorkspaceConfig {
  projectRoots: WorkspaceProjectRootConfig[];
}

export interface WorkspaceProject {
  cwd: string;
  title: string;
  root: string;
}

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  projectRoots: [],
};

export const expandWorkspacePath = (value: string): string => {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
};

const titleForPath = (path: string): string => basename(path.replace(/\/+$/, "")) || path;

const isVisibleDirectory = (path: string): boolean => {
  try {
    const name = basename(path);
    return !name.startsWith(".") && statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const walkProjectRoot = (
  root: string,
  depth: number,
  projects: Map<string, WorkspaceProject>,
  current: string = root,
  currentDepth = 0,
): void => {
  if (currentDepth > 0 && isVisibleDirectory(current)) {
    projects.set(current, {
      cwd: current,
      title: titleForPath(current),
      root,
    });
  }
  if (currentDepth >= depth) return;
  if (!existsSync(current) || !isVisibleDirectory(current)) return;

  const children = readdirSync(current)
    .map((entry) => resolve(current, entry))
    .filter(isVisibleDirectory)
    .sort((a, b) => titleForPath(a).localeCompare(titleForPath(b)));
  for (const child of children) {
    walkProjectRoot(root, depth, projects, child, currentDepth + 1);
  }
};

export const discoverWorkspaceProjects = (roots: WorkspaceProjectRootConfig[]): WorkspaceProject[] => {
  const projects = new Map<string, WorkspaceProject>();
  for (const entry of roots) {
    const root = expandWorkspacePath(entry.path);
    const depth = Math.max(0, Math.min(4, Math.floor(entry.depth)));
    if (depth === 0 && isVisibleDirectory(root)) {
      projects.set(root, { cwd: root, title: titleForPath(root), root: dirname(root) });
      continue;
    }
    walkProjectRoot(root, depth, projects);
  }
  return [...projects.values()].sort((a, b) => a.title.localeCompare(b.title) || a.cwd.localeCompare(b.cwd));
};

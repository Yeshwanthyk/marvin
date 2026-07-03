import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type CockpitAgent = "claude" | "codex" | "pi";
export type CockpitInstallAction = "install" | "uninstall" | "status";
export type CockpitInstallStatus = "installed" | "outdated" | "not-installed";

export interface CockpitInstallerPaths {
  readonly claudeSettingsPath: string;
  readonly codexHooksPath: string;
  readonly piExtensionPath: string;
  readonly hookBinaryPath: string;
}

export interface CockpitInstallerResult {
  readonly agent: CockpitAgent;
  readonly status: CockpitInstallStatus;
  readonly changed: boolean;
  readonly path: string;
  readonly message?: string;
}

export interface CockpitInstallOptions {
  readonly paths?: Partial<CockpitInstallerPaths>;
  readonly agents?: readonly CockpitAgent[];
  readonly hookBinarySource?: string;
}

const MARKER = "# marvin-cockpit-hook";

const DEFAULT_AGENTS: readonly CockpitAgent[] = ["claude", "codex", "pi"];

export const defaultCockpitInstallerPaths = (): CockpitInstallerPaths => ({
  claudeSettingsPath: join(homedir(), ".claude", "settings.json"),
  codexHooksPath: join(homedir(), ".codex", "hooks.json"),
  piExtensionPath: join(homedir(), ".pi", "agent", "extensions", "marvin-cockpit", "index.ts"),
  hookBinaryPath: join(homedir(), ".config", "marvin", "integrations", "marvin-cockpit-hook"),
});

const resolvePaths = (options?: CockpitInstallOptions): CockpitInstallerPaths => ({
  ...defaultCockpitInstallerPaths(),
  ...options?.paths,
});

const resolveAgents = (options?: CockpitInstallOptions): readonly CockpitAgent[] =>
  options?.agents && options.agents.length > 0 ? options.agents : DEFAULT_AGENTS;

const shellQuote = (value: string): string =>
  /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;

const command = (paths: CockpitInstallerPaths, cli: CockpitAgent, kind: string, reason?: string): string =>
  [
    shellQuote(paths.hookBinaryPath),
    "--cli",
    cli,
    "--kind",
    kind,
    ...(reason ? ["--reason", shellQuote(reason)] : []),
    MARKER,
  ].join(" ");

const atomicWrite = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
};

const readJson = async (path: string): Promise<unknown> => {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

interface HookCommand {
  readonly type: "command";
  readonly command: string;
}

interface HookGroup {
  readonly matcher?: string;
  readonly hooks: HookCommand[];
}

interface FileSnapshot {
  readonly path: string;
  readonly content?: string;
}

const hookGroup = (cmd: string, matcher = ""): HookGroup => ({
  ...(matcher ? { matcher } : {}),
  hooks: [{ type: "command", command: cmd }],
});

const isHookCommand = (value: unknown): value is HookCommand =>
  isRecord(value) && value.type === "command" && typeof value.command === "string";

const isHookGroup = (value: unknown): value is HookGroup =>
  isRecord(value) && Array.isArray(value.hooks);

const stripMarkedHookGroups = (value: unknown): HookGroup[] => {
  if (!Array.isArray(value)) return [];
  const groups: HookGroup[] = [];
  for (const group of value) {
    if (!isHookGroup(group)) continue;
    const hooks = group.hooks.filter((hook): hook is HookCommand => isHookCommand(hook) && !hook.command.includes(MARKER));
    if (hooks.length > 0) groups.push({ ...(typeof group.matcher === "string" ? { matcher: group.matcher } : {}), hooks });
  }
  return groups;
};

const hasMarkedCommand = (value: unknown): boolean => {
  if (typeof value === "string") return value.includes(MARKER);
  if (Array.isArray(value)) return value.some(hasMarkedCommand);
  if (!isRecord(value)) return false;
  return Object.values(value).some(hasMarkedCommand);
};

const commandSet = (value: unknown): Set<string> => {
  const commands = new Set<string>();
  const visit = (entry: unknown) => {
    if (isHookCommand(entry)) {
      commands.add(entry.command);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (isRecord(entry)) {
      for (const item of Object.values(entry)) visit(item);
    }
  };
  visit(value);
  return commands;
};

const canonicalClaudeHooks = (paths: CockpitInstallerPaths): Record<string, HookGroup[]> => ({
  SessionStart: [hookGroup(command(paths, "claude", "session_started"))],
  UserPromptSubmit: [hookGroup(command(paths, "claude", "busy"))],
  PreToolUse: [hookGroup(command(paths, "claude", "needs_input"), "AskUserQuestion|ExitPlanMode")],
  PermissionRequest: [hookGroup(command(paths, "claude", "needs_input", "permission"))],
  Notification: [hookGroup(command(paths, "claude", "needs_input", "notification"))],
  Stop: [hookGroup(command(paths, "claude", "turn_completed"))],
  SessionEnd: [hookGroup(command(paths, "claude", "session_ended"))],
});

const canonicalCodexHooks = (paths: CockpitInstallerPaths): Record<string, HookGroup[]> => ({
  SessionStart: [hookGroup(command(paths, "codex", "session_started"))],
  UserPromptSubmit: [hookGroup(command(paths, "codex", "busy"))],
  PermissionRequest: [hookGroup(command(paths, "codex", "needs_input", "permission"))],
  Stop: [hookGroup(command(paths, "codex", "turn_completed"))],
});

const mergeCanonicalHooks = (raw: unknown, canonical: Record<string, HookGroup[]>): Record<string, unknown> => {
  const root = isRecord(raw) ? { ...raw } : {};
  const existingHooks = isRecord(root.hooks) ? root.hooks : {};
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(existingHooks)) {
    hooks[event] = stripMarkedHookGroups(groups);
  }
  for (const [event, groups] of Object.entries(canonical)) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  return { ...root, hooks };
};

const removeMarkedHooks = (raw: unknown): Record<string, unknown> => {
  const root = isRecord(raw) ? { ...raw } : {};
  const existingHooks = isRecord(root.hooks) ? root.hooks : {};
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(existingHooks)) {
    const stripped = stripMarkedHookGroups(groups);
    if (stripped.length > 0) hooks[event] = stripped;
  }
  return { ...root, hooks };
};

const statusForHooks = (raw: unknown, canonical: Record<string, HookGroup[]>): CockpitInstallStatus => {
  const commands = commandSet(raw);
  const expected = commandSet({ hooks: canonical });
  const installed = [...expected].every((cmd) => commands.has(cmd));
  if (installed) return "installed";
  return hasMarkedCommand(raw) ? "outdated" : "not-installed";
};

const writeJson = async (path: string, value: unknown): Promise<void> =>
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);

const snapshotFile = async (path: string): Promise<FileSnapshot> => {
  if (!existsSync(path)) return { path };
  return { path, content: await readFile(path, "utf8") };
};

const restoreFile = async (snapshot: FileSnapshot): Promise<void> => {
  if (snapshot.content === undefined) {
    await rm(snapshot.path, { force: true });
    return;
  }
  await atomicWrite(snapshot.path, snapshot.content);
};

const installHookBinary = async (paths: CockpitInstallerPaths, source: string | undefined): Promise<boolean> => {
  if (!source) return false;
  if (existsSync(paths.hookBinaryPath)) {
    const existing = await readFile(paths.hookBinaryPath, "utf8");
    if (!existing.includes(MARKER)) {
      throw new Error(`Refusing to overwrite unowned cockpit hook binary: ${paths.hookBinaryPath}`);
    }
  }
  await atomicWrite(paths.hookBinaryPath, source);
  await chmod(paths.hookBinaryPath, 0o755);
  return true;
};

const installJsonHooks = async (
  agent: CockpitAgent,
  path: string,
  canonical: Record<string, HookGroup[]>,
): Promise<CockpitInstallerResult> => {
  const raw = await readJson(path);
  const next = mergeCanonicalHooks(raw, canonical);
  await writeJson(path, next);
  return { agent, path, changed: JSON.stringify(next) !== JSON.stringify(raw), status: "installed" };
};

const uninstallJsonHooks = async (agent: CockpitAgent, path: string): Promise<CockpitInstallerResult> => {
  const raw = await readJson(path);
  const changed = hasMarkedCommand(raw);
  await writeJson(path, removeMarkedHooks(raw));
  return { agent, path, changed, status: "not-installed" };
};

const statusJsonHooks = async (
  agent: CockpitAgent,
  path: string,
  canonical: Record<string, HookGroup[]>,
): Promise<CockpitInstallerResult> => {
  const raw = await readJson(path);
  return { agent, path, changed: false, status: statusForHooks(raw, canonical) };
};

const piExtensionSource = (): string => `// ${MARKER}
// Marvin cockpit pi extension.
export default function marvinCockpitExtension() {
  return {
    name: "marvin-cockpit",
    version: 1,
  }
}
`;

const installPi = async (path: string): Promise<CockpitInstallerResult> => {
  if (existsSync(path)) {
    const existing = await readFile(path, "utf8");
    if (!existing.includes(MARKER)) {
      return { agent: "pi", path, changed: false, status: "not-installed", message: "refusing to overwrite unowned pi extension" };
    }
    if (existing === piExtensionSource()) {
      return { agent: "pi", path, changed: false, status: "installed" };
    }
  }
  await atomicWrite(path, piExtensionSource());
  return { agent: "pi", path, changed: true, status: "installed" };
};

const uninstallPi = async (path: string): Promise<CockpitInstallerResult> => {
  if (!existsSync(path)) return { agent: "pi", path, changed: false, status: "not-installed" };
  const existing = await readFile(path, "utf8");
  if (!existing.includes(MARKER)) {
    return { agent: "pi", path, changed: false, status: "not-installed", message: "refusing to remove unowned pi extension" };
  }
  await rm(path, { force: true });
  return { agent: "pi", path, changed: true, status: "not-installed" };
};

const statusPi = async (path: string): Promise<CockpitInstallerResult> => {
  if (!existsSync(path)) return { agent: "pi", path, changed: false, status: "not-installed" };
  const existing = await readFile(path, "utf8");
  if (!existing.includes(MARKER)) return { agent: "pi", path, changed: false, status: "not-installed" };
  return {
    agent: "pi",
    path,
    changed: false,
    status: existing === piExtensionSource() ? "installed" : "outdated",
  };
};

const runForAgent = async (
  action: CockpitInstallAction,
  agent: CockpitAgent,
  paths: CockpitInstallerPaths,
): Promise<CockpitInstallerResult> => {
  if (agent === "claude") {
    const canonical = canonicalClaudeHooks(paths);
    if (action === "install") return installJsonHooks(agent, paths.claudeSettingsPath, canonical);
    if (action === "uninstall") return uninstallJsonHooks(agent, paths.claudeSettingsPath);
    return statusJsonHooks(agent, paths.claudeSettingsPath, canonical);
  }
  if (agent === "codex") {
    const canonical = canonicalCodexHooks(paths);
    if (action === "install") return installJsonHooks(agent, paths.codexHooksPath, canonical);
    if (action === "uninstall") return uninstallJsonHooks(agent, paths.codexHooksPath);
    return statusJsonHooks(agent, paths.codexHooksPath, canonical);
  }
  if (action === "install") return installPi(paths.piExtensionPath);
  if (action === "uninstall") return uninstallPi(paths.piExtensionPath);
  return statusPi(paths.piExtensionPath);
};

const pathForAgent = (agent: CockpitAgent, paths: CockpitInstallerPaths): string => {
  if (agent === "claude") return paths.claudeSettingsPath;
  if (agent === "codex") return paths.codexHooksPath;
  return paths.piExtensionPath;
};

export const runCockpitInstallerAction = async (
  action: CockpitInstallAction,
  options: CockpitInstallOptions = {},
): Promise<CockpitInstallerResult[]> => {
  const paths = resolvePaths(options);
  const results: CockpitInstallerResult[] = [];
  const snapshots: FileSnapshot[] = [];
  if (action === "install") {
    snapshots.push(await snapshotFile(paths.hookBinaryPath));
    await installHookBinary(paths, options.hookBinarySource);
  }
  for (const agent of resolveAgents(options)) {
    if (action === "install") {
      snapshots.push(await snapshotFile(pathForAgent(agent, paths)));
    }
    const result = await runForAgent(action, agent, paths);
    results.push(result);
    if (action === "install" && result.status !== "installed") {
      for (const snapshot of snapshots.reverse()) {
        await restoreFile(snapshot);
      }
      return results;
    }
  }
  return results;
};

export const COCKPIT_HOOK_MARKER = MARKER;

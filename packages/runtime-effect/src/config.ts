import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer, Context } from "effect";
import { getModels, getProviders, type Api, type KnownProvider, type Model } from "@marvin-agents/ai";
import type { ThinkingLevel } from "@marvin-agents/agent-core";

const GLOBAL_AGENTS_PATHS = [
  () => path.join(os.homedir(), ".config", "marvin", "agents.md"),
  () => path.join(os.homedir(), ".codex", "agents.md"),
  () => path.join(os.homedir(), ".claude", "CLAUDE.md"),
];

const projectAgentsPaths = (cwd: string) => [
  () => path.join(cwd, "AGENTS.md"),
  () => path.join(cwd, "CLAUDE.md"),
];

const readFileIfExists = async (p: string): Promise<string | undefined> => {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return undefined;
  }
};

const loadFirstExisting = async (pathFns: Array<() => string>): Promise<{ path: string; content: string } | undefined> => {
  for (const pathFn of pathFns) {
    const p = pathFn();
    const content = await readFileIfExists(p);
    if (content !== undefined) {
      return { path: p, content };
    }
  }
  return undefined;
};

export interface AgentsConfig {
  global?: { path: string; content: string };
  project?: { path: string; content: string };
  combined: string;
}

export interface EditorConfig {
  command: string;
  args: string[];
}

export interface LspConfig {
  enabled: boolean;
  autoInstall: boolean;
}

export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  theme: string;
  editor?: EditorConfig;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
  lsp: LspConfig;
}

export const loadAgentsConfig = async (options?: { cwd?: string }): Promise<AgentsConfig> => {
  const cwd = options?.cwd ?? process.cwd();
  const global = await loadFirstExisting(GLOBAL_AGENTS_PATHS);
  const project = await loadFirstExisting(projectAgentsPaths(cwd));

  const parts: string[] = [];
  if (global) parts.push(global.content);
  if (project) parts.push(project.content);

  const config: AgentsConfig = {
    combined: parts.join("\n\n---\n\n"),
  };
  if (global) {
    config.global = global;
  }
  if (project) {
    config.project = project;
  }
  return config;
};

const isThinkingLevel = (value: unknown): value is ThinkingLevel =>
  value === "off" ||
  value === "minimal" ||
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh";

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

const readJsonIfExists = async (p: string): Promise<unknown | undefined> => {
  if (!(await fileExists(p))) return undefined;
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw) as unknown;
};

const resolveConfigDir = (): string => path.join(os.homedir(), ".config", "marvin");

const resolveProvider = (raw: unknown): KnownProvider | undefined => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const providers = getProviders();
  return providers.includes(raw as KnownProvider) ? (raw as KnownProvider) : undefined;
};

const resolveModel = (provider: KnownProvider, raw: unknown): Model<Api> | undefined => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const models = getModels(provider);
  return models.find((m) => m.id === raw) as Model<Api> | undefined;
};

const resolveEditorConfig = (raw: unknown): EditorConfig | undefined => {
  if (typeof raw === "string") {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    const command = parts[0] ?? "";
    if (!command) return undefined;
    return { command, args: parts.slice(1) };
  }

  if (Array.isArray(raw)) {
    const parts = raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const command = parts[0] ?? "";
    if (!command) return undefined;
    return { command, args: parts.slice(1) };
  }

  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const command = typeof obj.command === "string" ? obj.command.trim() : "";
    if (!command) return undefined;
    const args = Array.isArray(obj.args)
      ? obj.args.filter((value): value is string => typeof value === "string")
      : [];
    return { command, args };
  }

  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const readBoolean = (value: Record<string, unknown>, key: string): boolean | undefined => {
  const raw = value[key];
  return typeof raw === "boolean" ? raw : undefined;
};

const resolveLspConfig = (override: LspConfig | undefined, raw: unknown): LspConfig => {
  if (override) {
    return { enabled: override.enabled, autoInstall: override.autoInstall };
  }

  if (raw === false) {
    return { enabled: false, autoInstall: false };
  }

  if (isRecord(raw)) {
    const enabled = readBoolean(raw, "enabled");
    const autoInstall = readBoolean(raw, "autoInstall");
    return { enabled: enabled ?? true, autoInstall: autoInstall ?? true };
  }

  return { enabled: true, autoInstall: true };
};

export interface LoadConfigOptions {
  cwd?: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  systemPrompt?: string;
  lsp?: LspConfig;
}

export const loadAppConfig = async (options?: LoadConfigOptions): Promise<LoadedAppConfig> => {
  const configDir = options?.configDir ?? resolveConfigDir();
  const configPath = options?.configPath ?? path.join(configDir, "config.json");

  const rawConfig = (await readJsonIfExists(configPath)) ?? {};

  const rawObj = typeof rawConfig === "object" && rawConfig !== null ? (rawConfig as Record<string, unknown>) : {};
  const nestedConfig =
    typeof rawObj.config === "object" && rawObj.config !== null ? (rawObj.config as Record<string, unknown>) : {};

  const providerRaw =
    options?.provider ??
    (typeof nestedConfig.provider === "string" ? nestedConfig.provider : undefined) ??
    (typeof rawObj.provider === "string" ? rawObj.provider : undefined);

  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error(
      `Invalid or missing provider. Set "provider" in ${configPath} or pass --provider. Known: ${getProviders().join(", ")}`,
    );
  }

  const modelIdRaw =
    options?.model ??
    (typeof nestedConfig.model === "string" ? nestedConfig.model : undefined) ??
    (typeof rawObj.model === "string" ? rawObj.model : undefined);

  const model = resolveModel(provider, modelIdRaw);
  if (!model) {
    const available = getModels(provider)
      .slice(0, 8)
      .map((m) => m.id)
      .join(", ");
    throw new Error(
      `Invalid or missing model for provider ${provider}. Set "model" in ${configPath} or pass --model. Examples: ${available}`,
    );
  }

  const thinkingRaw = options?.thinking ?? rawObj.thinking;
  const thinking: ThinkingLevel = isThinkingLevel(thinkingRaw) ? thinkingRaw : "off";

  const themeRaw = rawObj.theme;
  const theme = typeof themeRaw === "string" && themeRaw.trim() ? themeRaw.trim() : "marvin";

  const editorRaw = typeof nestedConfig.editor !== "undefined" ? nestedConfig.editor : rawObj.editor;
  const editor = resolveEditorConfig(editorRaw) ?? { command: "nvim", args: [] };

  const agentsConfig = await loadAgentsConfig({ cwd: options?.cwd ?? process.cwd() });

  const basePrompt =
    options?.systemPrompt ??
    (typeof rawObj.systemPrompt === "string" && rawObj.systemPrompt.trim().length > 0
      ? rawObj.systemPrompt
      : "You are a helpful coding agent. Use tools (read, bash, edit, write) when needed.");

  const systemPrompt = agentsConfig.combined ? `${basePrompt}\n\n${agentsConfig.combined}` : basePrompt;

  const lsp = resolveLspConfig(options?.lsp, rawObj.lsp);

  return {
    provider,
    modelId: model.id,
    model,
    thinking,
    theme,
    editor,
    systemPrompt,
    agentsConfig,
    configDir,
    configPath,
    lsp,
  };
};

const writeConfigFile = async (p: string, value: Record<string, unknown>): Promise<void> => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(value, null, 2) + "\n", "utf8");
};

export const updateAppConfig = async (
  options: { configDir?: string; configPath?: string },
  patch: { provider?: string; model?: string; thinking?: ThinkingLevel; theme?: string; systemPrompt?: string },
): Promise<void> => {
  const configDir = options.configDir ?? resolveConfigDir();
  const configPath = options.configPath ?? path.join(configDir, "config.json");

  const existing = (await readJsonIfExists(configPath)) ?? {};
  const existingObj = typeof existing === "object" && existing !== null ? (existing as Record<string, unknown>) : {};

  const next: Record<string, unknown> = { ...existingObj };
  if (patch.provider) next.provider = patch.provider;
  if (patch.model) next.model = patch.model;
  if (patch.thinking) next.thinking = patch.thinking;
  if (patch.theme) next.theme = patch.theme;
  if (patch.systemPrompt) next.systemPrompt = patch.systemPrompt;

  await writeConfigFile(configPath, next);
};

export interface ConfigService {
  readonly config: LoadedAppConfig;
}

export const ConfigTag = Context.GenericTag<ConfigService>("runtime-effect/ConfigService");

export const ConfigLayer = (options?: LoadConfigOptions) =>
  Layer.effect(
    ConfigTag,
    Effect.tryPromise(() => loadAppConfig(options)).pipe(Effect.map((config) => ({ config }))),
  );

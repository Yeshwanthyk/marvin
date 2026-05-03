import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { Effect, Layer, Context } from "effect";
import {
  clearApiKey,
  getModels,
  getProviders,
  registerModel,
  resetModelRegistry,
  resolveProviderAlias,
  setApiKey,
  type Api,
  type KnownProvider,
  type Model,
} from "@yeshwanthyk/ai";
import type { ThinkingLevel } from "@yeshwanthyk/agent-core";

const execFileAsync = promisify(execFile);
const customApiKeyProviders = new Set<string>();

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
  extensions: string[];
  extensionsEnabled: boolean;
  editor?: EditorConfig;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
  lsp: LspConfig;
}

export interface DocumentationPaths {
  readmePath: string;
  docsPath: string;
  examplesPath: string;
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

const PI_AGENT_CONFIG_DIR = () => path.join(os.homedir(), ".pi", "agent");

const resolveProvider = (raw: unknown): KnownProvider | undefined => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const resolved = resolveProviderAlias(raw.trim());
  const providers = getProviders();
  return providers.includes(resolved as KnownProvider) ? (resolved as KnownProvider) : undefined;
};

const resolveModel = (provider: KnownProvider, raw: unknown): Model<Api> | undefined => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const models = getModels(provider);
  return models.find((m) => m.id === raw) as Model<Api> | undefined;
};

const parseModelSpec = (raw: unknown): { provider?: KnownProvider; modelId?: string } => {
  if (typeof raw !== "string") return {};
  const first = raw
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  if (!first) return {};
  const slashIndex = first.indexOf("/");
  if (slashIndex === -1) {
    return { modelId: first };
  }
	const providerId = first.slice(0, slashIndex).trim();
	const modelId = first.slice(slashIndex + 1).trim();
	const provider = getProviders().find((p) => p === resolveProviderAlias(providerId));
	const result: { provider?: KnownProvider; modelId?: string } = {};
	if (provider) result.provider = provider;
	if (modelId.length > 0) result.modelId = modelId;
	return result;
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

const SUPPORTED_CUSTOM_MODEL_APIS: Api[] = [
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "google-generative-ai",
];

const isApi = (value: unknown): value is Api =>
  typeof value === "string" && SUPPORTED_CUSTOM_MODEL_APIS.includes(value as Api);

const readString = (value: Record<string, unknown>, key: string): string | undefined => {
  const raw = value[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
};

const readNumber = (value: Record<string, unknown>, key: string): number | undefined => {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
};

const readBooleanValue = (value: Record<string, unknown>, key: string): boolean | undefined => {
  const raw = value[key];
  return typeof raw === "boolean" ? raw : undefined;
};

const readInputModes = (value: Record<string, unknown>): ("text" | "image")[] => {
  const raw = value.input;
  if (!Array.isArray(raw)) return ["text"];
  const modes = raw.filter((entry): entry is "text" | "image" => entry === "text" || entry === "image");
  return modes.length > 0 ? modes : ["text"];
};

const readCost = (value: Record<string, unknown>): Model<Api>["cost"] => {
  const raw = value.cost;
  if (!isRecord(raw)) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }
  return {
    input: readNumber(raw, "input") ?? 0,
    output: readNumber(raw, "output") ?? 0,
    cacheRead: readNumber(raw, "cacheRead") ?? 0,
    cacheWrite: readNumber(raw, "cacheWrite") ?? 0,
  };
};

const maybeReadRecord = (value: Record<string, unknown>, key: string): Record<string, unknown> | undefined => {
  const raw = value[key];
  return isRecord(raw) ? raw : undefined;
};

const readStringRecord = (value: Record<string, unknown>, key: string): Record<string, string> | undefined => {
  const raw = value[key];
  if (!isRecord(raw)) return undefined;
  const result: Record<string, string> = {};
  for (const [headerName, headerValue] of Object.entries(raw)) {
    if (typeof headerValue === "string") {
      result[headerName] = headerValue;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const resolveConfigValue = async (value: string, description: string): Promise<string> => {
  if (!value.startsWith("!")) {
    return process.env[value] || value;
  }

  const command = value.slice(1).trim();
  if (!command) {
    throw new Error(`Failed to resolve ${description}: empty shell command`);
  }

  try {
    const { stdout } = await execFileAsync(process.env.SHELL ?? "/bin/sh", ["-lc", command], {
      timeout: 10000,
      windowsHide: true,
    });
    const resolved = stdout.trim();
    if (resolved) return resolved;
  } catch {
    // Fall through to the contextual error below.
  }

  throw new Error(`Failed to resolve ${description} from shell command: ${command}`);
};

const resolveHeaders = async (
  headers: Record<string, string> | undefined,
  description: string,
): Promise<Record<string, string> | undefined> => {
  if (!headers) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    resolved[key] = await resolveConfigValue(value, `${description} header "${key}"`);
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
};

const mergeRecords = (
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
};

const buildModelWithOptionals = (
  model: Model<Api>,
  optional: {
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
  },
): Model<Api> => {
  const result: Model<Api> = { ...model };
  if (optional.headers && Object.keys(optional.headers).length > 0) {
    result.headers = optional.headers;
  }
  if (optional.compat && Object.keys(optional.compat).length > 0) {
    result.compat = optional.compat;
  }
  return result;
};

const registerCustomProviderModels = async (providerId: string, rawProvider: Record<string, unknown>): Promise<void> => {
  const apiRaw = rawProvider.api;
  if (!isApi(apiRaw)) return;

  const baseUrl = readString(rawProvider, "baseUrl");
  if (!baseUrl) return;

  const apiKey = readString(rawProvider, "apiKey");
  const resolvedApiKey = apiKey ? await resolveConfigValue(apiKey, `API key for provider "${providerId}"`) : undefined;
  if (apiKey) {
    setApiKey(providerId, resolvedApiKey ?? apiKey);
    customApiKeyProviders.add(providerId);
  }

  const providerHeaders = await resolveHeaders(readStringRecord(rawProvider, "headers"), `provider "${providerId}"`);
  const authHeader = readBooleanValue(rawProvider, "authHeader") ?? false;
  const providerHeadersWithAuth =
    authHeader && resolvedApiKey
      ? { ...(providerHeaders ?? {}), Authorization: `Bearer ${resolvedApiKey}` }
      : providerHeaders;

  const rawModels = rawProvider.models;
  if (!Array.isArray(rawModels)) return;

  for (const rawModel of rawModels) {
    if (!isRecord(rawModel)) continue;
    const id = readString(rawModel, "id");
    if (!id) continue;

    const model: Model<Api> = {
      id,
      name: readString(rawModel, "name") ?? id,
      api: isApi(rawModel.api) ? rawModel.api : apiRaw,
      provider: providerId,
      baseUrl: readString(rawModel, "baseUrl") ?? baseUrl,
      reasoning: readBooleanValue(rawModel, "reasoning") ?? false,
      input: readInputModes(rawModel),
      cost: readCost(rawModel),
      contextWindow: readNumber(rawModel, "contextWindow") ?? 128000,
      maxTokens: readNumber(rawModel, "maxTokens") ?? 8192,
    };

    const modelHeaders = await resolveHeaders(readStringRecord(rawModel, "headers"), `model "${providerId}/${id}"`);
    const headers = { ...(providerHeadersWithAuth ?? {}), ...(modelHeaders ?? {}) };
    const compat = mergeRecords(maybeReadRecord(rawProvider, "compat"), maybeReadRecord(rawModel, "compat"));
    registerModel(buildModelWithOptionals(model, {
      headers,
      ...(compat ? { compat } : {}),
    }));
  }
};

const loadCustomModelProviders = async (configDir: string): Promise<void> => {
  resetModelRegistry();
  for (const provider of customApiKeyProviders) {
    clearApiKey(provider);
  }
  customApiKeyProviders.clear();

  const candidates = [
    path.join(PI_AGENT_CONFIG_DIR(), "models.json"),
    path.join(configDir, "models.json"),
  ];

  for (const candidate of candidates) {
    const raw = await readJsonIfExists(candidate);
    if (!isRecord(raw) || !isRecord(raw.providers)) continue;
    for (const [providerId, rawProvider] of Object.entries(raw.providers)) {
      if (isRecord(rawProvider)) {
        await registerCustomProviderModels(providerId, rawProvider);
      }
    }
  }
};

export interface LoadConfigOptions {
  cwd?: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  systemPrompt?: string;
  docs?: DocumentationPaths;
  lsp?: LspConfig;
  extensions?: string[];
  noExtensions?: boolean;
}

const buildDocumentationPromptSection = (docs?: DocumentationPaths): string =>
  docs
    ? `

Marvin documentation (read only when the user asks about Marvin itself, its SDK, extensions, packages, sessions, themes, or TUI):
- Main documentation: ${docs.readmePath}
- Additional docs: ${docs.docsPath}
- Examples: ${docs.examplesPath}
- When asked to create or modify Marvin/Pi-compatible extensions, read docs/extensions.md and examples/extensions/ before implementing.
- When asked to package or install extensions, read docs/packages.md.
- Marvin intentionally supports Pi-style extension packages; prefer the Pi-compatible API documented there, including package.json pi.extensions manifests.
- Follow markdown cross-references before implementing.`
    : "";

export const loadAppConfig = async (options?: LoadConfigOptions): Promise<LoadedAppConfig> => {
  const configDir = options?.configDir ?? resolveConfigDir();
  const configPath = options?.configPath ?? path.join(configDir, "config.json");
  await loadCustomModelProviders(configDir);

  const rawConfig = (await readJsonIfExists(configPath)) ?? {};
  const rawPiSettings = (await readJsonIfExists(path.join(PI_AGENT_CONFIG_DIR(), "settings.json"))) ?? {};

  const rawObj = typeof rawConfig === "object" && rawConfig !== null ? (rawConfig as Record<string, unknown>) : {};
  const piSettings = isRecord(rawPiSettings) ? rawPiSettings : {};
  const nestedConfig =
    typeof rawObj.config === "object" && rawObj.config !== null ? (rawObj.config as Record<string, unknown>) : {};

  const explicitProviderRaw =
    options?.provider ??
    (typeof nestedConfig.provider === "string" ? nestedConfig.provider : undefined) ??
    (typeof rawObj.provider === "string" ? rawObj.provider : undefined);
  const explicitModelSpecRaw =
    options?.model ??
    (typeof nestedConfig.model === "string" ? nestedConfig.model : undefined) ??
    (typeof rawObj.model === "string" ? rawObj.model : undefined);
  const usePiDefaults = explicitProviderRaw === undefined && explicitModelSpecRaw === undefined;
  const providerRaw =
    explicitProviderRaw ??
    (usePiDefaults && typeof piSettings.defaultProvider === "string" ? piSettings.defaultProvider : undefined);

  const modelSpecRaw =
    explicitModelSpecRaw ??
    (usePiDefaults && typeof piSettings.defaultModel === "string" ? piSettings.defaultModel : undefined);
  const parsedModel = parseModelSpec(modelSpecRaw);
  const resolvedProvider = parsedModel.provider ?? resolveProvider(providerRaw);
  if (!resolvedProvider) {
    throw new Error(
      `Invalid or missing provider. Set "provider" in ${configPath} or pass --provider. Known: ${getProviders().join(", ")}`,
    );
  }

  const model = resolveModel(resolvedProvider, parsedModel.modelId);
  if (!model) {
    const available = getModels(resolvedProvider)
      .slice(0, 8)
      .map((m) => m.id)
      .join(", ");
    throw new Error(
      `Invalid or missing model for provider ${resolvedProvider}. Set "model" in ${configPath} or pass --model. Examples: ${available}`,
    );
  }

  const thinkingRaw = options?.thinking ?? rawObj.thinking ?? piSettings.defaultThinkingLevel;
  const thinking: ThinkingLevel = isThinkingLevel(thinkingRaw) ? thinkingRaw : "off";

  const themeRaw = rawObj.theme;
  const theme = typeof themeRaw === "string" && themeRaw.trim() ? themeRaw.trim() : "marvin";

  const rawExtensions = Array.isArray(rawObj.extensions)
    ? rawObj.extensions.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const extensions = [...rawExtensions, ...(options?.extensions ?? [])];
  const extensionsEnabled = options?.noExtensions === true ? false : rawObj.extensionsEnabled !== false;

  const editorRaw = typeof nestedConfig.editor !== "undefined" ? nestedConfig.editor : rawObj.editor;
  const editor = resolveEditorConfig(editorRaw) ?? { command: "nvim", args: [] };

  const agentsConfig = await loadAgentsConfig({ cwd: options?.cwd ?? process.cwd() });

  const basePrompt =
    options?.systemPrompt ??
    (typeof rawObj.systemPrompt === "string" && rawObj.systemPrompt.trim().length > 0
      ? rawObj.systemPrompt
      : "You are a helpful coding agent. Use tools (read, bash, edit, write) when needed.");

  const baseWithDocs = `${basePrompt}${buildDocumentationPromptSection(options?.docs)}`;
  const systemPrompt = agentsConfig.combined ? `${baseWithDocs}\n\n${agentsConfig.combined}` : baseWithDocs;

  const lsp = resolveLspConfig(options?.lsp, rawObj.lsp);

  return {
    provider: resolvedProvider,
    modelId: model.id,
    model,
    thinking,
    theme,
    extensions,
    extensionsEnabled,
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

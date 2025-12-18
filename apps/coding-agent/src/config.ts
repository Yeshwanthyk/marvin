import { getModels, getProviders, type Api, type KnownProvider, type Model } from '@marvin-agents/ai';
import type { ThinkingLevel } from '@marvin-agents/agent-core';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// --- AGENTS.md loading ---

const GLOBAL_AGENTS_PATHS = [
  () => path.join(os.homedir(), '.config', 'marvin', 'agents.md'),
  () => path.join(os.homedir(), '.codex', 'agents.md'),
  () => path.join(os.homedir(), '.claude', 'CLAUDE.md'),
];

const PROJECT_AGENTS_PATHS = [
  () => path.join(process.cwd(), 'AGENTS.md'),
  () => path.join(process.cwd(), 'CLAUDE.md'),
];

const readFileIfExists = async (p: string): Promise<string | undefined> => {
  try {
    return await fs.readFile(p, 'utf8');
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

export const loadAgentsConfig = async (): Promise<AgentsConfig> => {
  const global = await loadFirstExisting(GLOBAL_AGENTS_PATHS);
  const project = await loadFirstExisting(PROJECT_AGENTS_PATHS);

  const parts: string[] = [];
  if (global) parts.push(global.content);
  if (project) parts.push(project.content);

  return {
    global,
    project,
    combined: parts.join('\n\n---\n\n'),
  };
};

export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  systemPrompt: string;
  agentsConfig: AgentsConfig;
  configDir: string;
  configPath: string;
}

const isThinkingLevel = (value: unknown): value is ThinkingLevel =>
  value === 'off' ||
  value === 'minimal' ||
  value === 'low' ||
  value === 'medium' ||
  value === 'high' ||
  value === 'xhigh';

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
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw) as unknown;
};

const resolveConfigDir = (): string => path.join(os.homedir(), '.config', 'marvin');

const resolveProvider = (raw: unknown): KnownProvider | undefined => {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const providers = getProviders();
  return providers.includes(raw as KnownProvider) ? (raw as KnownProvider) : undefined;
};

const resolveModel = (provider: KnownProvider, raw: unknown): Model<Api> | undefined => {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const models = getModels(provider);
  return models.find((m) => m.id === raw) as Model<Api> | undefined;
};

export const loadAppConfig = async (options?: {
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
}): Promise<LoadedAppConfig> => {
  const configDir = options?.configDir ?? resolveConfigDir();
  const configPath = options?.configPath ?? path.join(configDir, 'config.json');

  const rawConfig = (await readJsonIfExists(configPath)) ?? {};

  const rawObj = typeof rawConfig === 'object' && rawConfig !== null ? (rawConfig as Record<string, unknown>) : {};
  const nestedConfig =
    typeof rawObj.config === 'object' && rawObj.config !== null ? (rawObj.config as Record<string, unknown>) : {};

  const providerRaw =
    options?.provider ??
    (typeof nestedConfig.provider === 'string' ? nestedConfig.provider : undefined) ??
    (typeof rawObj.provider === 'string' ? rawObj.provider : undefined) ??
    process.env.MU_PROVIDER;

  const provider = resolveProvider(providerRaw);
  if (!provider) {
    throw new Error(`Invalid or missing provider. Set MU_PROVIDER or pass --provider. Known: ${getProviders().join(', ')}`);
  }

  const modelIdRaw =
    options?.model ??
    (typeof nestedConfig.model === 'string' ? nestedConfig.model : undefined) ??
    (typeof rawObj.model === 'string' ? rawObj.model : undefined) ??
    process.env.MU_MODEL;

  const model = resolveModel(provider, modelIdRaw);
  if (!model) {
    const available = getModels(provider)
      .slice(0, 8)
      .map((m) => m.id)
      .join(', ');
    throw new Error(
      `Invalid or missing model for provider ${provider}. Set MU_MODEL or pass --model. Examples: ${available}`
    );
  }

  const thinkingRaw = options?.thinking ?? rawObj.thinking ?? process.env.MU_THINKING;
  const thinking: ThinkingLevel = isThinkingLevel(thinkingRaw) ? thinkingRaw : 'off';

  // Load AGENTS.md from global (~/.config/marvin/agents.md, ~/.codex/agents.md, ~/.claude/CLAUDE.md)
  // and project level (./AGENTS.md, ./CLAUDE.md)
  const agentsConfig = await loadAgentsConfig();

  // Build system prompt: base + agents instructions
  const basePrompt =
    typeof rawObj.systemPrompt === 'string' && rawObj.systemPrompt.trim().length > 0
      ? rawObj.systemPrompt
      : typeof process.env.MU_SYSTEM_PROMPT === 'string' && process.env.MU_SYSTEM_PROMPT.trim().length > 0
        ? process.env.MU_SYSTEM_PROMPT
        : 'You are a helpful coding agent. Use tools (read, bash, edit, write) when needed.';

  const systemPrompt = agentsConfig.combined
    ? `${basePrompt}\n\n${agentsConfig.combined}`
    : basePrompt;

  return {
    provider,
    modelId: model.id,
    model,
    thinking,
    systemPrompt,
    agentsConfig,
    configDir,
    configPath,
  };
};

const writeConfigFile = async (p: string, value: Record<string, unknown>): Promise<void> => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(value, null, 2) + '\n', 'utf8');
};

export const updateAppConfig = async (
  options: { configDir?: string; configPath?: string },
  patch: { provider?: string; model?: string; thinking?: ThinkingLevel; systemPrompt?: string }
): Promise<void> => {
  const configDir = options.configDir ?? resolveConfigDir();
  const configPath = options.configPath ?? path.join(configDir, 'config.json');

  const existing = (await readJsonIfExists(configPath)) ?? {};
  const existingObj = typeof existing === 'object' && existing !== null ? (existing as Record<string, unknown>) : {};

  const next: Record<string, unknown> = { ...existingObj };
  if (patch.provider) next.provider = patch.provider;
  if (patch.model) next.model = patch.model;
  if (patch.thinking) next.thinking = patch.thinking;
  if (patch.systemPrompt) next.systemPrompt = patch.systemPrompt;

  await writeConfigFile(configPath, next);
};

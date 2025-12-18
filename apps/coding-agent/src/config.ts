import { getModels, getProviders, type Api, type KnownProvider, type Model } from '@mariozechner/pi-ai';
import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface LoadedAppConfig {
  provider: KnownProvider;
  modelId: string;
  model: Model<Api>;
  thinking: ThinkingLevel;
  systemPrompt: string;
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

const resolveConfigDir = (): string => path.join(os.homedir(), '.config', 'mu-agent');

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

  const systemPromptRaw = rawObj.systemPrompt ?? process.env.MU_SYSTEM_PROMPT;
  const systemPrompt = typeof systemPromptRaw === 'string' && systemPromptRaw.trim().length > 0 ? systemPromptRaw :
    'You are a helpful coding agent. Use tools (read, bash, edit, write) when needed.';

  return {
    provider,
    modelId: model.id,
    model,
    thinking,
    systemPrompt,
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

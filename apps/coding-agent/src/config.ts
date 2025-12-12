import { createApiKeyManager, createEnvApiKeyStore, createMemoryApiKeyStore, type ApiKeyStore } from '@mu-agents/providers';
import type { ApiKeyManager } from '@mu-agents/providers';
import type { QueueStrategy, ThinkingLevel } from '@mu-agents/runtime';
import { Type } from '@sinclair/typebox';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AgentConfigSchema,
  StrictObject,
  validate,
  type AgentConfig,
} from '@mu-agents/types';

const QueueStrategySchema = Type.Union(
  [
    Type.Literal('append'),
    Type.Literal('interrupt'),
    Type.Literal('merge'),
    Type.Literal('latest'),
    Type.Literal('serial'),
  ],
  { $id: 'QueueStrategy' }
);

const ThinkingLevelSchema = Type.Union(
  [
    Type.Literal('off'),
    Type.Literal('low'),
    Type.Literal('medium'),
    Type.Literal('high'),
  ],
  { $id: 'ThinkingLevel' }
);

const MuAgentAppConfigSchema = StrictObject(
  {
    config: Type.Optional(AgentConfigSchema),
    provider: Type.Optional(Type.String({ minLength: 1 })),
    model: Type.Optional(Type.String({ minLength: 1 })),
    queueStrategy: Type.Optional(QueueStrategySchema),
    thinking: Type.Optional(ThinkingLevelSchema),
    apiKeys: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String())),
  },
  { $id: 'MuAgentAppConfig' }
);

export interface LoadedAppConfig {
  agentConfig: AgentConfig;
  queueStrategy: QueueStrategy;
  thinking: ThinkingLevel;
  apiKeys: ApiKeyManager;
  sourcePath?: string;
}

const isQueueStrategy = (value: unknown): value is QueueStrategy =>
  value === 'append' ||
  value === 'interrupt' ||
  value === 'merge' ||
  value === 'latest' ||
  value === 'serial';

const isThinkingLevel = (value: unknown): value is ThinkingLevel =>
  value === 'off' ||
  value === 'low' ||
  value === 'medium' ||
  value === 'high';

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

const resolveConfigDir = (): string => {
  const home = os.homedir();
  return path.join(home, '.config', 'mu-agent');
};

export const loadAppConfig = async (options?: {
  configDir?: string;
  configPath?: string;
}): Promise<LoadedAppConfig> => {
  const configDir = options?.configDir ?? resolveConfigDir();
  const configPath = options?.configPath ?? path.join(configDir, 'config.json');
  const secretsPath = path.join(configDir, 'secrets.json');

  const rawConfig = (await readJsonIfExists(configPath)) ?? {};
  const rawSecrets = (await readJsonIfExists(secretsPath)) ?? {};

  const mergedRaw =
    typeof rawConfig === 'object' && rawConfig !== null && typeof rawSecrets === 'object' && rawSecrets !== null
      ? { ...(rawConfig as Record<string, unknown>), ...(rawSecrets as Record<string, unknown>) }
      : rawConfig;

  const parsed = validate(MuAgentAppConfigSchema, mergedRaw, `Invalid config in ${configPath} / ${secretsPath}`);

  const provider = parsed.config?.provider ?? parsed.provider ?? process.env.MU_PROVIDER;
  const model = parsed.config?.model ?? parsed.model ?? process.env.MU_MODEL;

  if (!provider || !model) {
    throw new Error(
      `Missing provider/model. Set them in ${configPath} (config.provider/config.model) or via MU_PROVIDER/MU_MODEL.`
    );
  }

  const agentConfig: AgentConfig = {
    ...(parsed.config ?? { provider, model }),
    provider,
    model,
  };

  const queueStrategyRaw = parsed.queueStrategy ?? process.env.MU_QUEUE_STRATEGY;
  const queueStrategy: QueueStrategy = isQueueStrategy(queueStrategyRaw) ? queueStrategyRaw : 'serial';

  const thinkingRaw = parsed.thinking ?? process.env.MU_THINKING;
  const thinking: ThinkingLevel = isThinkingLevel(thinkingRaw) ? thinkingRaw : 'off';

  const memoryKeys = parsed.apiKeys ?? {};
  const apiKeys = createApiKeyManager({
    stores: [
      createEnvApiKeyStore({
        map: {
          anthropic: 'ANTHROPIC_API_KEY',
          openai: 'OPENAI_API_KEY',
        },
      }),
      createEnvApiKeyStore({
        map: {
          anthropic: 'ANTHROPIC_OAUTH_TOKEN',
        },
      }),
      createMemoryApiKeyStore(memoryKeys),
    ],
  });

  return {
    agentConfig,
    queueStrategy,
    thinking,
    apiKeys,
    sourcePath: await fileExists(configPath) ? configPath : undefined,
  };
};

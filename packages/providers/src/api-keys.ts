import type { ApiKeyGetter, ApiKeySetter } from './types';

export interface ApiKeyStore {
  readonly name: string;
  readonly canWrite?: boolean;
  load(provider: string): Promise<string | undefined> | string | undefined;
  save(provider: string, value?: string): Promise<void> | void;
}

export interface ApiKeyManagerOptions {
  stores?: ApiKeyStore[];
  logger?: (message: string, details?: Record<string, unknown>) => void;
}

export interface ApiKeyManager {
  getApiKey: ApiKeyGetter;
  setApiKey: ApiKeySetter;
}

export const createMemoryApiKeyStore = (initial?: Record<string, string>): ApiKeyStore => {
  const cache = new Map(Object.entries(initial ?? {}));
  return {
    name: 'memory',
    canWrite: true,
    load: (provider) => cache.get(provider),
    save: (provider, value) => {
      if (!value) {
        cache.delete(provider);
        return;
      }
      cache.set(provider, value);
    },
  };
};

export const createEnvApiKeyStore = (options?: { prefix?: string; map?: Record<string, string> }): ApiKeyStore => {
  const prefix = options?.prefix ?? 'MU_PROVIDER_';
  const mapping = options?.map ?? {};
  const env = typeof process !== 'undefined' ? process.env : {};
  const resolveKey = (provider: string) => mapping[provider] ?? `${prefix}${provider.toUpperCase()}`;
  return {
    name: 'env',
    canWrite: false,
    load: (provider) => env?.[resolveKey(provider)],
    save: () => {
      throw new Error('Environment store is read-only');
    },
  };
};

export const createApiKeyManager = (options?: ApiKeyManagerOptions): ApiKeyManager => {
  const stores = options?.stores ?? [createEnvApiKeyStore(), createMemoryApiKeyStore()];
  const logger = options?.logger;
  const writableStore = stores.find((store) => store.canWrite !== false);

  if (!writableStore) {
    throw new Error('At least one writable API key store is required');
  }

  const getApiKey: ApiKeyGetter = async (provider) => {
    for (const store of stores) {
      try {
        const value = await store.load(provider);
        if (value) {
          logger?.('api-key.hit', { provider, store: store.name });
          return value;
        }
      } catch (error) {
        logger?.('api-key.error', { provider, store: store.name, error });
      }
    }
    logger?.('api-key.miss', { provider });
    return undefined;
  };

  const setApiKey: ApiKeySetter = async (provider, value) => {
    await writableStore.save(provider, value);
    logger?.('api-key.write', { provider, store: writableStore.name, cleared: !value });
  };

  return { getApiKey, setApiKey };
};

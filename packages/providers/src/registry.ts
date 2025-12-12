import type { AgentConfig } from '@mu-agents/types';
import type {
  ApiKeyGetter,
  ApiKeySetter,
  FetchLike,
  ProviderAdapter,
  ProviderFactory,
  ProviderFactoryContext,
  ProviderLogger,
} from './types';

export interface ProviderRegistryOptions {
  fetchImplementation?: FetchLike;
  getApiKey?: ApiKeyGetter;
  setApiKey?: ApiKeySetter;
  logger?: ProviderLogger;
  providers?: ProviderFactory[];
}

interface RegisteredProvider {
  factory: ProviderFactory;
  adapter?: ProviderAdapter;
}

export class ProviderRegistry {
  private readonly context: ProviderFactoryContext;
  private readonly providers: RegisteredProvider[] = [];

  constructor(options?: ProviderRegistryOptions) {
    this.context = {
      fetchImplementation: options?.fetchImplementation ?? (globalThis.fetch?.bind(globalThis) ?? fetch),
      getApiKey: options?.getApiKey ?? (() => undefined),
      setApiKey: options?.setApiKey ?? (() => {
        throw new Error('setApiKey is not configured');
      }),
      logger: options?.logger,
    };

    for (const factory of options?.providers ?? []) {
      this.register(factory);
    }
  }

  register(factory: ProviderFactory): void {
    this.providers.push({ factory });
  }

  listAdapters(): ProviderAdapter[] {
    return this.providers.map((entry) => this.ensureAdapter(entry)).filter(Boolean) as ProviderAdapter[];
  }

  getAdapter(name: string): ProviderAdapter {
    const entry = this.providers.find((provider) => {
      const adapter = this.ensureAdapter(provider);
      return adapter?.name === name;
    });

    if (!entry) {
      throw new Error(`Unknown provider adapter: ${name}`);
    }

    return this.ensureAdapter(entry)!;
  }

  resolve(config: AgentConfig): ProviderAdapter {
    const adapter = this.listAdapters().find((candidate) => candidate.name === config.provider);
    if (adapter) {
      return adapter;
    }

    const fallback = this.listAdapters().find((candidate) => candidate.supportsModel(config.model));
    if (!fallback) {
      throw new Error(`No provider registered for provider=${config.provider}, model=${config.model}`);
    }

    return fallback;
  }

  private ensureAdapter(entry: RegisteredProvider): ProviderAdapter | undefined {
    if (!entry.adapter) {
      entry.adapter = entry.factory(this.context);
    }
    return entry.adapter;
  }
}

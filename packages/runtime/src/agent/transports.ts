import type { AgentConfig, AgentConversation, AgentProviderMetadata } from '@mu-agents/types';
import type {
  ProviderInvokeResult,
  ProviderFactory,
  ProviderRegistry,
  ProviderStream,
} from '@mu-agents/providers';
import type { AgentTransport, AgentTransportInvokeOptions } from './types';
import {
  createAnthropicAdapter,
  createOpenAIResponsesAdapter,
  createCodexOAuthAdapter,
  ProviderRegistry as DefaultRegistry,
} from '@mu-agents/providers';

export interface ProviderTransportOptions {
  registry?: ProviderRegistry;
  providers?: ProviderFactory[];
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  setApiKey?: (provider: string, value?: string) => Promise<void> | void;
  logger?: (message: string, details?: Record<string, unknown>) => void;
  fetchImplementation?: typeof fetch;
}

export class ProviderTransport implements AgentTransport {
  private readonly registry: ProviderRegistry;

  constructor(options: ProviderTransportOptions = {}) {
    this.registry =
      options.registry ??
      new DefaultRegistry({
        fetchImplementation: options.fetchImplementation ?? (globalThis.fetch?.bind(globalThis) ?? fetch),
        getApiKey: options.getApiKey,
        setApiKey: options.setApiKey,
        logger: options.logger,
        providers:
          options.providers ??
          [createOpenAIResponsesAdapter, createAnthropicAdapter, createCodexOAuthAdapter()],
      });
  }

  invoke(
    config: AgentConfig,
    conversation: AgentConversation,
    options?: AgentTransportInvokeOptions
  ): Promise<ProviderInvokeResult> {
    const adapter = this.registry.resolve(config);
    return adapter.invoke({
      config,
      conversation,
      signal: options?.signal,
      stream: options?.stream as ProviderStream | undefined,
      metadata: options?.metadata as AgentProviderMetadata | undefined,
    });
  }
}

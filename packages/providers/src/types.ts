import type {
  AgentConfig,
  AgentConversation,
  AgentProviderMetadata,
  AgentProviderResponse,
} from '@mu-agents/types';
import type { ProviderStream } from './stream';

export type FetchLike = typeof fetch;

export type ProviderLogger = (message: string, details?: Record<string, unknown>) => void;

export interface ProviderInvokePayload {
  config: AgentConfig;
  conversation: AgentConversation;
  signal?: AbortSignal;
  stream?: ProviderStream;
  metadata?: AgentProviderMetadata;
}

export interface ProviderInvokeResult {
  response: AgentProviderResponse;
  stream: ProviderStream;
}

export interface ProviderAdapter {
  readonly name: string;
  supportsModel(model: string): boolean;
  invoke(payload: ProviderInvokePayload): Promise<ProviderInvokeResult>;
}

export type ApiKeyGetter = (provider: string) => Promise<string | undefined> | string | undefined;
export type ApiKeySetter = (provider: string, value?: string) => Promise<void> | void;

export interface ProviderFactoryContext {
  fetchImplementation: FetchLike;
  getApiKey: ApiKeyGetter;
  setApiKey: ApiKeySetter;
  logger?: ProviderLogger;
}

export type ProviderFactory = (context: ProviderFactoryContext) => ProviderAdapter;

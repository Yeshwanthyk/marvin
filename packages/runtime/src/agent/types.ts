import type {
  AgentConfig,
  AgentConversation,
  AgentMessage,
  AgentProviderMetadata,
  AgentProviderResponse,
  AgentToolResult,
} from '@mu-agents/types';
import type { ProviderStreamEvent, ProviderInvokeResult, ProviderStream } from '@mu-agents/providers';
import type { ToolRegistry } from '@mu-agents/tools';

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export type QueueStrategy = 'append' | 'interrupt' | 'merge' | 'latest' | 'serial';

export type AgentState = 'idle' | 'running' | 'stopping' | 'error' | 'closed';

export type AttachmentKind = 'file' | 'image' | 'json' | 'text';

export interface AgentAttachment {
  id: string;
  kind: AttachmentKind;
  name?: string;
  mimeType?: string;
  data: Uint8Array | string | unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentQueueItem {
  message: AgentMessage;
  attachments?: AgentAttachment[];
}

export interface AgentTransportInvokeOptions {
  signal?: AbortSignal;
  stream?: ProviderStream;
  metadata?: AgentProviderMetadata;
}

export interface AgentTransport {
  invoke(
    config: AgentConfig,
    conversation: AgentConversation,
    options?: AgentTransportInvokeOptions
  ): Promise<ProviderInvokeResult>;
}

export type AgentEvent =
  | { type: 'state'; state: AgentState }
  | { type: 'message'; message: AgentMessage }
  | { type: 'provider'; event: ProviderStreamEvent }
  | { type: 'loop-start' }
  | { type: 'loop-stop'; reason?: string }
  | { type: 'turn-start'; conversation: AgentConversation }
  | { type: 'turn-end'; response?: AgentProviderResponse }
  | { type: 'tool-result'; result: AgentToolResult }
  | { type: 'error'; error: Error };

export interface AgentOptions {
  id?: string;
  config: AgentConfig;
  transport: AgentTransport;
  tools?: ToolRegistry;
  thinking?: ThinkingLevel;
  queueStrategy?: QueueStrategy;
  maxToolRounds?: number;
  initialConversation?: AgentConversation;
}

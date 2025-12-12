import type {
  AgentProviderMetadata,
  AgentProviderResponse,
  AgentUsage,
} from '@mu-agents/types';
import type { ProviderLogger } from './types';

export type ProviderStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'text-complete'; text: string }
  | { type: 'tool-call-delta'; toolName?: string; callId?: string; argumentsText?: string }
  | { type: 'tool-result'; toolName?: string; callId?: string; result: unknown }
  | { type: 'metadata'; metadata: Partial<AgentProviderMetadata> }
  | { type: 'usage'; usage: AgentUsage }
  | { type: 'response'; response: AgentProviderResponse }
  | { type: 'warning'; warning: string }
  | { type: 'raw'; event: string; data: unknown }
  | { type: 'error'; error: Error };

export type StreamSubscriber = (event: ProviderStreamEvent) => void | Promise<void>;

export interface ProviderStreamOptions {
  id?: string;
  logger?: ProviderLogger;
  replayEvents?: boolean;
  historyLimit?: number;
}

const DEFAULT_HISTORY_LIMIT = 2048;

export class ProviderStream implements AsyncIterable<ProviderStreamEvent> {
  private readonly options: ProviderStreamOptions;
  private readonly historyLimit: number;
  private readonly listeners = new Set<StreamSubscriber>();
  private readonly completion: Promise<void>;
  private resolveCompletion?: () => void;
  private closed = false;
  private readonly iteratorQueues = new Map<symbol, ProviderStreamEvent[]>();
  private readonly iteratorResolvers = new Map<symbol, (result: IteratorResult<ProviderStreamEvent>) => void>();
  private readonly history: ProviderStreamEvent[] = [];
  private finalResponse?: AgentProviderResponse;
  private readonly aggregatedText: string[] = [];

  constructor(options?: ProviderStreamOptions) {
    this.options = {
      replayEvents: true,
      historyLimit: DEFAULT_HISTORY_LIMIT,
      ...options,
    };
    this.historyLimit = this.options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.completion = new Promise<void>((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  emit(event: ProviderStreamEvent): void {
    if (this.closed) {
      return;
    }

    this.logDebug('stream.event', event);

    if (event.type === 'text-delta') {
      this.aggregatedText.push(event.text);
    } else if (event.type === 'text-complete') {
      this.aggregatedText.length = 0;
      this.aggregatedText.push(event.text);
    } else if (event.type === 'response') {
      this.finalResponse = event.response;
    }

    if (this.options.replayEvents) {
      this.history.push(event);
      if (this.history.length > this.historyLimit) {
        this.history.splice(0, this.history.length - this.historyLimit);
      }
    }

    for (const listener of this.listeners) {
      void listener(event);
    }

    for (const [iteratorId, queue] of this.iteratorQueues.entries()) {
      const resolver = this.iteratorResolvers.get(iteratorId);
      if (resolver) {
        this.iteratorResolvers.delete(iteratorId);
        resolver({ value: event, done: false });
      } else {
        queue.push(event);
      }
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const resolver of this.iteratorResolvers.values()) {
      resolver({ value: undefined, done: true });
    }
    this.iteratorResolvers.clear();
    this.iteratorQueues.clear();
    this.resolveCompletion?.();
  }

  error(error: Error): void {
    this.emit({ type: 'error', error });
    this.close();
  }

  subscribe(listener: StreamSubscriber, options?: { replay?: boolean }): () => void {
    if (options?.replay !== false && this.options.replayEvents) {
      for (const event of this.history) {
        void listener(event);
      }
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getAggregatedText(): string {
    return this.aggregatedText.join('');
  }

  getResponse(): AgentProviderResponse | undefined {
    return this.finalResponse;
  }

  async finished(): Promise<void> {
    await this.completion;
  }

  [Symbol.asyncIterator](): AsyncIterator<ProviderStreamEvent> {
    return this.values()[Symbol.asyncIterator]();
  }

  values(): AsyncIterable<ProviderStreamEvent> {
    const stream = this;
    return {
      [Symbol.asyncIterator]() {
        const iteratorId = Symbol('provider-stream');
        stream.iteratorQueues.set(iteratorId, stream.options.replayEvents ? [...stream.history] : []);
        return {
          next(): Promise<IteratorResult<ProviderStreamEvent>> {
            if (stream.closed && stream.iteratorQueues.get(iteratorId)?.length === 0) {
              stream.iteratorQueues.delete(iteratorId);
              return Promise.resolve({ value: undefined, done: true });
            }

            const queue = stream.iteratorQueues.get(iteratorId);
            if (!queue) {
              return Promise.resolve({ value: undefined, done: true });
            }

            if (queue.length > 0) {
              const event = queue.shift()!;
              return Promise.resolve({ value: event, done: false });
            }

            return new Promise<IteratorResult<ProviderStreamEvent>>((resolve) => {
              stream.iteratorResolvers.set(iteratorId, resolve);
            });
          },
          return(): Promise<IteratorResult<ProviderStreamEvent>> {
            stream.iteratorQueues.delete(iteratorId);
            const resolver = stream.iteratorResolvers.get(iteratorId);
            if (resolver) {
              stream.iteratorResolvers.delete(iteratorId);
              resolver({ value: undefined, done: true });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }

  private logDebug(message: string, details?: Record<string, unknown>): void {
    this.options.logger?.(message, {
      streamId: this.options.id,
      ...details,
    });
  }
}

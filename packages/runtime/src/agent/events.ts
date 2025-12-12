import type { AgentEvent } from './types';

export type AgentEventSubscriber = (event: AgentEvent) => void | Promise<void>;

export interface AgentEventStreamOptions {
  id?: string;
  replayEvents?: boolean;
  historyLimit?: number;
}

const DEFAULT_HISTORY_LIMIT = 2048;

export class AgentEventStream implements AsyncIterable<AgentEvent> {
  private readonly options: Required<Pick<AgentEventStreamOptions, 'replayEvents' | 'historyLimit'>> &
    Omit<AgentEventStreamOptions, 'replayEvents' | 'historyLimit'>;
  private readonly history: AgentEvent[] = [];
  private readonly listeners = new Set<AgentEventSubscriber>();
  private closed = false;
  private readonly completion: Promise<void>;
  private resolveCompletion?: () => void;
  private readonly iteratorQueues = new Map<symbol, AgentEvent[]>();
  private readonly iteratorResolvers = new Map<symbol, (result: IteratorResult<AgentEvent>) => void>();

  constructor(options?: AgentEventStreamOptions) {
    this.options = {
      replayEvents: true,
      historyLimit: DEFAULT_HISTORY_LIMIT,
      ...options,
    };
    this.completion = new Promise<void>((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  emit(event: AgentEvent): void {
    if (this.closed) return;
    if (this.options.replayEvents) {
      this.history.push(event);
      if (this.history.length > this.options.historyLimit) {
        this.history.splice(0, this.history.length - this.options.historyLimit);
      }
    }
    for (const listener of this.listeners) void listener(event);
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
    if (this.closed) return;
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

  subscribe(listener: AgentEventSubscriber, options?: { replay?: boolean }): () => void {
    if (options?.replay !== false && this.options.replayEvents) {
      for (const event of this.history) void listener(event);
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async finished(): Promise<void> {
    await this.completion;
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this.values()[Symbol.asyncIterator]();
  }

  values(): AsyncIterable<AgentEvent> {
    const stream = this;
    return {
      [Symbol.asyncIterator]() {
        const iteratorId = Symbol('agent-event-stream');
        stream.iteratorQueues.set(iteratorId, stream.options.replayEvents ? [...stream.history] : []);
        return {
          next(): Promise<IteratorResult<AgentEvent>> {
            if (stream.closed && stream.iteratorQueues.get(iteratorId)?.length === 0) {
              stream.iteratorQueues.delete(iteratorId);
              return Promise.resolve({ value: undefined, done: true });
            }
            const queue = stream.iteratorQueues.get(iteratorId);
            if (!queue) return Promise.resolve({ value: undefined, done: true });
            if (queue.length > 0) {
              const event = queue.shift()!;
              return Promise.resolve({ value: event, done: false });
            }
            return new Promise<IteratorResult<AgentEvent>>((resolve) => {
              stream.iteratorResolvers.set(iteratorId, resolve);
            });
          },
          return(): Promise<IteratorResult<AgentEvent>> {
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
}


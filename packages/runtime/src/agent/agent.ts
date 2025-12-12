import type {
  AgentConversation,
  AgentMessage,
  AgentUserMessage,
  AgentAssistantMessage,
  AgentToolMessage,
  AgentToolResult,
} from '@mu-agents/types';
import type { ProviderStreamEvent } from '@mu-agents/providers';
import type { ToolRegistry } from '@mu-agents/tools';
import { AgentEventStream } from './events';
import type {
  AgentAttachment,
  AgentOptions,
  AgentQueueItem,
  AgentState,
  ThinkingLevel,
} from './types';

const createUserMessage = (text: string, attachments?: AgentAttachment[]): AgentUserMessage => {
  const content: AgentUserMessage['content'] = [{ type: 'text', text }];
  if (attachments?.length) {
    content.push({
      type: 'json',
      value: {
        attachments: attachments.map(({ id, kind, name, mimeType, metadata }) => ({
          id,
          kind,
          name,
          mimeType,
          metadata,
        })),
      },
    });
  }
  return {
    role: 'user',
    content,
  };
};

const createAssistantMessage = (text: string | undefined): AgentAssistantMessage => ({
  role: 'assistant',
  content: text ? [{ type: 'text', text }] : [{ type: 'text', text: '' }],
});

const createToolMessage = (result: AgentToolResult): AgentToolMessage => ({
  role: 'tool',
  toolName: result.invocation.name,
  callId: result.invocation.id,
  content: [
    {
      type: 'tool-result',
      toolName: result.invocation.name,
      callId: result.invocation.id,
      result: result.output,
    },
  ],
});

export class Agent {
  readonly id: string;
  readonly events: AgentEventStream;
  private readonly tools?: ToolRegistry;
  private readonly maxToolRounds: number;
  private config: AgentOptions['config'];
  private thinking: ThinkingLevel;
  private readonly queueStrategy: AgentOptions['queueStrategy'];
  private readonly transport: AgentOptions['transport'];

  private conversation: AgentConversation;
  private queue: AgentQueueItem[] = [];
  private state: AgentState = 'idle';
  private abortController?: AbortController;

  constructor(options: AgentOptions) {
    this.id = options.id ?? `agent-${Math.random().toString(36).slice(2)}`;
    this.events = new AgentEventStream({ id: this.id });
    this.config = options.config;
    this.transport = options.transport;
    this.tools = options.tools;
    this.thinking = options.thinking ?? 'off';
    this.queueStrategy = options.queueStrategy ?? 'append';
    this.maxToolRounds = options.maxToolRounds ?? 5;
    this.conversation = options.initialConversation ? [...options.initialConversation] : [];
  }

  getState(): AgentState {
    return this.state;
  }

  getConversation(): AgentConversation {
    return [...this.conversation];
  }

  setThinking(level: ThinkingLevel): void {
    this.thinking = level;
  }

  updateConfig(config: AgentOptions['config']): void {
    this.config = config;
  }

  enqueueUserText(text: string, attachments?: AgentAttachment[]): AgentUserMessage {
    const message = createUserMessage(text, attachments);
    this.enqueue({ message, attachments });
    return message;
  }

  enqueueMessage(message: AgentMessage, attachments?: AgentAttachment[]): void {
    this.enqueue({ message, attachments });
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  stop(reason = 'stopped'): void {
    if (this.state === 'running') {
      this.state = 'stopping';
      this.events.emit({ type: 'state', state: this.state });
      this.abortController?.abort(reason);
    }
  }

  close(): void {
    this.stop('closed');
    this.state = 'closed';
    this.events.emit({ type: 'state', state: this.state });
    this.events.close();
  }

  async runNextTurn(): Promise<boolean> {
    if (this.state === 'closed') return false;
    if (this.state === 'running') return false;
    const item = this.queue.shift();
    if (!item) return false;

    this.conversation.push(item.message);
    this.events.emit({ type: 'message', message: item.message });

    this.state = 'running';
    this.events.emit({ type: 'state', state: this.state });
    this.abortController = new AbortController();

    try {
      this.events.emit({ type: 'turn-start', conversation: this.getConversation() });
      await this.runProviderRounds();
      this.state = 'idle';
      this.events.emit({ type: 'state', state: this.state });
      this.events.emit({ type: 'turn-end' });
      return true;
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        const reason = this.abortController.signal.reason;
        const shouldStop =
          reason === 'stopped' ||
          reason === 'closed';

        if (!shouldStop) {
          this.state = 'idle';
          this.events.emit({ type: 'state', state: this.state });
          this.events.emit({ type: 'turn-end' });
          return this.queue.length > 0;
        }
        return false;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      this.state = 'error';
      this.events.emit({ type: 'state', state: this.state });
      this.events.emit({ type: 'error', error: err });
      return false;
    } finally {
      this.abortController = undefined;
    }
  }

  private enqueue(item: AgentQueueItem): void {
    switch (this.queueStrategy) {
      case 'latest': {
        this.queue = [item];
        return;
      }
      case 'interrupt': {
        this.queue = [item];
        if (this.state === 'running') {
          this.abortController?.abort('interrupted');
        }
        return;
      }
      case 'merge': {
        const last = this.queue[this.queue.length - 1];
        if (!last || !this.tryMergeQueueItems(last, item)) {
          this.queue.push(item);
        }
        return;
      }
      case 'append':
      case 'serial':
      default: {
        this.queue.push(item);
        return;
      }
    }
  }

  private tryMergeQueueItems(target: AgentQueueItem, incoming: AgentQueueItem): boolean {
    if (target.message.role !== 'user' || incoming.message.role !== 'user') return false;
    const targetText = this.getUserMessageText(target.message);
    const incomingText = this.getUserMessageText(incoming.message);
    if (targetText == null || incomingText == null) return false;

    const mergedText = [targetText, incomingText].filter(Boolean).join('\n\n');
    const mergedAttachments = [...(target.attachments ?? []), ...(incoming.attachments ?? [])];
    target.attachments = mergedAttachments.length ? mergedAttachments : undefined;
    target.message = createUserMessage(mergedText, mergedAttachments);
    return true;
  }

  private getUserMessageText(message: AgentUserMessage): string | null {
    const texts = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .filter((t) => t.trim().length > 0);
    if (!texts.length) return null;
    return texts.join('\n\n');
  }

  private async runProviderRounds(): Promise<void> {
    let rounds = 0;
    while (rounds < this.maxToolRounds) {
      rounds += 1;
      const { stream } = await this.transport.invoke(
        this.withThinkingMetadata(this.config),
        this.getConversation(),
        { signal: this.abortController?.signal }
      );

      const toolCalls = new Map<string, { toolName: string; argumentsText?: string }>();
      const unsubscribe = stream.subscribe((event: ProviderStreamEvent) => {
        this.events.emit({ type: 'provider', event });
        if (event.type === 'tool-call-delta') {
          const callId = event.callId ?? `${event.toolName ?? 'tool'}:${toolCalls.size}`;
          toolCalls.set(callId, {
            toolName: event.toolName ?? 'tool-call',
            argumentsText: event.argumentsText,
          });
        }
      });

      await stream.finished();
      unsubscribe();

      if (this.abortController?.signal.aborted) {
        const reason = this.abortController.signal.reason;
        throw new DOMException(String(reason ?? 'Aborted'), 'AbortError');
      }

      const response = stream.getResponse();
      const assistantText = stream.getAggregatedText();
      const assistantMessage = createAssistantMessage(assistantText);
      const assistantWithMeta = response
        ? ({ ...assistantMessage, metadata: { providerResponse: response } } as AgentAssistantMessage)
        : assistantMessage;
      this.conversation.push(assistantWithMeta);
      this.events.emit({ type: 'message', message: assistantWithMeta });

      if (!toolCalls.size || !this.tools) {
        this.events.emit({ type: 'turn-end', response });
        return;
      }

      const toolResults = await this.executeTools(toolCalls);
      for (const result of toolResults) {
        const toolMessage = createToolMessage(result);
        this.conversation.push(toolMessage);
        this.events.emit({ type: 'tool-result', result });
        this.events.emit({ type: 'message', message: toolMessage });
      }
    }
    throw new Error(`Exceeded max tool rounds (${this.maxToolRounds})`);
  }

  private async executeTools(
    toolCalls: Map<string, { toolName: string; argumentsText?: string }>
  ): Promise<AgentToolResult[]> {
    const results: AgentToolResult[] = [];
    for (const [callId, call] of toolCalls.entries()) {
      const invocation = {
        id: callId,
        name: call.toolName,
        arguments: {},
      };
      let args: unknown = {};
      if (call.argumentsText) {
        try {
          args = JSON.parse(call.argumentsText);
        } catch {
          args = { raw: call.argumentsText };
        }
      }
      invocation.arguments = args as Record<string, unknown>;

      try {
        const output = await this.tools!.invoke(call.toolName, invocation.arguments);
        results.push({ invocation, output });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        results.push({
          invocation,
          output: { error: err.message },
          isError: true,
          metadata: { stack: err.stack },
        });
      }
    }
    return results;
  }

  private withThinkingMetadata(config: AgentOptions['config']): AgentOptions['config'] {
    if (this.thinking === 'off') return config;
    return {
      ...config,
      metadata: {
        ...(config.metadata ?? {}),
        thinkingLevel: this.thinking,
      },
    };
  }
}

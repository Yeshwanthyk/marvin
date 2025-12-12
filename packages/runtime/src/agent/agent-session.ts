import type { AgentConfig, AgentConversation } from '@mu-agents/types';
import type { ToolRegistry } from '@mu-agents/tools';
import { Agent } from './agent';
import { AgentLoop, type AgentLoopOptions } from './agent-loop';
import { ProviderTransport, type ProviderTransportOptions } from './transports';
import type { AgentAttachment, AgentEvent, ThinkingLevel, QueueStrategy } from './types';

export interface AgentSessionOptions {
  config: AgentConfig;
  tools?: ToolRegistry;
  thinking?: ThinkingLevel;
  queueStrategy?: QueueStrategy;
  maxToolRounds?: number;
  loop?: AgentLoopOptions;
  providerTransport?: ProviderTransportOptions;
  id?: string;
  initialConversation?: AgentConversation;
}

export class AgentSession implements AsyncIterable<AgentEvent> {
  readonly agent: Agent;
  readonly loop: AgentLoop;

  constructor(options: AgentSessionOptions) {
    const transport = new ProviderTransport(options.providerTransport);
    this.agent = new Agent({
      id: options.id,
      config: options.config,
      transport,
      tools: options.tools,
      thinking: options.thinking,
      queueStrategy: options.queueStrategy,
      maxToolRounds: options.maxToolRounds,
      initialConversation: options.initialConversation,
    });
    this.loop = new AgentLoop(this.agent, options.loop);
  }

  send(text: string, attachments?: AgentAttachment[]): void {
    this.agent.enqueueUserText(text, attachments);
    void this.loop.start();
  }

  enqueueMessage(message: Parameters<Agent['enqueueMessage']>[0]): void {
    this.agent.enqueueMessage(message);
    void this.loop.start();
  }

  stop(reason?: string): void {
    this.loop.stop(reason);
  }

  close(): void {
    this.stop('closed');
    this.agent.close();
  }

  subscribe(listener: (event: AgentEvent) => void | Promise<void>, options?: { replay?: boolean }): () => void {
    return this.loop.subscribe(listener, options);
  }

  getConversation(): AgentConversation {
    return this.agent.getConversation();
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this.loop[Symbol.asyncIterator]();
  }
}

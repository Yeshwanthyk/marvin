import { AgentEventStream } from './events';
import type { AgentEvent, AgentState } from './types';
import type { Agent } from './agent';

export interface AgentLoopOptions {
  idleDelayMs?: number;
  maxTurns?: number;
}

export class AgentLoop implements AsyncIterable<AgentEvent> {
  readonly events: AgentEventStream;
  private readonly agent: Agent;
  private readonly options: AgentLoopOptions;
  private running = false;
  private stopRequested = false;
  private runPromise?: Promise<void>;

  constructor(agent: Agent, options: AgentLoopOptions = {}) {
    this.agent = agent;
    this.options = options;
    this.events = new AgentEventStream({ id: `${agent.id}:loop` });
  }

  start(): Promise<void> {
    if (this.running) return this.runPromise!;
    this.running = true;
    this.stopRequested = false;
    this.runPromise = this.run();
    return this.runPromise;
  }

  stop(reason = 'stopped'): void {
    this.stopRequested = true;
    this.agent.stop(reason);
  }

  async finished(): Promise<void> {
    await this.runPromise;
  }

  subscribe(listener: (event: AgentEvent) => void | Promise<void>, options?: { replay?: boolean }): () => void {
    return this.events.subscribe(listener, options);
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this.events.values()[Symbol.asyncIterator]();
  }

  private async run(): Promise<void> {
    this.events.emit({ type: 'loop-start' });
    const forwardUnsub = this.agent.events.subscribe((event) => this.events.emit(event));

    let turns = 0;
    try {
      while (!this.stopRequested) {
        const didRun = await this.agent.runNextTurn();
        if (!didRun) break;
        turns += 1;
        if (this.options.maxTurns && turns >= this.options.maxTurns) {
          this.stopRequested = true;
          break;
        }
        if (this.options.idleDelayMs && this.agent.hasPending()) {
          await new Promise((resolve) => setTimeout(resolve, this.options.idleDelayMs));
        }
      }
    } finally {
      forwardUnsub();
      this.events.emit({ type: 'loop-stop', reason: this.stopRequested ? 'stopRequested' : undefined });
      this.events.close();
      this.running = false;
    }
  }
}


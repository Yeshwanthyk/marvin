import { describe, it, expect } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { ToolRegistry } from '@mu-agents/tools';
import { ProviderStream } from '@mu-agents/providers';
import type { AgentTransport } from '../src/agent/types';
import { Agent } from '../src/agent/agent';
import { AgentLoop } from '../src/agent/agent-loop';

const fakeResponse = {
  metadata: { provider: 'fake', model: 'fake', mode: 'chat' as const },
};

const makeStream = (emit: (s: ProviderStream) => void) => {
  const stream = new ProviderStream({ replayEvents: true });
  emit(stream);
  stream.close();
  return stream;
};

class ScriptedTransport implements AgentTransport {
  private callIndex = 0;
  constructor(
    private readonly scripts: Array<(conversationText: string[]) => ProviderStream>
  ) {}
  async invoke(_: any, conversation: any, __?: any): Promise<any> {
    const texts = conversation
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .flatMap((m: any) => m.content)
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text);
    const stream = this.scripts[this.callIndex++]?.(texts) ?? makeStream(() => {});
    return { response: fakeResponse, stream };
  }
}

describe('AgentLoop', () => {
  it('append queue strategy processes queued messages sequentially', async () => {
    const transport = new ScriptedTransport([
      () => makeStream((s) => s.emit({ type: 'text-delta', text: 'hi' })),
      () => makeStream((s) => s.emit({ type: 'text-delta', text: 'there' })),
    ]);

    const agent = new Agent({
      config: { provider: 'fake', model: 'fake' },
      transport,
      queueStrategy: 'append',
    });
    agent.enqueueUserText('one');
    agent.enqueueUserText('two');

    const loop = new AgentLoop(agent);
    await loop.start();

    const convo = agent.getConversation();
    expect(convo.filter((m) => m.role === 'user').length).toBe(2);
    expect(convo.filter((m) => m.role === 'assistant').length).toBe(2);
    expect(
      convo.filter((m) => m.role === 'assistant')[0].content[0].text
    ).toBe('hi');
    expect(
      convo.filter((m) => m.role === 'assistant')[1].content[0].text
    ).toBe('there');
  });

  it('latest queue strategy drops earlier pending messages', async () => {
    const transport = new ScriptedTransport([
      () => makeStream((s) => s.emit({ type: 'text-delta', text: 'ok' })),
    ]);

    const agent = new Agent({
      config: { provider: 'fake', model: 'fake' },
      transport,
      queueStrategy: 'latest',
    });
    agent.enqueueUserText('first');
    agent.enqueueUserText('second');

    const loop = new AgentLoop(agent);
    await loop.start();

    const users = agent.getConversation().filter((m) => m.role === 'user');
    expect(users.length).toBe(1);
    expect(users[0].content[0].text).toBe('second');
  });

  it('interrupt queue strategy aborts the active turn and runs the latest message next', async () => {
    class AbortAwareTransport implements AgentTransport {
      private callIndex = 0;
      async invoke(_: any, __: any, options?: any): Promise<any> {
        const index = this.callIndex++;
        const stream = new ProviderStream({ replayEvents: true });

        const signal: AbortSignal | undefined = options?.signal;
        if (signal) {
          if (signal.aborted) {
            stream.close();
            return { response: fakeResponse, stream };
          }
          const onAbort = () => stream.close();
          signal.addEventListener('abort', onAbort, { once: true });
        }

        if (index === 0) {
          stream.emit({ type: 'text-delta', text: 'long' });
          return { response: fakeResponse, stream };
        }

        stream.emit({ type: 'text-delta', text: 'done' });
        stream.close();
        return { response: fakeResponse, stream };
      }
    }

    const agent = new Agent({
      config: { provider: 'fake', model: 'fake' },
      transport: new AbortAwareTransport(),
      queueStrategy: 'interrupt',
    });

    agent.enqueueUserText('first');
    const loop = new AgentLoop(agent);

    const firstTurnStarted = new Promise<void>((resolve) => {
      const unsub = loop.subscribe((e) => {
        if (e.type === 'turn-start') {
          unsub();
          resolve();
        }
      });
    });

    const runPromise = loop.start();
    await firstTurnStarted;

    agent.enqueueUserText('second');
    await runPromise;

    const convo = agent.getConversation();
    const users = convo.filter((m) => m.role === 'user');
    const assistants = convo.filter((m) => m.role === 'assistant');
    expect(users.length).toBe(2);
    expect(users[0].content[0].text).toBe('first');
    expect(users[1].content[0].text).toBe('second');
    expect(assistants.length).toBe(1);
    expect(assistants[0].content[0].text).toBe('done');
  });

  it('merge queue strategy combines queued user messages into a single turn', async () => {
    const transport = new ScriptedTransport([
      () => makeStream((s) => s.emit({ type: 'text-delta', text: 'ok' })),
    ]);

    const agent = new Agent({
      config: { provider: 'fake', model: 'fake' },
      transport,
      queueStrategy: 'merge',
    });

    agent.enqueueUserText('one');
    agent.enqueueUserText('two');
    agent.enqueueUserText('three');

    const loop = new AgentLoop(agent);
    await loop.start();

    const convo = agent.getConversation();
    const users = convo.filter((m) => m.role === 'user');
    const assistants = convo.filter((m) => m.role === 'assistant');
    expect(users.length).toBe(1);
    expect(users[0].content[0].text).toBe('one\n\ntwo\n\nthree');
    expect(assistants.length).toBe(1);
    expect(assistants[0].content[0].text).toBe('ok');
  });

  it('executes tools and performs follow-up round', async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: 'echo',
      description: 'echo tool',
      schema: Type.Object({ value: Type.String() }),
      handler: async (input) => ({ echoed: input.value }),
    });

    const transport = new ScriptedTransport([
      () =>
        makeStream((s) => {
          s.emit({
            type: 'tool-call-delta',
            toolName: 'echo',
            callId: 'c1',
            argumentsText: JSON.stringify({ value: 'x' }),
          });
        }),
      () => makeStream((s) => s.emit({ type: 'text-delta', text: 'done' })),
    ]);

    const agent = new Agent({
      config: { provider: 'fake', model: 'fake', tools: tools.listDefinitions() },
      transport,
      tools,
    });
    agent.enqueueUserText('use tool');

    const loop = new AgentLoop(agent);
    const events: string[] = [];
    loop.subscribe((e) => events.push(e.type));
    await loop.start();

    const convo = agent.getConversation();
    expect(convo.some((m) => m.role === 'tool')).toBe(true);
    const assistants = convo.filter((m) => m.role === 'assistant');
    expect(assistants[assistants.length - 1]?.content[0].text).toBe('done');
    expect(events).toContain('tool-result');
  });
});

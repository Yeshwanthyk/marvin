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
  async invoke(_: any, conversation: any): Promise<any> {
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
  it('processes queued messages serially', async () => {
    const transport = new ScriptedTransport([
      () => makeStream((s) => s.emit({ type: 'text-delta', text: 'hi' })),
      () => makeStream((s) => s.emit({ type: 'text-delta', text: 'there' })),
    ]);

    const agent = new Agent({
      config: { provider: 'fake', model: 'fake' },
      transport,
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

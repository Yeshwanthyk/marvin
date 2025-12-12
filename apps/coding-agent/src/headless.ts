import { AgentSession } from '@mu-agents/runtime';
import { createDefaultToolRegistry } from '@mu-agents/tools';
import type { AgentEvent } from '@mu-agents/runtime';
import type { AgentMessage } from '@mu-agents/types';
import { loadAppConfig } from './config';

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const getMessageText = (message: AgentMessage): string => {
  if (message.role !== 'assistant' && message.role !== 'user') return '';
  const parts = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '');
  return parts.join('');
};

export const runHeadless = async (args: {
  prompt?: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: 'off' | 'low' | 'medium' | 'high';
}) => {
  const loaded = await loadAppConfig({
    configDir: args.configDir,
    configPath: args.configPath,
    provider: args.provider,
    model: args.model,
    thinking: args.thinking,
  });
  const tools = createDefaultToolRegistry({ defaultContext: { cwd: process.cwd() } });
  const agentConfig = {
    ...loaded.agentConfig,
    tools: loaded.agentConfig.tools ?? tools.listDefinitions(),
  };

  const session = new AgentSession({
    config: agentConfig,
    tools,
    thinking: loaded.thinking,
    queueStrategy: loaded.queueStrategy,
    providerTransport: {
      getApiKey: loaded.apiKeys.getApiKey,
      setApiKey: loaded.apiKeys.setApiKey,
    },
  });

  const prompt = (args.prompt ?? (await readStdin())).trim();
  if (!prompt) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Empty prompt' }) + '\n');
    process.exitCode = 2;
    return;
  }

  let streamed = '';
  let lastUsage: unknown | undefined;
  let lastError: string | undefined;

  const unsub = session.subscribe((event: AgentEvent) => {
    if (event.type === 'provider') {
      if (event.event.type === 'text-delta') streamed += event.event.text;
      if (event.event.type === 'text-complete') streamed = event.event.text;
      if (event.event.type === 'usage') lastUsage = event.event.usage;
      if (event.event.type === 'error') lastError = event.event.error.message;
    }
    if (event.type === 'error') lastError = event.error.message;
  });

  try {
    // Set up turn-end listener BEFORE sending to avoid race
    let resolveTurnEnd: () => void;
    const turnEndPromise = new Promise<void>((resolve) => {
      resolveTurnEnd = resolve;
    });
    
    const turnUnsub = session.subscribe((event: AgentEvent) => {
      if (event.type === 'turn-end' || event.type === 'error') {
        turnUnsub();
        resolveTurnEnd();
      }
    });

    session.send(prompt);
    await turnEndPromise;

    const conversation = session.getConversation();
    const lastAssistant = [...conversation].reverse().find((m) => m.role === 'assistant');
    const assistantText = streamed || (lastAssistant ? getMessageText(lastAssistant) : '');
    process.stdout.write(
      JSON.stringify({
        ok: !lastError,
        provider: agentConfig.provider,
        model: agentConfig.model,
        prompt,
        assistant: assistantText,
        usage: lastUsage,
        error: lastError,
      }) + '\n'
    );
  } finally {
    unsub();
    session.close();
  }
};

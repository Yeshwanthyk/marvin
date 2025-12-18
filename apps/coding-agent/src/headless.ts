import { Agent, ProviderTransport } from '@marvin-agents/agent-core';
import { getApiKey, type Message, type TextContent } from '@marvin-agents/ai';
import { codingTools } from '@marvin-agents/base-tools';
import type { ThinkingLevel } from '@marvin-agents/agent-core';
import { loadAppConfig } from './config.js';

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const textFromBlocks = (blocks: Array<{ type: string }>): string => {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') parts.push((block as TextContent).text);
  }
  return parts.join('');
};

const renderMessage = (message: Message): string => {
  if (message.role === 'user') {
    if (typeof message.content === 'string') return message.content;
    return textFromBlocks(message.content);
  }

  if (message.role === 'assistant') {
    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') parts.push(block.text);
    }
    return parts.join('');
  }

  return textFromBlocks(message.content);
};

export const runHeadless = async (args: {
  prompt?: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
}) => {
  const loaded = await loadAppConfig({
    configDir: args.configDir,
    configPath: args.configPath,
    provider: args.provider,
    model: args.model,
    thinking: args.thinking,
  });

  const getApiKeyForProvider = (provider: string): string | undefined => {
    if (provider === 'anthropic') {
      return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider);
    }
    return getApiKey(provider);
  };

  const transport = new ProviderTransport({ getApiKey: getApiKeyForProvider });
  const agent = new Agent({
    transport,
    initialState: {
      systemPrompt: loaded.systemPrompt,
      model: loaded.model,
      thinkingLevel: loaded.thinking,
      tools: codingTools,
    },
  });

  const prompt = (args.prompt ?? (await readStdin())).trim();
  if (!prompt) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Empty prompt' }) + '\n');
    process.exitCode = 2;
    return;
  }

  try {
    await agent.prompt(prompt);

    const conversation = agent.state.messages.filter((m): m is Message => {
      const role = (m as { role?: unknown }).role;
      return role === 'user' || role === 'assistant' || role === 'toolResult';
    });

    const lastAssistant = [...conversation].reverse().find((m) => m.role === 'assistant');
    const assistant = lastAssistant ? renderMessage(lastAssistant) : '';

    process.stdout.write(
      JSON.stringify({
        ok: true,
        provider: loaded.provider,
        model: loaded.modelId,
        prompt,
        assistant,
      }) + '\n'
    );
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        provider: loaded.provider,
        model: loaded.modelId,
        prompt,
        assistant: '',
        error: err instanceof Error ? err.message : String(err),
      }) + '\n'
    );
    process.exitCode = 1;
  }
};

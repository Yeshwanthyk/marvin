import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens } from '@marvin-agents/agent-core';
import { getApiKey, type AgentTool, type Message, type TextContent } from '@marvin-agents/ai';
import { codingTools } from '@marvin-agents/base-tools';
import type { ThinkingLevel } from '@marvin-agents/agent-core';
import { loadAppConfig } from './config.js';
import { loadHooks, HookRunner, wrapToolsWithHooks, type HookError } from './hooks/index.js';
import { loadCustomTools, getToolNames } from './custom-tools/index.js';

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
  // Parse provider/model format if present
  let provider = args.provider;
  let model = args.model;
  if (args.model?.includes('/')) {
    const [p, m] = args.model.split('/');
    provider = p;
    model = m;
  }
  const loaded = await loadAppConfig({
    configDir: args.configDir,
    configPath: args.configPath,
    provider,
    model,
    thinking: args.thinking,
  });

  const getApiKeyForProvider = (provider: string): string | undefined => {
    if (provider === 'anthropic') {
      return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider);
    }
    return getApiKey(provider);
  };

  const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider });

  // Codex token management (defaults to ~/.config/marvin/codex-tokens.json)
  const codexTransport = new CodexTransport({
    getTokens: async () => loadTokens({ configDir: loaded.configDir }),
    setTokens: async (tokens) => saveTokens(tokens, { configDir: loaded.configDir }),
    clearTokens: async () => clearTokens({ configDir: loaded.configDir }),
  });

  const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport });

  // Load hooks from ~/.config/marvin/hooks/
  const cwd = process.cwd();
  const { hooks, errors: hookErrors } = await loadHooks(loaded.configDir);
  const hookRunner = new HookRunner(hooks, cwd, loaded.configDir);

  // Report hook load errors to stderr (non-fatal)
  for (const { path, error } of hookErrors) {
    process.stderr.write(`Hook load error: ${path}: ${error}\n`);
  }

  // Subscribe to hook runtime errors
  hookRunner.onError((err: HookError) => {
    process.stderr.write(`Hook error [${err.event}] ${err.hookPath}: ${err.error}\n`);
  });

  // Load custom tools from ~/.config/marvin/tools/
  const { tools: customTools, errors: toolErrors } = await loadCustomTools(
    loaded.configDir,
    cwd,
    getToolNames(codingTools),
  );

  // Report tool load errors to stderr (non-fatal)
  for (const { path, error } of toolErrors) {
    process.stderr.write(`Tool load error: ${path}: ${error}\n`);
  }

  // Combine built-in and custom tools, then wrap with hooks for interception
  const allTools: AgentTool<any, any>[] = [...codingTools, ...customTools.map((t) => t.tool)];
  const tools = wrapToolsWithHooks(allTools, hookRunner);

  const agent = new Agent({
    transport,
    initialState: {
      systemPrompt: loaded.systemPrompt,
      model: loaded.model,
      thinkingLevel: loaded.thinking,
      tools,
    },
  });

  // Emit app.start hook event
  await hookRunner.emit({ type: 'app.start' });

  // Headless mode: send() is a no-op (single-shot execution)
  hookRunner.setSendHandler(() => {});

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

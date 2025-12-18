import { Agent, ProviderTransport, type AgentEvent } from '@mariozechner/pi-agent-core';
import { getApiKey, getModels, getProviders, type Message, type TextContent, type ToolResultMessage } from '@mariozechner/pi-ai';
import {
  CombinedAutocompleteProvider,
  Editor,
  type EditorTheme,
  Loader,
  Markdown,
  type MarkdownTheme,
  ProcessTerminal,
  Text,
  TUI,
  type Component,
} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import { codingTools } from '@mu-agents/base-tools';
import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import { loadAppConfig, updateAppConfig } from './config.js';

const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.bold.cyan(text),
  link: (text) => chalk.blue(text),
  linkUrl: (text) => chalk.dim(text),
  code: (text) => chalk.yellow(text),
  codeBlock: (text) => chalk.green(text),
  codeBlockBorder: (text) => chalk.dim(text),
  quote: (text) => chalk.italic(text),
  quoteBorder: (text) => chalk.dim(text),
  hr: (text) => chalk.dim(text),
  listBullet: (text) => chalk.cyan(text),
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
};

const editorTheme: EditorTheme = {
  borderColor: (text) => chalk.dim(text),
  selectList: {
    selectedPrefix: (text) => chalk.blue(text),
    selectedText: (text) => chalk.bold(text),
    description: (text) => chalk.dim(text),
    scrollInfo: (text) => chalk.dim(text),
    noMatch: (text) => chalk.dim(text),
  },
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

const renderToolResult = (result: unknown): string => {
  if (!result || typeof result !== 'object') return String(result);
  const maybe = result as { content?: unknown; details?: unknown };
  const content = Array.isArray(maybe.content) ? maybe.content : [];
  const text = textFromBlocks(content as Array<{ type: string }>);
  if (maybe.details && typeof maybe.details === 'object') {
    const diff = (maybe.details as { diff?: unknown }).diff;
    if (typeof diff === 'string' && diff.trim()) {
      return `${text}\n\n---\n\n${diff}`.trim();
    }
  }
  return text;
};

class FocusProxy implements Component {
  constructor(
    private readonly editor: Editor,
    private readonly onCtrlC: () => void,
    private readonly onEscape: () => boolean,
  ) {}

  render(width: number): string[] {
    return this.editor.render(width);
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  handleInput(data: string): void {
    if (data.charCodeAt(0) === 3) {
      this.onCtrlC();
      return;
    }

    if (data === '\x1b') {
      const handled = this.onEscape();
      if (handled) return;
    }

    this.editor.handleInput?.(data);
  }
}

export const runTui = async (args?: {
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
}) => {
  const loaded = await loadAppConfig({
    configDir: args?.configDir,
    configPath: args?.configPath,
    provider: args?.provider,
    model: args?.model,
    thinking: args?.thinking,
  });

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  let currentProvider = loaded.provider;
  let currentModelId = loaded.modelId;
  let currentThinking = loaded.thinking;

  type KnownProvider = ReturnType<typeof getProviders>[number];

  const resolveProvider = (raw: string): KnownProvider | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const providers = getProviders();
    return providers.includes(trimmed as KnownProvider) ? (trimmed as KnownProvider) : undefined;
  };

  const resolveModel = (provider: KnownProvider, raw: string) => {
    const modelId = raw.trim();
    if (!modelId) return undefined;
    return getModels(provider).find((m) => m.id === modelId);
  };

  const header = new Text('');
  const updateHeader = () => {
    header.setText(
      `mu (pi-core)\n` +
        `provider=${currentProvider} model=${currentModelId} thinking=${currentThinking}\n` +
        `Commands: /clear /abort /exit /model /thinking`,
    );
  };
  updateHeader();
  tui.addChild(header);

  const editor = new Editor(editorTheme);
  const autocomplete = new CombinedAutocompleteProvider(
    [
      { name: 'clear', description: 'Clear chat + reset agent' },
      { name: 'abort', description: 'Abort in-flight request' },
      { name: 'exit', description: 'Exit' },
      {
        name: 'model',
        description: 'Set model: /model <provider> <modelId> (or /model <modelId>)',
        getArgumentCompletions: (argumentText: string) => {
          const text = argumentText.trimStart();
          const providers = getProviders();

          const providerItems = (prefix: string) =>
            providers
              .filter((p) => p.toLowerCase().startsWith(prefix.toLowerCase()))
              .map((p) => ({ value: `${p} `, label: p, description: 'provider' }));

          const spaceIdx = text.search(/\s/);
          if (!text || spaceIdx === -1) {
            const prefix = text;
            const models = getModels(currentProvider)
              .filter((m) => m.id.toLowerCase().startsWith(prefix.toLowerCase()))
              .slice(0, 50)
              .map((m) => ({ value: m.id, label: m.id, description: m.name }));

            return [...providerItems(prefix), ...models];
          }

          const providerToken = text.slice(0, spaceIdx);
          const provider = resolveProvider(providerToken);
          if (!provider) {
            return providerItems(providerToken);
          }

          const modelPrefix = text.slice(spaceIdx + 1).trimStart();
          return getModels(provider)
            .filter((m) => m.id.toLowerCase().startsWith(modelPrefix.toLowerCase()))
            .slice(0, 50)
            .map((m) => ({ value: `${provider} ${m.id}`, label: m.id, description: m.name }));
        },
      },
      {
        name: 'thinking',
        description: 'Set thinking: /thinking off|minimal|low|medium|high|xhigh',
        getArgumentCompletions: (argumentPrefix: string) => {
          const levels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
          const prefix = argumentPrefix.trim().toLowerCase();
          return levels
            .filter((level) => level.startsWith(prefix))
            .map((level) => ({ value: level, label: level }));
        },
      },
    ],
    process.cwd(),
  );
  editor.setAutocompleteProvider(autocomplete);

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

  let isResponding = false;
  let currentAssistant: Markdown | undefined;
  const toolBlocks = new Map<string, Markdown>();
  let loader: Loader | undefined;
  let lastCtrlC = 0;

  const removeLoader = () => {
    if (!loader) return;
    tui.removeChild(loader);
    loader = undefined;
  };

  const addMessage = (component: Component) => {
    // Insert before the editor (which is last child)
    const idx = Math.max(0, tui.children.length - 1);
    tui.children.splice(idx, 0, component);
  };

  const clearConversation = () => {
    // Keep header + editor
    tui.children.splice(1, tui.children.length - 2);
    currentAssistant = undefined;
    toolBlocks.clear();
    agent.reset();
    tui.requestRender();
  };

  const abort = () => {
    agent.abort();
    tui.requestRender();
  };

  const exit = () => {
    tui.stop();
    process.stdout.write('\n');
    process.exit(0);
  };

  const focusProxy = new FocusProxy(
    editor,
    () => {
      const now = Date.now();
      if (now - lastCtrlC < 750) {
        exit();
        return;
      }
      lastCtrlC = now;
      // First Ctrl+C clears editor
      editor.setText('');
      tui.requestRender();
    },
    () => {
      // Escape aborts when agent is streaming; otherwise let editor handle it.
      if (isResponding) {
        abort();
        return true;
      }
      return false;
    },
  );

  tui.addChild(focusProxy);
  tui.setFocus(focusProxy);

  agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_start') {
      if (event.message.role === 'assistant') {
        removeLoader();
        currentAssistant = new Markdown('', 1, 1, markdownTheme);
        addMessage(currentAssistant);
        tui.requestRender();
      }
    }

    if (event.type === 'message_update') {
      if (event.message.role === 'assistant' && currentAssistant) {
        const text = renderMessage(event.message as Message);
        currentAssistant.setText(text);
        removeLoader();
        tui.requestRender();
      }
    }

    if (event.type === 'message_end') {
      if (event.message.role === 'assistant' && currentAssistant) {
        currentAssistant.setText(renderMessage(event.message as Message));
        currentAssistant = undefined;
        tui.requestRender();
      }
    }

    if (event.type === 'tool_execution_start') {
      removeLoader();
      const md = new Markdown(`[tool:${event.toolName}]\n\n${JSON.stringify(event.args, null, 2)}`, 1, 1, markdownTheme);
      toolBlocks.set(event.toolCallId, md);
      addMessage(md);
      tui.requestRender();
    }

    if (event.type === 'tool_execution_update') {
      const md = toolBlocks.get(event.toolCallId);
      if (!md) return;
      const body = renderToolResult(event.partialResult);
      md.setText(`[tool:${event.toolName}]\n\n${body}`.trim());
      tui.requestRender();
    }

    if (event.type === 'tool_execution_end') {
      const md = toolBlocks.get(event.toolCallId);
      if (!md) return;
      const body = renderToolResult(event.result);
      const headerLine = event.isError ? `[tool:${event.toolName}] (error)` : `[tool:${event.toolName}]`;
      md.setText(`${headerLine}\n\n${body}`.trim());
      tui.requestRender();
    }

    if (event.type === 'turn_end') {
      // turn_end includes assistant message + toolResults; tool execution already rendered.
      if (event.message.role === 'assistant' && event.message.errorMessage) {
        removeLoader();
      }
    }

    if (event.type === 'agent_end') {
      removeLoader();
      isResponding = false;
      editor.disableSubmit = false;
      tui.requestRender();
    }
  });

  editor.onSubmit = (value: string) => {
    const line = value.trim();

    if (!line) return;

    // Slash commands
    if (line === '/exit' || line === '/quit') {
      exit();
      return;
    }

    if (line === '/clear') {
      clearConversation();
      editor.setText('');
      return;
    }

    if (line === '/abort') {
      abort();
      editor.setText('');
      return;
    }

    if (line.startsWith('/thinking')) {
      const next = line.slice('/thinking'.length).trim();
      if (next === 'off' || next === 'minimal' || next === 'low' || next === 'medium' || next === 'high' || next === 'xhigh') {
        agent.setThinkingLevel(next);
        currentThinking = next;
        updateHeader();
        void updateAppConfig({ configDir: loaded.configDir, configPath: loaded.configPath }, { thinking: next });
        editor.setText('');
        tui.requestRender();
        return;
      }
    }

    if (line.startsWith('/model')) {
      const rest = line.slice('/model'.length).trim();

      if (!rest) {
        addMessage(new Text(chalk.dim('Usage: /model <provider> <modelId> (or /model <modelId>). Tip: use Tab completion.')));
        editor.setText('');
        tui.requestRender();
        return;
      }

      if (isResponding) {
        addMessage(new Text(chalk.dim('Model cannot be changed while responding. Use /abort first.')));
        editor.setText('');
        tui.requestRender();
        return;
      }

      const parts = rest.split(/\s+/);
      if (parts.length === 1) {
        const token = parts[0] ?? '';
        const provider = resolveProvider(token);
        if (provider) {
          const examples = getModels(provider)
            .slice(0, 8)
            .map((m) => m.id)
            .join(', ');
          addMessage(new Text(chalk.dim(`Pick a model: /model ${provider} <modelId>. Examples: ${examples}`)));
          editor.setText('');
          tui.requestRender();
          return;
        }

        const model = resolveModel(currentProvider, token);
        if (!model) {
          const examples = getModels(currentProvider)
            .slice(0, 8)
            .map((m) => m.id)
            .join(', ');
          addMessage(new Text(chalk.red(`Unknown model "${token}" for provider ${currentProvider}. Examples: ${examples}`)));
          editor.setText('');
          tui.requestRender();
          return;
        }

        agent.setModel(model);
        currentModelId = model.id;
        updateHeader();
        void updateAppConfig(
          { configDir: loaded.configDir, configPath: loaded.configPath },
          { provider: currentProvider, model: model.id },
        );
        addMessage(new Text(chalk.dim(`Switched model to ${currentProvider} ${model.id}`)));
        editor.setText('');
        tui.requestRender();
        return;
      }

      const [providerRaw, ...modelParts] = parts;
      const modelId = modelParts.join(' ').trim();
      const provider = resolveProvider(providerRaw ?? '');
      if (!provider) {
        addMessage(new Text(chalk.red(`Unknown provider "${providerRaw}". Known: ${getProviders().join(', ')}`)));
        editor.setText('');
        tui.requestRender();
        return;
      }

      const model = resolveModel(provider, modelId);
      if (!model) {
        const examples = getModels(provider)
          .slice(0, 8)
          .map((m) => m.id)
          .join(', ');
        addMessage(new Text(chalk.red(`Unknown model "${modelId}" for provider ${provider}. Examples: ${examples}`)));
        editor.setText('');
        tui.requestRender();
        return;
      }

      agent.setModel(model);
      currentProvider = provider;
      currentModelId = model.id;
      updateHeader();
      void updateAppConfig({ configDir: loaded.configDir, configPath: loaded.configPath }, { provider, model: model.id });
      addMessage(new Text(chalk.dim(`Switched model to ${provider} ${model.id}`)));
      editor.setText('');
      tui.requestRender();
      return;
    }

    // Normal prompt
    if (isResponding) return;

    editor.setText('');

    addMessage(new Markdown(line, 1, 1, markdownTheme));

    loader = new Loader(tui, (s) => chalk.cyan(s), (s) => chalk.dim(s), 'Thinking...');
    addMessage(loader);

    isResponding = true;
    editor.disableSubmit = true;
    tui.requestRender();

    void agent.prompt(line).catch((err) => {
      removeLoader();
      addMessage(new Text(chalk.red(String(err instanceof Error ? err.message : err))));
      isResponding = false;
      editor.disableSubmit = false;
      tui.requestRender();
    });
  };

  tui.start();
};

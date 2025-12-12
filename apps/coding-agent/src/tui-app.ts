import { Agent, ProviderTransport, type AgentEvent } from '@mu-agents/runtime';
import type { ThinkingLevel } from '@mu-agents/runtime';
import { createDefaultToolRegistry } from '@mu-agents/tools';
import type { AgentMessage } from '@mu-agents/types';
import {
  ChatTranscript,
  type ChatTranscriptMessage,
  FooterBar,
  FooterBarModel,
  GitBranchWatcher,
  HeaderBar,
  HeaderBarModel,
  Input,
  type KeyEvent,
  KeyReader,
  ProcessTerminal,
  Tui,
  type RenderContext,
  type RenderResult,
  type Style,
  type Widget,
} from '@mu-agents/tui-lite';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadAppConfig, updateAppConfig, type LoadedAppConfig } from './config';

const getAppInfo = async (): Promise<{ name: string; version?: string }> => {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const raw = await fs.readFile(pkgUrl, 'utf8');
    const parsed = JSON.parse(raw) as { name?: string; version?: string };
    const rawName = parsed.name ?? 'mu';
    const name = rawName.includes('/') ? rawName.split('/').pop() ?? rawName : rawName;
    return { name, version: parsed.version };
  } catch {
    return { name: 'mu' };
  }
};

const listContextFiles = async (cwd: string): Promise<string[]> => {
  const dir = path.join(cwd, '.mu', 'agent');
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

const getMessageText = (message: AgentMessage): string => {
  let text = '';
  for (const block of message.content) {
    if (block.type === 'text') text += block.text;
  }
  return text;
};

const getToolText = (message: AgentMessage): string => {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'tool-result') parts.push(JSON.stringify(block.result, null, 2));
  }
  return parts.join('\n');
};

const toTranscriptMessages = (conversation: AgentMessage[]): ChatTranscriptMessage[] =>
  conversation
    .map((m): ChatTranscriptMessage | undefined => {
      if (m.role === 'user') return { role: 'user', text: getMessageText(m) };
      if (m.role === 'assistant') return { role: 'assistant', text: getMessageText(m) };
      if (m.role === 'tool') return { role: 'tool', text: getToolText(m), toolName: m.toolName };
      if (m.role === 'system') return { role: 'system', text: getMessageText(m) };
      return undefined;
    })
    .filter(Boolean) as ChatTranscriptMessage[];

type PickerId = 'model' | 'thinking';

const parseCommand = (line: string): { cmd: string; arg?: string } | undefined => {
  if (!line.startsWith('/')) return undefined;
  const trimmed = line.trim();
  const space = trimmed.indexOf(' ');
  if (space === -1) return { cmd: trimmed.slice(1) };
  return { cmd: trimmed.slice(1, space), arg: trimmed.slice(space + 1).trim() };
};

class ChatScreen implements Widget {
  private messages: ChatTranscriptMessage[] = [];
  private inFlightAssistantText = '';

  constructor(private readonly input: Input) {}

  setState(state: { messages: ChatTranscriptMessage[]; inFlightAssistantText: string }): void {
    this.messages = state.messages;
    this.inFlightAssistantText = state.inFlightAssistantText;
  }

  render(ctx: RenderContext): RenderResult {
    const chatHeight = Math.max(0, ctx.height - 1);
    const chat = new ChatTranscript({
      messages: this.messages,
      inFlightAssistantText: this.inFlightAssistantText,
    }).render({ width: ctx.width, height: chatHeight });
    const input = this.input.render({ width: ctx.width, height: 1 });
    return { lines: [...chat.lines, ...input.lines], cursor: input.cursor };
  }
}

class PickerScreen implements Widget {
  private title = '';
  private query = '';
  private items: string[] = [];
  private selected = 0;

  setState(state: { title: string; query: string; items: string[]; selected: number }): void {
    this.title = state.title;
    this.query = state.query;
    this.items = state.items;
    this.selected = state.selected;
  }

  render(ctx: RenderContext): RenderResult {
    const lines: RenderResult['lines'] = [];
    const header = `${this.title} (type to filter, esc to cancel)`;
    lines.push([{ text: header, style: { fg: 'gray', dim: true } }]);
    const queryLine = `search: ${this.query}`;
    lines.push([{ text: queryLine, style: { fg: 'gray' } }]);

    const listHeight = Math.max(0, ctx.height - 2);
    const start = Math.max(0, Math.min(this.selected - Math.floor(listHeight / 2), Math.max(0, this.items.length - listHeight)));
    const end = Math.min(this.items.length, start + listHeight);

    for (let i = start; i < end; i++) {
      const item = this.items[i]!;
      const isSelected = i === this.selected;
      const prefix = isSelected ? '→ ' : '  ';
      const style: Style = isSelected ? { fg: 'cyan', bold: true } : { fg: 'default' };
      lines.push([{ text: prefix + item, style }]);
    }

    while (lines.length < ctx.height) lines.push([]);
    return { lines };
  }
}

export const runTui = async (args?: {
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
}) => {
  const cwd = process.cwd();
  const loaded = await loadAppConfig({
    configDir: args?.configDir,
    configPath: args?.configPath,
    provider: args?.provider,
    model: args?.model,
    thinking: args?.thinking,
  });
  const appInfo = await getAppInfo();
  const contextFiles = await listContextFiles(cwd);

  const terminal = new ProcessTerminal();
  const keyReader = new KeyReader(terminal);
  const input = new Input({ prompt: '> ', placeholder: 'Type a message, /model, /thinking, /clear' });
  const chatScreen = new ChatScreen(input);
  const pickerScreen = new PickerScreen();

  const headerModel = new HeaderBarModel({
    appName: appInfo.name,
    version: appInfo.version,
    shortcuts: 'esc interrupt  ctrl+c clear',
    contextFiles: contextFiles.slice(0, 6),
  });
  const header = new HeaderBar({
    model: headerModel,
    titleStyle: { fg: 'cyan', bold: true },
    metaStyle: { fg: 'gray', dim: true },
  });

  const footerModel = new FooterBarModel({ cwd, branch: undefined, selectedModel: loaded.agentConfig.model });
  const footer = new FooterBar({ model: footerModel });

  let main: Widget = chatScreen;
  const tui = new Tui(terminal, { header, main, footer, headerHeight: 2, footerHeight: 2 });

  const tools = createDefaultToolRegistry({ defaultContext: { cwd } });
  const toolDefs = tools.listDefinitions();
  const transport = new ProviderTransport({
    getApiKey: loaded.apiKeys.getApiKey,
    setApiKey: loaded.apiKeys.setApiKey,
  });

  let agent: Agent | undefined;
  let inFlightText = '';
  let renderPending = false;
  let drainRunning = false;

  let pickerMode: PickerId | undefined;
  let pickerQuery = '';
  let pickerItems: string[] = [];
  let pickerSelected = 0;
  let lastCtrlCAt = 0;

  const requestRender = () => {
    if (renderPending) return;
    renderPending = true;
    queueMicrotask(() => {
      renderPending = false;

      if (pickerMode) {
        const title = pickerMode === 'model' ? 'Select model' : 'Select thinking';
        pickerScreen.setState({ title, query: pickerQuery, items: pickerItems, selected: pickerSelected });
        main = pickerScreen;
      } else {
        chatScreen.setState({
          messages: toTranscriptMessages(agent?.getConversation() ?? []),
          inFlightAssistantText: inFlightText,
        });
        main = chatScreen;
      }

      tui.setLayout({ header, main, footer, headerHeight: 2, footerHeight: 2 });
      tui.render();
    });
  };

  const rebuildAgent = (config: LoadedAppConfig, options?: { preserveConversation?: boolean }) => {
    inFlightText = '';
    const agentConfig = {
      ...config.agentConfig,
      tools: config.agentConfig.tools ?? toolDefs,
    };
    const initialConversation = options?.preserveConversation ? agent?.getConversation() : undefined;
    agent?.close();
    agent = new Agent({
      config: agentConfig,
      transport,
      tools,
      queueStrategy: config.queueStrategy,
      initialConversation,
    });
    agent.setThinking(config.thinking);

    agent.events.subscribe((event: AgentEvent) => {
      footerModel.ingestEvent(event);
      if (event.type === 'provider') {
        if (event.event.type === 'text-delta') {
          inFlightText += event.event.text;
        } else if (event.event.type === 'text-complete') {
          inFlightText = event.event.text;
        }
      }
      if (event.type === 'message' && event.message.role === 'assistant') {
        inFlightText = '';
      }
      requestRender();
    });
  };

  const drainQueue = async () => {
    if (!agent || drainRunning) return;
    drainRunning = true;
    const current = agent;
    try {
      while (agent === current && (await current.runNextTurn())) {
        // keep draining until idle
      }
    } finally {
      drainRunning = false;
    }
  };

  const getModelCandidates = (): string[] => {
    const current = loaded.agentConfig.model;
    const provider = loaded.agentConfig.provider;
    const base =
      provider === 'anthropic'
        ? ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-20240229']
        : provider === 'openai'
          ? ['o3-mini', 'o3', 'o1', 'gpt-4o', 'gpt-4.1', 'gpt-5']
          : ['gpt-4o', 'claude-3-5-sonnet-latest'];
    const all = Array.from(new Set([current, ...base].filter(Boolean)));
    const q = pickerQuery.trim().toLowerCase();
    return q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  };

  const openPicker = (id: PickerId) => {
    pickerMode = id;
    pickerQuery = '';
    pickerSelected = 0;
    pickerItems = id === 'model' ? getModelCandidates() : ['off', 'low', 'medium', 'high'];
    requestRender();
  };

  const closePicker = () => {
    pickerMode = undefined;
    pickerQuery = '';
    pickerItems = [];
    pickerSelected = 0;
    requestRender();
  };

  const exitApp = (branch: { stop: () => void }, keys: { stop: () => void }, app: { stop: () => void }) => {
    agent?.close();
    branch.stop();
    keys.stop();
    app.stop();
    process.stdout.write('\n');
    process.exit(0);
  };

  rebuildAgent(loaded);

  const branchWatcher = new GitBranchWatcher();
  const branch = await branchWatcher.start(cwd, (b: string | undefined) => {
    footerModel.setBranch(b);
    requestRender();
  });

  const app = tui.start();
  const keys = keyReader.start((key: KeyEvent) => {
    if (key.name === 'ctrl-c') {
      const now = Date.now();
      if (now - lastCtrlCAt < 750) {
        exitApp(branch, keys, app);
      }
      lastCtrlCAt = now;

      if (pickerMode) {
        closePicker();
        return;
      }

      rebuildAgent(loaded);
      requestRender();
      return;
    }

    if (key.name === 'escape') {
      if (pickerMode) {
        closePicker();
        return;
      }
      agent?.stop('interrupted');
      requestRender();
      return;
    }

    if (pickerMode) {
      if (key.name === 'up') {
        pickerSelected = pickerSelected <= 0 ? Math.max(0, pickerItems.length - 1) : pickerSelected - 1;
        requestRender();
        return;
      }
      if (key.name === 'down') {
        pickerSelected = pickerSelected >= pickerItems.length - 1 ? 0 : pickerSelected + 1;
        requestRender();
        return;
      }
      if (key.name === 'backspace') {
        pickerQuery = pickerQuery.slice(0, -1);
        pickerItems = pickerMode === 'model' ? getModelCandidates() : pickerItems;
        pickerSelected = Math.min(pickerSelected, Math.max(0, pickerItems.length - 1));
        requestRender();
        return;
      }
      if (key.name === 'char' && key.char) {
        pickerQuery += key.char;
        pickerItems = pickerMode === 'model' ? getModelCandidates() : pickerItems;
        pickerSelected = Math.min(pickerSelected, Math.max(0, pickerItems.length - 1));
        requestRender();
        return;
      }
      if (key.name === 'enter') {
        const selected = pickerItems[pickerSelected];
        if (!selected) {
          closePicker();
          return;
        }
        if (pickerMode === 'model') {
          loaded.agentConfig = { ...loaded.agentConfig, model: selected };
          footerModel.setSelectedModel(selected);
          void updateAppConfig({ configDir: loaded.configDir, configPath: loaded.configPath }, { model: selected });
          rebuildAgent(loaded, { preserveConversation: true });
          closePicker();
          return;
        }
        if (pickerMode === 'thinking') {
          loaded.thinking = selected as ThinkingLevel;
          void updateAppConfig({ configDir: loaded.configDir, configPath: loaded.configPath }, { thinking: loaded.thinking });
          rebuildAgent(loaded, { preserveConversation: true });
          closePicker();
          return;
        }
      }
      requestRender();
      return;
    }

    const { submitted } = input.handleKey(key);
    if (submitted === undefined) {
      requestRender();
      return;
    }

    const line = submitted.trim();
    input.setValue('');

    const cmd = parseCommand(line);
    if (cmd) {
      if (cmd.cmd === 'clear') {
        rebuildAgent(loaded);
        requestRender();
        return;
      }
      if (cmd.cmd === 'exit' || cmd.cmd === 'quit') {
        exitApp(branch, keys, app);
        return;
      }
      if (cmd.cmd === 'model') {
        const next = cmd.arg?.trim();
        if (next) {
          loaded.agentConfig = { ...loaded.agentConfig, model: next };
          footerModel.setSelectedModel(next);
          void updateAppConfig({ configDir: loaded.configDir, configPath: loaded.configPath }, { model: next });
          rebuildAgent(loaded, { preserveConversation: true });
          requestRender();
          return;
        }
        openPicker('model');
        return;
      }
      if (cmd.cmd === 'thinking') {
        const next = cmd.arg?.trim();
        if (next === 'off' || next === 'low' || next === 'medium' || next === 'high') {
          loaded.thinking = next;
          void updateAppConfig({ configDir: loaded.configDir, configPath: loaded.configPath }, { thinking: next });
          rebuildAgent(loaded, { preserveConversation: true });
          requestRender();
          return;
        }
        openPicker('thinking');
        return;
      }
      // Unknown command: treat as normal prompt.
    }

    if (!line.length) {
      requestRender();
      return;
    }

    agent?.enqueueUserText(line);
    void drainQueue();
    requestRender();
  });

  requestRender();
};

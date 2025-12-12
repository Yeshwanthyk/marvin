import { Agent, ProviderTransport, type AgentEvent } from '@mu-agents/runtime';
import { createDefaultToolRegistry } from '@mu-agents/tools';
import type { AgentMessage } from '@mu-agents/types';
import {
  GitBranchWatcher,
  Input,
  type KeyEvent,
  KeyReader,
  MarkdownLite,
  ProcessTerminal,
  StatusBar,
  StatusBarModel,
  Tui,
  type RenderContext,
  type RenderResult,
  type Widget,
} from '@mu-agents/tui-lite';
import { loadAppConfig, type LoadedAppConfig } from './config';

const messageToMarkdown = (m: AgentMessage): string => {
  if (m.role === 'user' || m.role === 'assistant') {
    const text = m.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const title = m.role === 'user' ? 'User' : 'Assistant';
    return `### ${title}\n${text}`;
  }
  if (m.role === 'tool') {
    const title = `Tool: ${m.toolName}`;
    const text = m.content
      .map((b) => (b.type === 'tool-result' ? JSON.stringify(b.result, null, 2) : ''))
      .filter(Boolean)
      .join('\n');
    return `### ${title}\n\`\`\`json\n${text}\n\`\`\``;
  }
  return `### ${m.role}\n`;
};

class ChatView implements Widget {
  private transcript = '';

  setTranscript(markdown: string): void {
    this.transcript = markdown;
  }

  render(ctx: RenderContext): RenderResult {
    const widget = new MarkdownLite({ markdown: this.transcript });
    const rendered = widget.render(ctx);
    const lines = rendered.lines.length > ctx.height ? rendered.lines.slice(rendered.lines.length - ctx.height) : rendered.lines;
    return { lines };
  }
}

class MainLayout implements Widget {
  constructor(private readonly chat: ChatView, private readonly input: Input) {}

  render(ctx: RenderContext): RenderResult {
    const chatHeight = Math.max(0, ctx.height - 1);
    const chat = this.chat.render({ width: ctx.width, height: chatHeight });
    const input = this.input.render({ width: ctx.width, height: 1 });
    return { lines: [...chat.lines, ...input.lines], cursor: input.cursor };
  }
}

const buildTranscript = (conversation: AgentMessage[], inFlight?: string): string => {
  const parts = conversation.map(messageToMarkdown);
  if (inFlight && inFlight.trim().length) {
    parts.push(`### Assistant\n${inFlight}`);
  }
  return parts.join('\n\n');
};

const parseCommand = (line: string): { cmd: string; arg?: string } | undefined => {
  if (!line.startsWith('/')) return undefined;
  const trimmed = line.trim();
  const space = trimmed.indexOf(' ');
  if (space === -1) return { cmd: trimmed.slice(1) };
  return { cmd: trimmed.slice(1, space), arg: trimmed.slice(space + 1).trim() };
};

export const runTui = async (args?: {
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: 'off' | 'low' | 'medium' | 'high';
}) => {
  const loaded = await loadAppConfig({
    configDir: args?.configDir,
    configPath: args?.configPath,
    provider: args?.provider,
    model: args?.model,
    thinking: args?.thinking,
  });
  const terminal = new ProcessTerminal();
  const keyReader = new KeyReader(terminal);
  const input = new Input({ prompt: '> ', placeholder: 'Type a message, /model <name>, /clear' });
  const chat = new ChatView();

  const statusModel = new StatusBarModel({ cwd: process.cwd(), branch: undefined });
  const status = new StatusBar({ model: statusModel, style: { bg: 'gray', fg: 'black' } });
  const tui = new Tui(terminal, { main: new MainLayout(chat, input), status });

  const tools = createDefaultToolRegistry({ defaultContext: { cwd: process.cwd() } });
  const toolDefs = tools.listDefinitions();
  const transport = new ProviderTransport({
    getApiKey: loaded.apiKeys.getApiKey,
    setApiKey: loaded.apiKeys.setApiKey,
  });

  let agent: Agent | undefined;
  let inFlightText = '';
  let renderPending = false;
  let drainRunning = false;

  const requestRender = () => {
    if (renderPending) return;
    renderPending = true;
    queueMicrotask(() => {
      renderPending = false;
      chat.setTranscript(buildTranscript(agent?.getConversation() ?? [], inFlightText));
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
      statusModel.ingestEvent(event);
      if (event.type === 'provider') {
        if (event.event.type === 'text-delta') {
          inFlightText += event.event.text;
          requestRender();
        } else if (event.event.type === 'text-complete') {
          inFlightText = event.event.text;
          requestRender();
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

  rebuildAgent(loaded);

  const branchWatcher = new GitBranchWatcher();
  const branch = await branchWatcher.start(process.cwd(), (b: string | undefined) => {
    statusModel.setBranch(b);
    requestRender();
  });

  const app = tui.start();
  const keys = keyReader.start((key: KeyEvent) => {
    if (key.name === 'ctrl-c') {
      agent?.close();
      branch.stop();
      keys.stop();
      app.stop();
      process.stdout.write('\n');
      process.exit(0);
    }

    if (key.name === 'escape') {
      agent?.stop('interrupted');
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
      if (cmd.cmd === 'model') {
        const next = cmd.arg?.trim();
        if (next) {
          loaded.agentConfig = { ...loaded.agentConfig, model: next };
          rebuildAgent(loaded, { preserveConversation: true });
          requestRender();
        }
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

import { Agent, ProviderTransport, type AgentEvent } from '@mu-agents/agent-core';
import { getApiKey, getModels, getProviders, type AssistantMessage, type Message, type TextContent, type ToolResultMessage } from '@mu-agents/ai';
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
  visibleWidth,
} from '@mu-agents/tui';
import chalk from 'chalk';
import { codingTools } from '@mu-agents/base-tools';
import type { ThinkingLevel } from '@mu-agents/agent-core';
import { loadAppConfig, updateAppConfig } from './config.js';
import { SessionManager, type LoadedSession, type SessionInfo } from './session-manager.js';
import { existsSync, readFileSync, watch, type FSWatcher } from 'fs';
import { dirname, join } from 'path';

// Editorial theme palette
const colors = {
  text: '#e8e4dc',      // warm cream
  dimmed: '#6b6b70',    // muted gray
  accent: '#ff6b5b',    // warm coral
  code: '#5cecc6',      // teal
  border: '#3a3a40',    // subtle border
  // Tool backgrounds - more visible
  toolPending: '#2d2d3a',   // purple-gray (running)
  toolSuccess: '#1a2a1a',   // green tint (success)
  toolError: '#2a1a1a',     // red tint (error)
  // Tool accents
  toolBorder: '#4a4a5a',    // visible border
};

const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.hex('#ffffff').bold(text),
  link: (text) => chalk.hex('#88c0d0').underline(text),  // soft blue
  linkUrl: (text) => chalk.hex(colors.dimmed)(text),
  code: (text) => chalk.hex('#d08770')(text),            // soft orange
  codeBlock: (text) => chalk.hex(colors.text)(text),
  codeBlockBorder: (text) => chalk.hex(colors.dimmed)(text),
  quote: (text) => chalk.hex(colors.text).italic(text),
  quoteBorder: (text) => chalk.hex(colors.dimmed)(text),
  hr: (text) => chalk.hex(colors.dimmed)(text),
  listBullet: (text) => chalk.hex(colors.dimmed)(text),  // subtle bullets
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
};

const editorTheme: EditorTheme = {
  borderColor: (text) => chalk.hex(colors.border)(text),
  selectList: {
    selectedPrefix: (text) => chalk.hex(colors.accent)(text),
    selectedText: (text) => chalk.hex(colors.text).bold(text),
    description: (text) => chalk.hex(colors.dimmed)(text),
    scrollInfo: (text) => chalk.hex(colors.dimmed)(text),
    noMatch: (text) => chalk.hex(colors.dimmed)(text),
  },
};

// Git branch detection
function findGitHeadPath(): string | null {
  let dir = process.cwd();
  while (true) {
    const gitHeadPath = join(dir, '.git', 'HEAD');
    if (existsSync(gitHeadPath)) return gitHeadPath;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function getCurrentBranch(): string | null {
  try {
    const gitHeadPath = findGitHeadPath();
    if (!gitHeadPath) return null;
    const content = readFileSync(gitHeadPath, 'utf8').trim();
    if (content.startsWith('ref: refs/heads/')) return content.slice(16);
    return 'detached';
  } catch {
    return null;
  }
}

// Footer component
class Footer implements Component {
  private totalInput = 0;
  private totalOutput = 0;
  private totalCacheRead = 0;
  private totalCost = 0;
  private lastContextTokens = 0;  // tokens from last message for context %
  private contextWindow = 0;      // model's context window size
  private modelId: string;
  private thinking: ThinkingLevel;
  private cachedBranch: string | null | undefined = undefined;
  private gitWatcher: FSWatcher | null = null;
  private onBranchChange: (() => void) | null = null;

  constructor(modelId: string, thinking: ThinkingLevel, contextWindow: number = 0) {
    this.modelId = modelId;
    this.thinking = thinking;
    this.contextWindow = contextWindow;
  }

  setModel(modelId: string, contextWindow: number = 0) { 
    this.modelId = modelId; 
    this.contextWindow = contextWindow;
  }
  setThinking(thinking: ThinkingLevel) { this.thinking = thinking; }

  addUsage(msg: AssistantMessage) {
    this.totalInput += msg.usage.input;
    this.totalOutput += msg.usage.output;
    this.totalCacheRead += msg.usage.cacheRead;
    this.totalCost += msg.usage.cost.total;
    // Track last message context for percentage calculation
    this.lastContextTokens = msg.usage.input + msg.usage.output + msg.usage.cacheRead + (msg.usage.cacheWrite || 0);
  }

  reset() {
    this.totalInput = 0;
    this.totalOutput = 0;
    this.totalCacheRead = 0;
    this.totalCost = 0;
    this.lastContextTokens = 0;
  }

  watchBranch(onChange: () => void) {
    this.onBranchChange = onChange;
    const gitHeadPath = findGitHeadPath();
    if (!gitHeadPath) return;
    try {
      this.gitWatcher = watch(gitHeadPath, () => {
        this.cachedBranch = undefined;
        if (this.onBranchChange) this.onBranchChange();
      });
    } catch {}
  }

  dispose() {
    if (this.gitWatcher) {
      this.gitWatcher.close();
      this.gitWatcher = null;
    }
  }

  invalidate() {
    this.cachedBranch = undefined;
  }

  private getBranch(): string | null {
    if (this.cachedBranch !== undefined) return this.cachedBranch;
    this.cachedBranch = getCurrentBranch();
    return this.cachedBranch;
  }

  render(width: number): string[] {
    const fmt = (n: number) => n < 1000 ? String(n) : n < 10000 ? (n/1000).toFixed(1)+'k' : Math.round(n/1000)+'k';
    const dim = chalk.hex(colors.dimmed);

    // Get project name (last part of cwd)
    const cwd = process.cwd();
    const project = cwd.split('/').pop() || cwd;
    
    // Branch
    const branch = this.getBranch();
    
    // Context percentage
    let ctx = '';
    if (this.contextWindow > 0 && this.lastContextTokens > 0) {
      const pct = (this.lastContextTokens / this.contextWindow) * 100;
      const pctStr = pct < 10 ? pct.toFixed(1) : Math.round(pct).toString();
      ctx = `${pctStr}%/${fmt(this.contextWindow)}`;
      if (pct > 90) ctx = chalk.hex(colors.accent)(ctx);
      else if (pct > 70) ctx = chalk.hex('#ffcc00')(ctx);
    }

    // Model + thinking
    const model = this.modelId + (this.thinking !== 'off' ? ` · ${this.thinking}` : '');

    // Single line: project branch | context | model
    const left = project + (branch ? ` ${dim('(')}${branch}${dim(')')}` : '');
    const right = (ctx ? ctx + '  ' : '') + model;
    const leftWidth = visibleWidth(left);
    const rightWidth = visibleWidth(right);
    const padding = Math.max(2, width - leftWidth - rightWidth);
    
    return [dim(left + ' '.repeat(padding) + right)];
  }
}

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

// Shorten path with ~ for home directory
const shortenPath = (p: string): string => {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
};

// Get text content from tool result
const getToolText = (result: unknown): string => {
  if (!result || typeof result !== 'object') return String(result);
  const maybe = result as { content?: unknown };
  const content = Array.isArray(maybe.content) ? maybe.content : [];
  return textFromBlocks(content as Array<{ type: string }>);
};

// Get diff from tool result details
const getToolDiff = (result: unknown): string | null => {
  if (!result || typeof result !== 'object') return null;
  const maybe = result as { details?: { diff?: string } };
  return maybe.details?.diff || null;
};

// Color diff lines
const colorDiff = (diff: string): string => {
  return diff.split('\n').map(line => {
    if (line.startsWith('+')) return chalk.hex('#5cecc6')(line);  // added - teal
    if (line.startsWith('-')) return chalk.hex('#ff6b5b')(line);  // removed - coral
    return chalk.hex(colors.dimmed)(line);                        // context - dimmed
  }).join('\n');
};

// Tool-specific colors
const toolColors: Record<string, string> = {
  bash: '#a3be8c',   // green
  read: '#88c0d0',   // blue  
  write: '#d08770',  // orange
  edit: '#b48ead',   // purple
};

// Render tool header based on tool type
const renderToolHeader = (toolName: string, args: any, isError: boolean = false): string => {
  const dim = chalk.hex(colors.dimmed);
  const text = chalk.hex(colors.text);
  const toolColor = chalk.hex(toolColors[toolName] || colors.code);
  
  switch (toolName) {
    case 'bash': {
      const cmd = args?.command || '...';
      return toolColor.bold('$ ') + text(cmd);
    }
    case 'read': {
      const path = shortenPath(args?.path || args?.file_path || '');
      const offset = args?.offset;
      const limit = args?.limit;
      let range = '';
      if (offset || limit) {
        const start = offset || 1;
        const end = limit ? start + limit - 1 : '';
        range = dim(`:${start}${end ? `-${end}` : ''}`);
      }
      return toolColor.bold('read ') + text(path || '...') + range;
    }
    case 'write': {
      const path = shortenPath(args?.path || args?.file_path || '');
      const content = args?.content || '';
      const lines = content.split('\n').length;
      const lineInfo = lines > 1 ? dim(` (${lines} lines)`) : '';
      return toolColor.bold('write ') + text(path || '...') + lineInfo;
    }
    case 'edit': {
      const path = shortenPath(args?.path || args?.file_path || '');
      return toolColor.bold('edit ') + text(path || '...');
    }
    default:
      return toolColor.bold(toolName);
  }
};

// Render tool body based on tool type and result
const renderToolBody = (toolName: string, args: any, result: unknown, isPartial: boolean): string => {
  const text = getToolText(result);
  const dim = chalk.hex(colors.dimmed);
  const output = chalk.hex('#c5c5c0'); // slightly brighter for output on dark bg
  
  switch (toolName) {
    case 'bash': {
      if (!text) return isPartial ? dim('running...') : '';
      // Show last N lines for bash output
      const lines = text.trim().split('\n');
      const maxLines = 25;
      if (lines.length > maxLines) {
        const skipped = lines.length - maxLines;
        const shown = lines.slice(-maxLines);
        return dim(`... (${skipped} earlier lines)\n`) + shown.map(l => output(l)).join('\n');
      }
      return lines.map(l => output(l)).join('\n');
    }
    case 'read': {
      if (!text) return isPartial ? dim('reading...') : '';
      const lines = text.split('\n');
      const maxLines = 20;
      if (lines.length > maxLines) {
        const shown = lines.slice(0, maxLines);
        const remaining = lines.length - maxLines;
        return shown.map(l => output(l)).join('\n') + dim(`\n... (${remaining} more lines)`);
      }
      return lines.map(l => output(l)).join('\n');
    }
    case 'write': {
      const content = args?.content || '';
      if (!content) return isPartial ? dim('writing...') : '';
      const lines = content.split('\n');
      const maxLines = 15;
      if (lines.length > maxLines) {
        const shown = lines.slice(0, maxLines);
        const remaining = lines.length - maxLines;
        return shown.map((l: string) => output(l)).join('\n') + dim(`\n... (${remaining} more lines)`);
      }
      return lines.map((l: string) => output(l)).join('\n');
    }
    case 'edit': {
      const diff = getToolDiff(result);
      if (diff) {
        return colorDiff(diff);
      }
      // Error case - show the error message
      if (text) return chalk.hex(colors.accent)(text);
      return isPartial ? dim('editing...') : '';
    }
    default: {
      // Generic: show args as JSON then result text
      const parts: string[] = [];
      if (args && Object.keys(args).length > 0) {
        parts.push(dim(JSON.stringify(args, null, 2)));
      }
      if (text) {
        parts.push(output(text));
      }
      return parts.join('\n\n') || (isPartial ? dim('...') : '');
    }
  }
};

// Full tool render
const renderTool = (toolName: string, args: any, result: unknown, isError: boolean, isPartial: boolean): string => {
  const header = renderToolHeader(toolName, args, isError);
  const body = renderToolBody(toolName, args, result, isPartial);
  
  if (body) {
    return `${header}\n\n${body}`;
  }
  return header;
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
  continueSession?: boolean;
  resumeSession?: boolean;
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

  // Simple header - just app name
  const header = new Text(chalk.hex(colors.dimmed)('mu'), 1, 0);
  tui.addChild(header);

  // Footer with stats
  const footer = new Footer(currentModelId, currentThinking, loaded.model.contextWindow);

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

  // Session management
  const sessionManager = new SessionManager(loaded.configDir);
  let sessionStarted = false;

  const ensureSession = () => {
    if (!sessionStarted) {
      sessionManager.startSession(currentProvider, currentModelId, currentThinking);
      sessionStarted = true;
    }
  };

  let isResponding = false;
  let currentAssistant: Markdown | undefined;
  const toolBlocks = new Map<string, { component: Text; data: { name: string; args: any } }>();
  let loader: Loader | undefined;
  let lastCtrlC = 0;

  const removeLoader = () => {
    if (!loader) return;
    tui.removeChild(loader);
    loader = undefined;
  };

  const addMessage = (component: Component) => {
    // Insert before the editor and footer (last 2 children)
    const idx = Math.max(0, tui.children.length - 2);
    tui.children.splice(idx, 0, component);
  };

  const clearConversation = () => {
    // Keep header + editor + footer (first 1, last 2)
    tui.children.splice(1, tui.children.length - 3);
    currentAssistant = undefined;
    toolBlocks.clear();
    footer.reset();
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
  tui.addChild(footer);
  tui.setFocus(focusProxy);

  // Watch for git branch changes
  footer.watchBranch(() => tui.requestRender());

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
      // Save message to session
      sessionManager.appendMessage(event.message as import('@mu-agents/agent-core').AppMessage);
      
      if (event.message.role === 'assistant' && currentAssistant) {
        currentAssistant.setText(renderMessage(event.message as Message));
        currentAssistant = undefined;
        // Update footer with usage stats
        footer.addUsage(event.message as AssistantMessage);
        tui.requestRender();
      }
    }

    if (event.type === 'tool_execution_start') {
      removeLoader();
      const toolData = { name: event.toolName, args: event.args };
      const content = renderTool(event.toolName, event.args, null, false, true);
      const bgFn = (text: string) => chalk.bgHex(colors.toolPending)(text);
      const txt = new Text(content, 1, 1, bgFn);
      toolBlocks.set(event.toolCallId, { component: txt, data: toolData });
      addMessage(txt);
      tui.requestRender();
    }

    if (event.type === 'tool_execution_update') {
      const entry = toolBlocks.get(event.toolCallId);
      if (!entry) return;
      const content = renderTool(entry.data.name, entry.data.args, event.partialResult, false, true);
      entry.component.setText(content);
      tui.requestRender();
    }

    if (event.type === 'tool_execution_end') {
      const entry = toolBlocks.get(event.toolCallId);
      if (!entry) return;
      const content = renderTool(entry.data.name, entry.data.args, event.result, event.isError, false);
      // Change background based on success/error
      const bgColor = event.isError ? colors.toolError : colors.toolSuccess;
      entry.component.setCustomBgFn((text: string) => chalk.bgHex(bgColor)(text));
      entry.component.setText(content);
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
        footer.setThinking(next);
        void updateAppConfig({ configDir: loaded.configDir, configPath: loaded.configPath }, { thinking: next });
        editor.setText('');
        tui.requestRender();
        return;
      }
    }

    if (line.startsWith('/model')) {
      const rest = line.slice('/model'.length).trim();

      if (!rest) {
        addMessage(new Text(chalk.hex(colors.dimmed)('Usage: /model <provider> <modelId> (or /model <modelId>). Tip: use Tab completion.')));
        editor.setText('');
        tui.requestRender();
        return;
      }

      if (isResponding) {
        addMessage(new Text(chalk.hex(colors.dimmed)('Model cannot be changed while responding. Use /abort first.')));
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
          addMessage(new Text(chalk.hex(colors.dimmed)(`Pick a model: /model ${provider} <modelId>. Examples: ${examples}`)));
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
          addMessage(new Text(chalk.hex(colors.accent)(`Unknown model "${token}" for provider ${currentProvider}. Examples: ${examples}`)));
          editor.setText('');
          tui.requestRender();
          return;
        }

        agent.setModel(model);
        currentModelId = model.id;
        footer.setModel(model.id, model.contextWindow);
        void updateAppConfig(
          { configDir: loaded.configDir, configPath: loaded.configPath },
          { provider: currentProvider, model: model.id },
        );
        addMessage(new Text(chalk.hex(colors.dimmed)(`Switched model to ${currentProvider} ${model.id}`)));
        editor.setText('');
        tui.requestRender();
        return;
      }

      const [providerRaw, ...modelParts] = parts;
      const modelId = modelParts.join(' ').trim();
      const provider = resolveProvider(providerRaw ?? '');
      if (!provider) {
        addMessage(new Text(chalk.hex(colors.accent)(`Unknown provider "${providerRaw}". Known: ${getProviders().join(', ')}`)));
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
        addMessage(new Text(chalk.hex(colors.accent)(`Unknown model "${modelId}" for provider ${provider}. Examples: ${examples}`)));
        editor.setText('');
        tui.requestRender();
        return;
      }

      agent.setModel(model);
      currentProvider = provider;
      currentModelId = model.id;
      footer.setModel(model.id, model.contextWindow);
      void updateAppConfig({ configDir: loaded.configDir, configPath: loaded.configPath }, { provider, model: model.id });
      addMessage(new Text(chalk.hex(colors.dimmed)(`Switched model to ${provider} ${model.id}`)));
      editor.setText('');
      tui.requestRender();
      return;
    }

    // Normal prompt
    if (isResponding) return;

    editor.setText('');

    // Ensure session is started on first message
    ensureSession();
    
    // Save user message to session
    const userMessage: import('@mu-agents/agent-core').AppMessage = {
      role: 'user',
      content: [{ type: 'text', text: line }],
      timestamp: Date.now(),
    };
    sessionManager.appendMessage(userMessage);

    addMessage(new Markdown(chalk.hex(colors.dimmed)('› ') + line, 1, 1, markdownTheme));

    loader = new Loader(tui, (s) => chalk.hex(colors.accent)(s), (s) => chalk.hex(colors.dimmed)(s), 'Thinking...');
    addMessage(loader);

    isResponding = true;
    editor.disableSubmit = true;
    tui.requestRender();

    void agent.prompt(line).catch((err) => {
      removeLoader();
      addMessage(new Text(chalk.hex(colors.accent)(String(err instanceof Error ? err.message : err))));
      isResponding = false;
      editor.disableSubmit = false;
      tui.requestRender();
    });
  };

  // Helper to restore a loaded session to the UI
  const restoreSession = (session: LoadedSession) => {
    const { metadata, messages } = session;
    
    // Update provider/model/thinking if different
    const resolvedProvider = resolveProvider(metadata.provider);
    if (resolvedProvider) {
      const resolvedModel = resolveModel(resolvedProvider, metadata.modelId);
      if (resolvedModel) {
        currentProvider = resolvedProvider;
        currentModelId = resolvedModel.id;
        currentThinking = metadata.thinkingLevel;
        agent.setModel(resolvedModel);
        agent.setThinkingLevel(metadata.thinkingLevel);
        footer.setModel(resolvedModel.id, resolvedModel.contextWindow);
        footer.setThinking(metadata.thinkingLevel);
      }
    }
    
    // Restore messages to agent
    agent.replaceMessages(messages);
    
    // Render conversation history
    for (const msg of messages) {
      if (msg.role === 'user') {
        const text = typeof msg.content === 'string' 
          ? msg.content 
          : textFromBlocks(msg.content as Array<{ type: string }>);
        addMessage(new Markdown(chalk.hex(colors.dimmed)('› ') + text, 1, 1, markdownTheme));
      } else if (msg.role === 'assistant') {
        const text = renderMessage(msg as Message);
        if (text.trim()) {
          addMessage(new Markdown(text, 1, 1, markdownTheme));
        }
        // Add usage to footer if available
        const assistantMsg = msg as AssistantMessage;
        if (assistantMsg.usage) {
          footer.addUsage(assistantMsg);
        }
      }
      // Note: toolResult messages are part of assistant turns, not rendered separately
    }
    
    // Continue the existing session file
    sessionManager.continueSession(sessionManager.listSessions().find(s => s.id === metadata.id)?.path || '', metadata.id);
    sessionStarted = true;
    
    addMessage(new Text(chalk.hex(colors.dimmed)(`Session restored (${messages.length} messages)`)));
  };

  // Handle -c (continue most recent session)
  if (args?.continueSession) {
    const session = sessionManager.loadLatest();
    if (session) {
      restoreSession(session);
    } else {
      addMessage(new Text(chalk.hex(colors.dimmed)('No session found for this directory')));
    }
  }

  // Handle -r (resume from picker)
  if (args?.resumeSession) {
    const sessions = sessionManager.listSessions();
    if (sessions.length === 0) {
      addMessage(new Text(chalk.hex(colors.dimmed)('No sessions found for this directory')));
    } else {
      // Simple non-interactive picker: show list and load most recent
      // TODO: implement proper picker UI
      const formatDate = (ts: number) => {
        const d = new Date(ts);
        return d.toLocaleString('en-US', { 
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
      };
      
      if (sessions.length === 1) {
        const session = sessionManager.loadSession(sessions[0]!.path);
        if (session) restoreSession(session);
      } else {
        // Show available sessions and load most recent
        addMessage(new Text(chalk.hex(colors.dimmed)(`Found ${sessions.length} sessions:`)));
        for (const s of sessions.slice(0, 5)) {
          addMessage(new Text(chalk.hex(colors.dimmed)(`  ${formatDate(s.timestamp)} · ${s.provider}/${s.modelId}`)));
        }
        if (sessions.length > 5) {
          addMessage(new Text(chalk.hex(colors.dimmed)(`  ... and ${sessions.length - 5} more`)));
        }
        addMessage(new Text(chalk.hex(colors.dimmed)('Loading most recent session...')));
        const session = sessionManager.loadSession(sessions[0]!.path);
        if (session) restoreSession(session);
      }
    }
  }

  tui.start();
};

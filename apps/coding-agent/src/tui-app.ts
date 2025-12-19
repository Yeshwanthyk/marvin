import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens, type AgentEvent } from '@marvin-agents/agent-core';
import { getApiKey, getModels, getProviders, completeSimple, type AssistantMessage, type Message, type TextContent, type ThinkingContent, type ToolResultMessage } from '@marvin-agents/ai';
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
} from '@marvin-agents/tui';
import chalk from 'chalk';
import { codingTools } from '@marvin-agents/base-tools';
import { getLanguageFromPath, highlightCode as highlightCodeLines, replaceTabs } from './syntax-highlighting.js';
import type { ThinkingLevel } from '@marvin-agents/agent-core';
import { loadAppConfig, updateAppConfig } from './config.js';
import { SessionManager, type LoadedSession, type SessionInfo } from './session-manager.js';
import { existsSync, readFileSync, watch, type FSWatcher } from 'fs';
import { dirname, join } from 'path';

// Clean, readable palette
const colors = {
  text: '#d4d4d4',      // clean light gray (easier to read)
  dimmed: '#707070',    // muted gray
  accent: '#e06c75',    // soft red
  code: '#98c379',      // soft green
  border: '#3e3e3e',    // subtle border
  // Tool backgrounds
  toolPending: '#2c2c2c',
  toolSuccess: '#1e2a1e',
  toolError: '#2a1e1e',
  toolBorder: '#4a4a4a',
};

const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.hex('#e5e5e5').bold(text),
  link: (text) => chalk.hex('#61afef')(text),            // soft blue
  linkUrl: (text) => chalk.hex(colors.dimmed)(text),
  code: (text) => chalk.hex('#e5c07b')(text),            // warm yellow
  codeBlock: (text) => chalk.hex('#abb2bf')(text),       // muted for code
  codeBlockBorder: (text) => chalk.hex(colors.border)(text),
  quote: (text) => chalk.hex('#abb2bf').italic(text),
  quoteBorder: (text) => chalk.hex(colors.border)(text),
  hr: (text) => chalk.hex(colors.border)(text),
  listBullet: (text) => chalk.hex(colors.dimmed)(text),
  bold: (text) => chalk.hex('#e5e5e5').bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
  highlightCode: (code, lang) => {
    try {
      return highlightCodeLines(replaceTabs(code), lang);
    } catch {
      return replaceTabs(code).split('\n').map((line) => chalk.hex('#abb2bf')(line));
    }
  },
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

function getGitDiffStats(): { files: number; ins: number; del: number } | null {
  try {
    const result = Bun.spawnSync(['git', 'diff', '--shortstat'], { cwd: process.cwd() });
    const output = result.stdout.toString().trim();
    if (!output) return { files: 0, ins: 0, del: 0 };
    const files = output.match(/(\d+) files? changed/)?.[1] ?? '0';
    const ins = output.match(/(\d+) insertions?/)?.[1] ?? '0';
    const del = output.match(/(\d+) deletions?/)?.[1] ?? '0';
    return { files: +files, ins: +ins, del: +del };
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
  private queueCount = 0;
  private retryStatus: string | null = null;
  private cachedGitStats: { files: number; ins: number; del: number } | null = null;
  private gitStatsTime = 0;
  private activityState: 'idle' | 'thinking' | 'streaming' | 'tool' | 'waiting' = 'idle';
  private activityStart = 0;
  private spinnerFrame = 0;
  private spinnerInterval: NodeJS.Timeout | null = null;
  private onSpinnerTick: (() => void) | null = null;

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
  setQueueCount(count: number) { this.queueCount = count; }
  setRetryStatus(status: string | null) { this.retryStatus = status; }
  
  setActivity(state: 'idle' | 'thinking' | 'streaming' | 'tool' | 'waiting', onTick?: () => void) {
    const wasIdle = this.activityState === 'idle';
    this.activityState = state;
    this.onSpinnerTick = onTick || null;
    if (state === 'idle') {
      if (this.spinnerInterval) {
        clearInterval(this.spinnerInterval);
        this.spinnerInterval = null;
      }
    } else {
      if (wasIdle) this.activityStart = Date.now();
      if (!this.spinnerInterval) {
        this.spinnerInterval = setInterval(() => {
          this.spinnerFrame = (this.spinnerFrame + 1) % 8;
          if (this.onSpinnerTick) this.onSpinnerTick();
        }, 80);
      }
    }
  }

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

  private getGitStats(): { files: number; ins: number; del: number } | null {
    const now = Date.now();
    if (now - this.gitStatsTime > 2000) {
      this.cachedGitStats = getGitDiffStats();
      this.gitStatsTime = now;
    }
    return this.cachedGitStats;
  }

  render(width: number): string[] {
    const fmt = (n: number) => n < 1000 ? String(n) : n < 10000 ? (n/1000).toFixed(1)+'k' : Math.round(n/1000)+'k';
    const dim = chalk.hex(colors.dimmed);
    const accent = chalk.hex(colors.accent);
    const green = chalk.hex('#a3be8c');
    const red = chalk.hex('#bf616a');
    const sep = dim(' · ');

    // Retry status takes precedence
    if (this.retryStatus) {
      return [accent(this.retryStatus)];
    }

    const parts: string[] = [];

    // Project (branch)
    const cwd = process.cwd();
    const project = cwd.split('/').pop() || cwd;
    const branch = this.getBranch();
    parts.push(dim(project + (branch ? ` (${branch})` : '')));

    // Model · thinking
    parts.push(this.modelId + (this.thinking !== 'off' ? dim(' · ') + this.thinking : ''));

    // Context %
    if (this.contextWindow > 0 && this.lastContextTokens > 0) {
      const pct = (this.lastContextTokens / this.contextWindow) * 100;
      const pctStr = pct < 10 ? pct.toFixed(1) : Math.round(pct).toString();
      let ctx = `${pctStr}%`;
      if (pct > 90) ctx = accent(ctx);
      else if (pct > 70) ctx = chalk.hex('#ffcc00')(ctx);
      parts.push(ctx);
    }

    // Git diff stats
    const stats = this.getGitStats();
    if (stats && (stats.ins > 0 || stats.del > 0)) {
      parts.push(green(`+${stats.ins}`) + dim('/') + red(`-${stats.del}`));
    }

    // Queue indicator
    if (this.queueCount > 0) {
      parts.push(chalk.hex('#88c0d0')(`${this.queueCount}q`));
    }

    // Activity spinner
    if (this.activityState !== 'idle') {
      const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];
      const spinner = spinners[this.spinnerFrame];
      const labels: Record<string, string> = {
        thinking: 'thinking',
        streaming: 'streaming', 
        tool: 'running',
        waiting: 'waiting',
      };
      const stateColors: Record<string, string> = {
        thinking: '#b48ead',
        streaming: '#88c0d0',
        tool: '#ebcb8b',
        waiting: '#a3be8c',
      };
      const color = chalk.hex(stateColors[this.activityState] || colors.accent);
      parts.push(color(`${spinner} ${labels[this.activityState]}`));
    }

    return [parts.join(sep)];
  }
}

const textFromBlocks = (blocks: Array<{ type: string }>): string => {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') parts.push((block as TextContent).text);
  }
  return parts.join('');
};

const renderMessage = (message: Message, includeThinking = true): string => {
  if (message.role === 'user') {
    if (typeof message.content === 'string') return message.content;
    return textFromBlocks(message.content);
  }

  if (message.role === 'assistant') {
    const parts: string[] = [];
    const dim = chalk.hex(colors.dimmed);
    
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push(block.text);
      } else if (block.type === 'thinking' && includeThinking) {
        const thinking = (block as ThinkingContent).thinking;
        if (thinking?.trim()) {
          // Render thinking with label
          const label = chalk.hex('#e5c07b')('Thinking: ');
          parts.push(label + dim.italic(thinking.trim()));
        }
      }
    }
    return parts.join('\n\n');
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

// Get diff text from tool result details (edit tool)
const getEditDiffText = (result: unknown): string | null => {
  if (!result || typeof result !== 'object') return null;
  const maybe = result as { details?: { diff?: string } };
  return maybe.details?.diff || null;
};

const renderEditDiff = (diffText: string): string => {
  const dim = chalk.hex(colors.dimmed);
  const removed = chalk.hex('#bf616a');
  const added = chalk.hex('#a3be8c');

  return diffText
    .split('\n')
    .map((line) => {
      const normalized = replaceTabs(line);
      if (normalized.startsWith('+')) return added(normalized);
      if (normalized.startsWith('-')) return removed(normalized);
      return dim(normalized);
    })
    .join('\n');
};

// Tool-specific colors
const toolColors: Record<string, string> = {
  bash: '#98c379',   // green
  read: '#61afef',   // blue  
  write: '#e5c07b',  // yellow
  edit: '#c678dd',   // purple
};

const bashBadge = (cmd: string): string => {
  const first = cmd.trim().split(/\s+/)[0] || '';
  return { git: 'GIT', ls: 'LIST', fd: 'LIST', cat: 'READ', head: 'READ', tail: 'READ',
    rg: 'SEARCH', grep: 'SEARCH', npm: 'NPM', cargo: 'CARGO', bun: 'BUN' }[first] || 'RUN';
};

// Render tool header based on tool type
const renderToolHeader = (toolName: string, args: any, isError: boolean = false): string => {
  const dim = chalk.hex(colors.dimmed);
  const text = chalk.hex(colors.text);
  const toolColor = chalk.hex(toolColors[toolName] || colors.code);
  
  switch (toolName) {
    case 'bash': {
      const cmd = args?.command || '...';
      const firstLine = cmd.split('\n')[0];
      const badge = bashBadge(cmd);
      const truncated = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
      return toolColor.bold(badge) + ' ' + dim(truncated);
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
      if (!text) return isPartial ? dim('...') : '';
      const lines = text.trim().split('\n');
      const total = lines.length;
      
      // Compact: show first 3 + last 5 lines max
      const headCount = 3;
      const tailCount = 5;
      const maxShow = headCount + tailCount;
      
      if (total <= maxShow) {
        return lines.map(l => output(l)).join('\n');
      }
      
      // Show head...tail with count
      const head = lines.slice(0, headCount);
      const tail = lines.slice(-tailCount);
      const skipped = total - maxShow;
      return [
        ...head.map(l => output(l)),
        dim(`  ... ${skipped} lines ...`),
        ...tail.map(l => output(l)),
      ].join('\n');
    }
    case 'read': {
      // Just show line count, no content (too noisy)
      if (!text) return isPartial ? dim('reading...') : '';
      const lineCount = text.split('\n').length;
      return dim(`${lineCount} lines`);
    }
    case 'write': {
      const content = args?.content || '';
      if (!content) return isPartial ? dim('writing...') : '';

      const rawPath = args?.path || args?.file_path || '';
      const lang = getLanguageFromPath(rawPath);
      const normalized = replaceTabs(content);

      let lines: string[];
      let highlighted = false;
      if (lang) {
        try {
          lines = highlightCodeLines(normalized, lang);
          highlighted = true;
        } catch {
          lines = normalized.split('\n');
        }
      } else {
        lines = normalized.split('\n');
      }

      const renderLine = (line: string) => highlighted ? line : output(line);

      const maxLines = 15;
      const prefix = isPartial ? dim('Creating file:\n\n') : '';
      if (lines.length > maxLines) {
        const shown = lines.slice(0, maxLines);
        const remaining = lines.length - maxLines;
        return prefix + shown.map(renderLine).join('\n') + dim(`\n... (${remaining} more lines)`);
      }
      return prefix + lines.map(renderLine).join('\n');
    }
    case 'edit': {
      const diffText = getEditDiffText(result);
      if (diffText) return renderEditDiff(diffText);
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
  // Read: single line, no body
  if (toolName === 'read') {
    const dim = chalk.hex(colors.dimmed);
    const text = chalk.hex(colors.text);
    const toolColor = chalk.hex(toolColors.read);
    const path = shortenPath(args?.path || args?.file_path || '');
    const content = getToolText(result);
    
    if (isPartial || !content) {
      return toolColor.bold('read') + ' ' + text(path);
    }
    const lineCount = content.split('\n').length;
    return toolColor.bold('read') + ' ' + text(path) + dim(` (${lineCount} lines)`);
  }
  
  const header = renderToolHeader(toolName, args, isError);
  const body = renderToolBody(toolName, args, result, isPartial);
  
  if (body) {
    return `${header}\n\n${body}`;
  }
  return header;
};

// Tool render with expand/collapse toggle for stored output
const renderToolWithExpand = (toolName: string, args: any, fullOutput: string, expanded: boolean): string => {
  // Read: always single line, no expand
  if (toolName === 'read') {
    const dim = chalk.hex(colors.dimmed);
    const text = chalk.hex(colors.text);
    const toolColor = chalk.hex(toolColors.read);
    const path = shortenPath(args?.path || args?.file_path || '');
    const lineCount = fullOutput ? fullOutput.split('\n').length : 0;
    return toolColor.bold('read') + ' ' + text(path) + (lineCount ? dim(` (${lineCount} lines)`) : '');
  }
  
  const header = renderToolHeader(toolName, args);
  const dim = chalk.hex(colors.dimmed);
  const output = chalk.hex('#c5c5c0');
  
  if (!fullOutput) return header;
  
  const lines = fullOutput.trim().split('\n');
  const maxLines = toolName === 'bash' ? 25 : 15;
  
  if (expanded || lines.length <= maxLines) {
    // Show full output
    return `${header}\n\n${lines.map(l => output(l)).join('\n')}`;
  } else {
    // Show collapsed with hint
    const skipped = lines.length - maxLines;
    const shown = lines.slice(-maxLines);
    return `${header}\n\n${dim(`... (${skipped} earlier lines, Ctrl+O to expand)\n`)}${shown.map(l => output(l)).join('\n')}`;
  }
};

class FocusProxy implements Component {
  constructor(
    private readonly editor: Editor,
    private readonly onCtrlC: () => void,
    private readonly onEscape: () => boolean,
    private readonly onCtrlO: () => void,
    private readonly onCtrlP: () => void,
    private readonly onShiftTab: () => void,
  ) {}

  render(width: number): string[] {
    return this.editor.render(width);
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  handleInput(data: string): void {
    const code = data.charCodeAt(0);
    
    // Ctrl+C
    if (code === 3) {
      this.onCtrlC();
      return;
    }

    // Ctrl+O (toggle tool output)
    if (code === 15) {
      this.onCtrlO();
      return;
    }

    // Ctrl+P (cycle models)
    if (code === 16) {
      this.onCtrlP();
      return;
    }

    // Shift+Tab (cycle thinking)
    if (data === '\x1b[Z') {
      this.onShiftTab();
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
  // Extract first model for initial config (rest used for cycling)
  // Parse provider/model format if present
  const firstModelRaw = args?.model?.split(',')[0]?.trim();
  let firstProvider = args?.provider;
  let firstModel = firstModelRaw;
  if (firstModelRaw?.includes('/')) {
    const [p, m] = firstModelRaw.split('/');
    firstProvider = p;
    firstModel = m;
  }
  const loaded = await loadAppConfig({
    configDir: args?.configDir,
    configPath: args?.configPath,
    provider: firstProvider,
    model: firstModel,
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
  const header = new Text(chalk.hex(colors.dimmed)('marvin'), 1, 0);
  tui.addChild(header);

  // Footer with stats
  const footer = new Footer(currentModelId, currentThinking, loaded.model.contextWindow);

  // Model cycling setup - parse comma-separated models from args
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ModelEntry = { provider: KnownProvider; model: import('@marvin-agents/ai').Model<any> };
  const cycleModels: ModelEntry[] = [];
  const modelIds = args?.model?.split(',').map(s => s.trim()).filter(Boolean) || [currentModelId];
  for (const id of modelIds) {
    const hasSlash = id.includes('/');
    if (hasSlash) {
      const [provStr, modelStr] = id.split('/');
      const prov = resolveProvider(provStr!);
      if (!prov) continue;
      const model = resolveModel(prov, modelStr!);
      if (model) cycleModels.push({ provider: prov, model });
    } else {
      // Search all providers for this model id
      for (const prov of getProviders()) {
        const model = resolveModel(prov, id);
        if (model) {
          cycleModels.push({ provider: prov, model });
          break;
        }
      }
    }
  }
  // Ensure at least current model in cycle
  if (cycleModels.length === 0) {
    cycleModels.push({ provider: currentProvider, model: loaded.model });
  }
  let cycleIndex = 0;

  // Thinking levels for Shift+Tab cycling
  const thinkingLevels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

  const editor = new Editor(editorTheme);
  const autocomplete = new CombinedAutocompleteProvider(
    [
      { name: 'clear', description: 'Clear chat + reset agent' },
      { name: 'compact', description: 'Compact context into summary + start fresh' },
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

  const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider });

  // Codex token management (defaults to ~/.config/marvin/codex-tokens.json)
  const codexTransport = new CodexTransport({
    getTokens: async () => loadTokens({ configDir: loaded.configDir }),
    setTokens: async (tokens) => saveTokens(tokens, { configDir: loaded.configDir }),
    clearTokens: async () => clearTokens({ configDir: loaded.configDir }),
  });

  const transport = new RouterTransport({
    provider: providerTransport,
    codex: codexTransport,
  });
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
  const toolBlocks = new Map<string, { component: Text; data: { name: string; args: any; fullOutput?: string } }>();
  let loader: Loader | undefined;
  let lastCtrlC = 0;
  
  // Message queueing
  const queuedMessages: string[] = [];
  
  // Tool output toggle
  let toolOutputExpanded = false;
  
  // Auto retry state
  const retryConfig = { enabled: true, maxRetries: 3, baseDelayMs: 2000 };
  const retryablePattern = /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error/i;
  let retryAttempt = 0;
  let retryAbortController: AbortController | null = null;

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
    footer.setQueueCount(0);
    footer.setRetryStatus(null);
    queuedMessages.length = 0;
    retryAttempt = 0;
    agent.reset();
    tui.requestRender();
  };

  const abort = () => {
    agent.abort();
    agent.clearMessageQueue();
    // Queued messages restored to editor in onEscape handler
    tui.requestRender();
  };

  const exit = () => {
    tui.stop();
    process.stdout.write('\n');
    process.exit(0);
  };

  // Re-render tool blocks based on expanded state
  const rerenderToolBlocks = () => {
    for (const [, entry] of toolBlocks) {
      if (entry.data.fullOutput !== undefined) {
        const content = renderToolWithExpand(entry.data.name, entry.data.args, entry.data.fullOutput, toolOutputExpanded);
        entry.component.setText(content);
      }
    }
  };

  const SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;
  const SUMMARY_SUFFIX = `
</summary>`;

  const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- Absolute file paths of any relevant files that were read or modified
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

  const handleCompact = async (customInstructions?: string) => {
    const model = agent.state.model;
    if (!model) {
      throw new Error('No model configured');
    }

    // Build messages for summarization (filter to LLM-compatible roles)
    const messages = agent.state.messages.filter(
      (m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'
    ) as Message[];

    const prompt = customInstructions
      ? `${SUMMARIZATION_PROMPT}\n\nAdditional focus: ${customInstructions}`
      : SUMMARIZATION_PROMPT;

    const summarizationMessages: Message[] = [
      ...messages,
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        timestamp: Date.now(),
      },
    ];

    // Generate summary - use codex fetch for OAuth, regular API key otherwise
    const isCodex = currentProvider === 'codex';
    const response = await completeSimple(
      model,
      { messages: summarizationMessages },
      {
        maxTokens: 8192,
        apiKey: isCodex ? 'codex-oauth' : getApiKeyForProvider(currentProvider),
        fetch: isCodex ? codexTransport.getFetch() : undefined,
      },
    );

    // Check for error response
    if (response.errorMessage) {
      throw new Error(response.errorMessage);
    }

    const summary = response.content
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    if (!summary.trim()) {
      // Debug: show what we got
      const contentTypes = response.content.map(c => c.type).join(', ');
      throw new Error(`No text in response (got: ${contentTypes || 'empty'})`);
    }

    removeLoader();

    // Show summary in chat
    addMessage(new Text(chalk.hex(colors.dimmed)('─'.repeat(40))));
    addMessage(new Text(chalk.hex(colors.dimmed)('Context compacted. Summary:')));
    addMessage(new Markdown(summary, 1, 1, markdownTheme));
    addMessage(new Text(chalk.hex(colors.dimmed)('─'.repeat(40))));

    // Create summary message for new context
    const summaryMessage: import('@marvin-agents/agent-core').AppMessage = {
      role: 'user',
      content: [{ type: 'text', text: SUMMARY_PREFIX + summary + SUMMARY_SUFFIX }],
      timestamp: Date.now(),
    };

    // Reset agent and start fresh with summary
    agent.reset();
    agent.replaceMessages([summaryMessage]);

    // Reset footer stats
    footer.reset();
    footer.setQueueCount(0);
    queuedMessages.length = 0;

    // Start new session
    sessionStarted = false;
    ensureSession();
    sessionManager.appendMessage(summaryMessage);

    addMessage(new Text(chalk.hex(colors.dimmed)('New session started with compacted context')));
    tui.requestRender();
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
      // Escape during retry: cancel retry
      if (retryAbortController) {
        retryAbortController.abort();
        retryAbortController = null;
        retryAttempt = 0;
        footer.setRetryStatus(null);
        tui.requestRender();
        return true;
      }
      // Escape during response: abort + restore queued messages
      if (isResponding) {
        abort();
        if (queuedMessages.length > 0) {
          editor.setText(queuedMessages.join('\n'));
          queuedMessages.length = 0;
          footer.setQueueCount(0);
        }
        return true;
      }
      return false;
    },
    () => {
      // Ctrl+O: toggle tool output expanded
      toolOutputExpanded = !toolOutputExpanded;
      rerenderToolBlocks();
      tui.requestRender();
    },
    () => {
      // Ctrl+P: cycle models
      if (cycleModels.length <= 1) return;
      cycleIndex = (cycleIndex + 1) % cycleModels.length;
      const entry = cycleModels[cycleIndex]!;
      currentProvider = entry.provider;
      currentModelId = entry.model!.id;
      agent.setModel(entry.model!);
      footer.setModel(entry.model!.id, entry.model!.contextWindow);
      tui.requestRender();
    },
    () => {
      // Shift+Tab: cycle thinking levels
      const idx = thinkingLevels.indexOf(currentThinking);
      const nextIdx = (idx + 1) % thinkingLevels.length;
      currentThinking = thinkingLevels[nextIdx]!;
      agent.setThinkingLevel(currentThinking);
      footer.setThinking(currentThinking);
      tui.requestRender();
    },
  );

  tui.addChild(focusProxy);
  tui.addChild(footer);
  tui.setFocus(focusProxy);

  // Watch for git branch changes
  footer.watchBranch(() => tui.requestRender());

  agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_start') {
      if (event.message.role === 'user') {
        // Queued user message being processed - render it and update queue count
        if (queuedMessages.length > 0) {
          queuedMessages.shift();
          footer.setQueueCount(queuedMessages.length);
          const text = typeof event.message.content === 'string' 
            ? event.message.content 
            : textFromBlocks(event.message.content as Array<{ type: string }>);
          addMessage(new Markdown(chalk.hex(colors.dimmed)('› ') + text, 1, 1, markdownTheme));
          // Add a new loader for the queued message
          loader = new Loader(tui, (s) => chalk.hex(colors.accent)(s), (s) => chalk.hex(colors.dimmed)(s), 'Thinking...');
          addMessage(loader);
          footer.setActivity('thinking', () => tui.requestRender());
          tui.requestRender();
        }
      }
      if (event.message.role === 'assistant') {
        // Move loader below the new assistant message
        if (loader) {
          tui.removeChild(loader);
          loader.setMessage('');
        }
        currentAssistant = new Markdown('', 1, 1, markdownTheme);
        addMessage(currentAssistant);
        if (loader) {
          addMessage(loader);
        }
        tui.requestRender();
      }
    }

    if (event.type === 'message_update') {
      if (event.message.role === 'assistant' && currentAssistant) {
        footer.setActivity('streaming', () => tui.requestRender());
        const text = renderMessage(event.message as Message);
        currentAssistant.setText(text);
        tui.requestRender();
      }
    }

    if (event.type === 'message_end') {
      // Save message to session
      sessionManager.appendMessage(event.message as import('@marvin-agents/agent-core').AppMessage);
      
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
      footer.setActivity('tool', () => tui.requestRender());
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
      // Store full output for toggle
      const fullOutput = getToolText(event.result);
      entry.data.fullOutput = fullOutput;
      const content = toolOutputExpanded 
        ? renderToolWithExpand(entry.data.name, entry.data.args, fullOutput, true)
        : renderTool(entry.data.name, entry.data.args, event.result, event.isError, false);
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
      footer.setActivity('idle');
      
      // Check for retryable error
      const lastMsg = agent.state.messages[agent.state.messages.length - 1];
      const errorMsg = lastMsg?.role === 'assistant' && (lastMsg as AssistantMessage).errorMessage;
      const isRetryable = errorMsg && retryablePattern.test(errorMsg);
      
      if (isRetryable && retryConfig.enabled && retryAttempt < retryConfig.maxRetries) {
        retryAttempt++;
        const delay = retryConfig.baseDelayMs * Math.pow(2, retryAttempt - 1);
        footer.setRetryStatus(`Retrying (${retryAttempt}/${retryConfig.maxRetries}) in ${Math.round(delay/1000)}s... (esc to cancel)`);
        tui.requestRender();
        
        retryAbortController = new AbortController();
        const signal = retryAbortController.signal;
        
        // Abortable sleep then retry
        const sleep = (ms: number) => new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, ms);
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('cancelled'));
          });
        });
        
        sleep(delay).then(() => {
          if (signal.aborted) return;
          footer.setRetryStatus(null);
          retryAbortController = null;
          // Remove the error message and retry
          agent.replaceMessages(agent.state.messages.slice(0, -1));
          loader = new Loader(tui, (s) => chalk.hex(colors.accent)(s), (s) => chalk.hex(colors.dimmed)(s), 'Retrying...');
          addMessage(loader);
          footer.setActivity('thinking', () => tui.requestRender());
          tui.requestRender();
          void agent.continue().catch((err) => {
            removeLoader();
            footer.setActivity('idle');
            addMessage(new Text(chalk.hex(colors.accent)(String(err instanceof Error ? err.message : err))));
            isResponding = false;
            tui.requestRender();
          });
        }).catch(() => {
          // Cancelled by user
          isResponding = false;
          tui.requestRender();
        });
        return; // Keep isResponding true during retry wait
      }
      
      // No retry needed, reset retry state and end
      retryAttempt = 0;
      isResponding = false;
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

    if (line === '/compact' || line.startsWith('/compact ')) {
      if (isResponding) {
        addMessage(new Text(chalk.hex(colors.dimmed)('Cannot compact while responding. Use /abort first.')));
        editor.setText('');
        tui.requestRender();
        return;
      }

      const messages = agent.state.messages;
      if (messages.length < 2) {
        addMessage(new Text(chalk.hex(colors.dimmed)('Nothing to compact (need at least one exchange)')));
        editor.setText('');
        tui.requestRender();
        return;
      }

      const customInstructions = line.startsWith('/compact ') ? line.slice(9).trim() : undefined;
      
      editor.setText('');
      
      // Show compacting status
      loader = new Loader(tui, (s) => chalk.hex(colors.accent)(s), (s) => chalk.hex(colors.dimmed)(s), 'Compacting context...');
      addMessage(loader);
      footer.setActivity('thinking', () => tui.requestRender());
      tui.requestRender();

      void handleCompact(customInstructions).catch((err) => {
        removeLoader();
        footer.setActivity('idle');
        addMessage(new Text(chalk.hex(colors.accent)(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)));
        tui.requestRender();
      });
      return;
    }

    // Normal prompt - queue if already responding
    if (isResponding) {
      queuedMessages.push(line);
      footer.setQueueCount(queuedMessages.length);
      // Queue message for agent to pick up on next turn
      const queuedUserMessage: import('@marvin-agents/agent-core').AppMessage = {
        role: 'user',
        content: [{ type: 'text', text: line }],
        timestamp: Date.now(),
      };
      void agent.queueMessage(queuedUserMessage);
      editor.setText('');
      tui.requestRender();
      return;
    }

    editor.setText('');

    // Ensure session is started on first message
    ensureSession();
    
    // Save user message to session
    const userMessage: import('@marvin-agents/agent-core').AppMessage = {
      role: 'user',
      content: [{ type: 'text', text: line }],
      timestamp: Date.now(),
    };
    sessionManager.appendMessage(userMessage);

    addMessage(new Markdown(chalk.hex(colors.dimmed)('› ') + line, 1, 1, markdownTheme));

    loader = new Loader(tui, (s) => chalk.hex(colors.accent)(s), (s) => chalk.hex(colors.dimmed)(s), 'Thinking...');
    addMessage(loader);

    isResponding = true;
    footer.setActivity('thinking', () => tui.requestRender());
    tui.requestRender();

    void agent.prompt(line).catch((err) => {
      removeLoader();
      footer.setActivity('idle');
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
  
  // Clean up terminal state on Ctrl+C
  process.on('SIGINT', () => exit());
};

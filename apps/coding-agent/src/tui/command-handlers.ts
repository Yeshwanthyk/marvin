import chalk from 'chalk';
import type { Agent, AppMessage, ThinkingLevel } from '@marvin-agents/agent-core';
import { getModels, getProviders } from '@marvin-agents/ai';
import { Loader, Markdown, Text, type TUI, type Component } from '@marvin-agents/tui';
import type { Footer } from './footer.js';
import type { SessionManager } from '../session-manager.js';
import { handleCompact, type CompactOptions } from './compact-handler.js';
import { colors, markdownTheme } from './themes.js';
import { updateAppConfig } from '../config.js';

type KnownProvider = ReturnType<typeof getProviders>[number];

export const resolveProvider = (raw: string): KnownProvider | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const providers = getProviders();
  return providers.includes(trimmed as KnownProvider) ? (trimmed as KnownProvider) : undefined;
};

export const resolveModel = (provider: KnownProvider, raw: string) => {
  const modelId = raw.trim();
  if (!modelId) return undefined;
  return getModels(provider).find((m) => m.id === modelId);
};

export interface CommandContext {
  tui: TUI;
  agent: Agent;
  footer: Footer;
  sessionManager: SessionManager;
  configDir: string;
  configPath?: string;
  getCurrentProvider: () => KnownProvider;
  setCurrentProvider: (p: KnownProvider) => void;
  getCurrentModelId: () => string;
  setCurrentModelId: (id: string) => void;
  getCurrentThinking: () => ThinkingLevel;
  setCurrentThinking: (t: ThinkingLevel) => void;
  getIsResponding: () => boolean;
  setIsResponding: (v: boolean) => void;
  getQueuedMessages: () => string[];
  addMessage: (component: Component) => void;
  removeLoader: () => void;
  setLoader: (l: Loader | undefined) => void;
  clearConversation: () => void;
  abort: () => void;
  exit: () => void;
  ensureSession: () => void;
  getCompactOptions: () => Omit<CompactOptions, 'customInstructions'>;
}

export function handleSlashCommand(line: string, ctx: CommandContext): boolean {
  const {
    tui,
    agent,
    footer,
    sessionManager,
    configDir,
    configPath,
    getCurrentProvider,
    setCurrentProvider,
    getCurrentModelId,
    setCurrentModelId,
    getCurrentThinking,
    setCurrentThinking,
    getIsResponding,
    addMessage,
    removeLoader,
    setLoader,
  } = ctx;

  if (line === '/exit' || line === '/quit') {
    ctx.exit();
    return true;
  }

  if (line === '/clear') {
    ctx.clearConversation();
    return true;
  }

  if (line === '/abort') {
    ctx.abort();
    return true;
  }

  if (line.startsWith('/thinking')) {
    const next = line.slice('/thinking'.length).trim();
    if (next === 'off' || next === 'minimal' || next === 'low' || next === 'medium' || next === 'high' || next === 'xhigh') {
      agent.setThinkingLevel(next);
      setCurrentThinking(next);
      footer.setThinking(next);
      void updateAppConfig({ configDir, configPath }, { thinking: next });
      tui.requestRender();
      return true;
    }
    return false;
  }

  if (line.startsWith('/model')) {
    const rest = line.slice('/model'.length).trim();
    const currentProvider = getCurrentProvider();

    if (!rest) {
      addMessage(new Text(chalk.hex(colors.dimmed)('Usage: /model <provider> <modelId> (or /model <modelId>). Tip: use Tab completion.')));
      tui.requestRender();
      return true;
    }

    if (getIsResponding()) {
      addMessage(new Text(chalk.hex(colors.dimmed)('Model cannot be changed while responding. Use /abort first.')));
      tui.requestRender();
      return true;
    }

    const parts = rest.split(/\s+/);
    if (parts.length === 1) {
      const token = parts[0] ?? '';
      const provider = resolveProvider(token);
      if (provider) {
        const examples = getModels(provider).slice(0, 8).map((m) => m.id).join(', ');
        addMessage(new Text(chalk.hex(colors.dimmed)(`Pick a model: /model ${provider} <modelId>. Examples: ${examples}`)));
        tui.requestRender();
        return true;
      }

      const model = resolveModel(currentProvider, token);
      if (!model) {
        const examples = getModels(currentProvider).slice(0, 8).map((m) => m.id).join(', ');
        addMessage(new Text(chalk.hex(colors.accent)(`Unknown model "${token}" for provider ${currentProvider}. Examples: ${examples}`)));
        tui.requestRender();
        return true;
      }

      agent.setModel(model);
      setCurrentModelId(model.id);
      footer.setModel(model.id, model.contextWindow);
      void updateAppConfig({ configDir, configPath }, { provider: currentProvider, model: model.id });
      addMessage(new Text(chalk.hex(colors.dimmed)(`Switched model to ${currentProvider} ${model.id}`)));
      tui.requestRender();
      return true;
    }

    const [providerRaw, ...modelParts] = parts;
    const modelId = modelParts.join(' ').trim();
    const provider = resolveProvider(providerRaw ?? '');
    if (!provider) {
      addMessage(new Text(chalk.hex(colors.accent)(`Unknown provider "${providerRaw}". Known: ${getProviders().join(', ')}`)));
      tui.requestRender();
      return true;
    }

    const model = resolveModel(provider, modelId);
    if (!model) {
      const examples = getModels(provider).slice(0, 8).map((m) => m.id).join(', ');
      addMessage(new Text(chalk.hex(colors.accent)(`Unknown model "${modelId}" for provider ${provider}. Examples: ${examples}`)));
      tui.requestRender();
      return true;
    }

    agent.setModel(model);
    setCurrentProvider(provider);
    setCurrentModelId(model.id);
    footer.setModel(model.id, model.contextWindow);
    void updateAppConfig({ configDir, configPath }, { provider, model: model.id });
    addMessage(new Text(chalk.hex(colors.dimmed)(`Switched model to ${provider} ${model.id}`)));
    tui.requestRender();
    return true;
  }

  if (line === '/compact' || line.startsWith('/compact ')) {
    if (getIsResponding()) {
      addMessage(new Text(chalk.hex(colors.dimmed)('Cannot compact while responding. Use /abort first.')));
      tui.requestRender();
      return true;
    }

    const messages = agent.state.messages;
    if (messages.length < 2) {
      addMessage(new Text(chalk.hex(colors.dimmed)('Nothing to compact (need at least one exchange)')));
      tui.requestRender();
      return true;
    }

    const customInstructions = line.startsWith('/compact ') ? line.slice(9).trim() : undefined;

    const loader = new Loader(tui, (s) => chalk.hex(colors.accent)(s), (s) => chalk.hex(colors.dimmed)(s), 'Compacting context...');
    addMessage(loader);
    setLoader(loader);
    footer.setActivity('thinking', () => tui.requestRender());
    tui.requestRender();

    void handleCompact({ ...ctx.getCompactOptions(), customInstructions })
      .then(({ summary, summaryMessage }) => {
        removeLoader();
        addMessage(new Text(chalk.hex(colors.dimmed)('─'.repeat(40))));
        addMessage(new Text(chalk.hex(colors.dimmed)('Context compacted. Summary:')));
        addMessage(new Markdown(summary, 1, 1, markdownTheme));
        addMessage(new Text(chalk.hex(colors.dimmed)('─'.repeat(40))));

        agent.reset();
        agent.replaceMessages([summaryMessage]);
        footer.reset();
        footer.setQueueCount(0);
        ctx.getQueuedMessages().length = 0;

        ctx.ensureSession();
        sessionManager.appendMessage(summaryMessage);
        addMessage(new Text(chalk.hex(colors.dimmed)('New session started with compacted context')));
        tui.requestRender();
      })
      .catch((err) => {
        removeLoader();
        footer.setActivity('idle');
        addMessage(new Text(chalk.hex(colors.accent)(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)));
        tui.requestRender();
      });

    return true;
  }

  return false;
}

import { Agent, ProviderTransport, RouterTransport, CodexTransport, loadTokens, saveTokens, clearTokens } from '@marvin-agents/agent-core';
import { getApiKey, getModels, getProviders } from '@marvin-agents/ai';
import {
  CombinedAutocompleteProvider,
  Editor,
  Loader,
  Markdown,
  ProcessTerminal,
  Text,
  TUI,
  type Component,
} from '@marvin-agents/tui';
import chalk from 'chalk';
import { codingTools } from '@marvin-agents/base-tools';
import type { ThinkingLevel, AppMessage } from '@marvin-agents/agent-core';
import { loadAppConfig, updateAppConfig } from './config.js';
import { SessionManager } from './session-manager.js';
import {
  colors,
  markdownTheme,
  editorTheme,
  Footer,
  FocusProxy,
  textFromBlocks,
  renderToolWithExpand,
  createAutocompleteCommands,
  createAgentEventHandler,
  handleSlashCommand,
  handleContinueSession,
  handleResumeSession,
  resolveProvider,
  resolveModel,
  type ToolBlockEntry,
} from './tui/index.js';

type KnownProvider = ReturnType<typeof getProviders>[number];

export const runTui = async (args?: {
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  continueSession?: boolean;
  resumeSession?: boolean;
}) => {
  // ─────────────────────────────────────────────────────────────────
  // Config & Setup
  // ─────────────────────────────────────────────────────────────────
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

  let currentProvider: KnownProvider = loaded.provider;
  let currentModelId = loaded.modelId;
  let currentThinking = loaded.thinking;

  // ─────────────────────────────────────────────────────────────────
  // UI Components
  // ─────────────────────────────────────────────────────────────────
  const header = new Text(chalk.hex(colors.dimmed)('marvin'), 1, 0);
  tui.addChild(header);

  const footer = new Footer(currentModelId, currentThinking, loaded.model.contextWindow);
  const editor = new Editor(editorTheme);

  const autocomplete = new CombinedAutocompleteProvider(
    createAutocompleteCommands(() => ({ currentProvider })),
    process.cwd(),
  );
  editor.setAutocompleteProvider(autocomplete);

  // ─────────────────────────────────────────────────────────────────
  // Model Cycling
  // ─────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ModelEntry = { provider: KnownProvider; model: import('@marvin-agents/ai').Model<any> };
  const cycleModels: ModelEntry[] = [];
  const modelIds = args?.model?.split(',').map(s => s.trim()).filter(Boolean) || [currentModelId];
  
  for (const id of modelIds) {
    if (id.includes('/')) {
      const [provStr, modelStr] = id.split('/');
      const prov = resolveProvider(provStr!);
      if (!prov) continue;
      const model = resolveModel(prov, modelStr!);
      if (model) cycleModels.push({ provider: prov, model });
    } else {
      for (const prov of getProviders()) {
        const model = resolveModel(prov as KnownProvider, id);
        if (model) {
          cycleModels.push({ provider: prov as KnownProvider, model });
          break;
        }
      }
    }
  }
  if (cycleModels.length === 0) {
    cycleModels.push({ provider: currentProvider, model: loaded.model });
  }
  let cycleIndex = 0;

  const thinkingLevels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

  // ─────────────────────────────────────────────────────────────────
  // Transport & Agent
  // ─────────────────────────────────────────────────────────────────
  const getApiKeyForProvider = (provider: string): string | undefined => {
    if (provider === 'anthropic') {
      return process.env.ANTHROPIC_OAUTH_TOKEN || getApiKey(provider);
    }
    return getApiKey(provider);
  };

  const providerTransport = new ProviderTransport({ getApiKey: getApiKeyForProvider });
  const codexTransport = new CodexTransport({
    getTokens: async () => loadTokens({ configDir: loaded.configDir }),
    setTokens: async (tokens) => saveTokens(tokens, { configDir: loaded.configDir }),
    clearTokens: async () => clearTokens({ configDir: loaded.configDir }),
  });

  const transport = new RouterTransport({ provider: providerTransport, codex: codexTransport });
  const agent = new Agent({
    transport,
    initialState: {
      systemPrompt: loaded.systemPrompt,
      model: loaded.model,
      thinkingLevel: loaded.thinking,
      tools: codingTools,
    },
  });

  // ─────────────────────────────────────────────────────────────────
  // Session Management
  // ─────────────────────────────────────────────────────────────────
  const sessionManager = new SessionManager(loaded.configDir);
  let sessionStarted = false;

  const ensureSession = () => {
    if (!sessionStarted) {
      sessionManager.startSession(currentProvider, currentModelId, currentThinking);
      sessionStarted = true;
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────
  let isResponding = false;
  let currentAssistant: Markdown | undefined;
  const toolBlocks = new Map<string, ToolBlockEntry>();
  let loader: Loader | undefined;
  let lastCtrlC = 0;
  const queuedMessages: string[] = [];
  let toolOutputExpanded = false;

  const retryConfig = { enabled: true, maxRetries: 3, baseDelayMs: 2000 };
  const retryablePattern = /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error/i;
  const retryState = { attempt: 0, abortController: null as AbortController | null };

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────
  const removeLoader = () => {
    if (!loader) return;
    tui.removeChild(loader);
    loader = undefined;
  };

  const addMessage = (component: Component) => {
    const idx = Math.max(0, tui.children.length - 2);
    tui.children.splice(idx, 0, component);
  };

  const clearConversation = () => {
    tui.children.splice(1, tui.children.length - 3);
    currentAssistant = undefined;
    toolBlocks.clear();
    footer.reset();
    footer.setQueueCount(0);
    footer.setRetryStatus(null);
    queuedMessages.length = 0;
    retryState.attempt = 0;
    agent.reset();
    tui.requestRender();
  };

  const abort = () => {
    agent.abort();
    agent.clearMessageQueue();
    tui.requestRender();
  };

  const exit = () => {
    tui.stop();
    process.stdout.write('\n');
    process.exit(0);
  };

  const rerenderToolBlocks = () => {
    for (const [, entry] of toolBlocks) {
      if (entry.data.fullOutput !== undefined) {
        const content = renderToolWithExpand(entry.data.name, entry.data.args, entry.data.fullOutput, toolOutputExpanded);
        entry.component.setText(content);
      }
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // Keybindings
  // ─────────────────────────────────────────────────────────────────
  const focusProxy = new FocusProxy(editor, {
    onCtrlC: () => {
      const now = Date.now();
      if (now - lastCtrlC < 750) {
        exit();
        return;
      }
      lastCtrlC = now;
      editor.setText('');
      tui.requestRender();
    },
    onEscape: () => {
      if (retryState.abortController) {
        retryState.abortController.abort();
        retryState.abortController = null;
        retryState.attempt = 0;
        footer.setRetryStatus(null);
        tui.requestRender();
        return true;
      }
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
    onCtrlO: () => {
      toolOutputExpanded = !toolOutputExpanded;
      rerenderToolBlocks();
      tui.requestRender();
    },
    onCtrlP: () => {
      if (cycleModels.length <= 1) return;
      cycleIndex = (cycleIndex + 1) % cycleModels.length;
      const entry = cycleModels[cycleIndex]!;
      currentProvider = entry.provider;
      currentModelId = entry.model.id;
      agent.setModel(entry.model);
      footer.setModel(entry.model.id, entry.model.contextWindow);
      tui.requestRender();
    },
    onShiftTab: () => {
      const idx = thinkingLevels.indexOf(currentThinking);
      const nextIdx = (idx + 1) % thinkingLevels.length;
      currentThinking = thinkingLevels[nextIdx]!;
      agent.setThinkingLevel(currentThinking);
      footer.setThinking(currentThinking);
      tui.requestRender();
    },
  });

  tui.addChild(focusProxy);
  tui.addChild(footer);
  tui.setFocus(focusProxy);
  footer.watchBranch(() => tui.requestRender());

  // ─────────────────────────────────────────────────────────────────
  // Agent Events
  // ─────────────────────────────────────────────────────────────────
  agent.subscribe(
    createAgentEventHandler(
      {
        tui,
        agent,
        footer,
        sessionManager,
        toolBlocks,
        getCurrentAssistant: () => currentAssistant,
        setCurrentAssistant: (md) => { currentAssistant = md; },
        getLoader: () => loader,
        setLoader: (l) => { loader = l; },
        removeLoader,
        addMessage,
        getToolOutputExpanded: () => toolOutputExpanded,
        setIsResponding: (v) => { isResponding = v; },
        getQueuedMessages: () => queuedMessages,
      },
      retryConfig,
      retryState,
      retryablePattern,
    ),
  );

  // ─────────────────────────────────────────────────────────────────
  // Command Context
  // ─────────────────────────────────────────────────────────────────
  const commandContext = {
    tui,
    agent,
    footer,
    sessionManager,
    configDir: loaded.configDir,
    configPath: loaded.configPath,
    getCurrentProvider: () => currentProvider,
    setCurrentProvider: (p: KnownProvider) => { currentProvider = p; },
    getCurrentModelId: () => currentModelId,
    setCurrentModelId: (id: string) => { currentModelId = id; },
    getCurrentThinking: () => currentThinking,
    setCurrentThinking: (t: ThinkingLevel) => { currentThinking = t; },
    getIsResponding: () => isResponding,
    setIsResponding: (v: boolean) => { isResponding = v; },
    getQueuedMessages: () => queuedMessages,
    addMessage,
    removeLoader,
    setLoader: (l: Loader | undefined) => { loader = l; },
    clearConversation,
    abort,
    exit,
    ensureSession,
    getCompactOptions: () => ({
      agent,
      currentProvider,
      getApiKey: getApiKeyForProvider,
      codexTransport,
    }),
  };

  // ─────────────────────────────────────────────────────────────────
  // Editor Submit
  // ─────────────────────────────────────────────────────────────────
  editor.onSubmit = (value: string) => {
    const line = value.trim();
    if (!line) return;

    // Try slash commands first
    if (line.startsWith('/')) {
      if (handleSlashCommand(line, commandContext)) {
        editor.setText('');
        return;
      }
    }

    // Queue if already responding
    if (isResponding) {
      queuedMessages.push(line);
      footer.setQueueCount(queuedMessages.length);
      const queuedUserMessage: AppMessage = {
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
    ensureSession();

    const userMessage: AppMessage = {
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

  // ─────────────────────────────────────────────────────────────────
  // Session Restore
  // ─────────────────────────────────────────────────────────────────
  const sessionRestoreCtx = {
    tui,
    agent,
    footer,
    sessionManager,
    setCurrentProvider: (p: string) => { currentProvider = p as KnownProvider; },
    setCurrentModelId: (id: string) => { currentModelId = id; },
    setCurrentThinking: (t: ThinkingLevel) => { currentThinking = t; },
    addMessage,
    setSessionStarted: (v: boolean) => { sessionStarted = v; },
  };

  if (args?.continueSession) {
    handleContinueSession(sessionManager, sessionRestoreCtx);
  }
  if (args?.resumeSession) {
    handleResumeSession(sessionManager, sessionRestoreCtx);
  }

  // ─────────────────────────────────────────────────────────────────
  // Start
  // ─────────────────────────────────────────────────────────────────
  tui.start();
  process.on('SIGINT', () => exit());
};

import chalk from 'chalk';
import type { AgentEvent, Agent, AppMessage } from '@marvin-agents/agent-core';
import type { AssistantMessage, Message } from '@marvin-agents/ai';
import { Markdown, Text, type TUI } from '@marvin-agents/tui';
import type { Footer } from './footer.js';
import type { SessionManager } from '../session-manager.js';
import {
  colors,
  markdownTheme,
  textFromBlocks,
  renderMessage,
  getToolText,
  renderTool,
  renderToolWithExpand,
} from './index.js';

export interface ToolBlockEntry {
  component: Text;
  data: { name: string; args: unknown; fullOutput?: string };
}

export interface AgentEventHandlerState {
  tui: TUI;
  agent: Agent;
  footer: Footer;
  sessionManager: SessionManager;
  toolBlocks: Map<string, ToolBlockEntry>;
  getCurrentAssistant: () => Markdown | undefined;
  setCurrentAssistant: (md: Markdown | undefined) => void;
  removeLoader: () => void;
  addMessage: (component: Text | Markdown) => void;
  getToolOutputExpanded: () => boolean;
  setIsResponding: (v: boolean) => void;
  getQueuedMessages: () => string[];
}

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
}

export interface RetryState {
  attempt: number;
  abortController: AbortController | null;
}

export function createAgentEventHandler(
  state: AgentEventHandlerState,
  retryConfig: RetryConfig,
  retryState: RetryState,
  retryablePattern: RegExp,
) {
  const {
    tui,
    agent,
    footer,
    sessionManager,
    toolBlocks,
    getCurrentAssistant,
    setCurrentAssistant,
    removeLoader,
    addMessage,
    getToolOutputExpanded,
    setIsResponding,
    getQueuedMessages,
  } = state;

  return (event: AgentEvent) => {
    if (event.type === 'message_start') {
      if (event.message.role === 'user') {
        // Queued user message being processed
        const queuedMessages = getQueuedMessages();
        if (queuedMessages.length > 0) {
          queuedMessages.shift();
          footer.setQueueCount(queuedMessages.length);
          const text = typeof event.message.content === 'string'
            ? event.message.content
            : textFromBlocks(event.message.content as Array<{ type: string }>);
          addMessage(new Markdown(chalk.hex(colors.dimmed)('› ') + text, 1, 1, markdownTheme));
          footer.setActivity('thinking', () => tui.requestRender());
          tui.requestRender();
        }
      }
      if (event.message.role === 'assistant') {
        const assistant = new Markdown('', 1, 1, markdownTheme);
        setCurrentAssistant(assistant);
        addMessage(assistant);
        tui.requestRender();
      }
    }

    if (event.type === 'message_update') {
      const currentAssistant = getCurrentAssistant();
      if (event.message.role === 'assistant' && currentAssistant) {
        footer.setActivity('streaming', () => tui.requestRender());
        const text = renderMessage(event.message as Message);
        currentAssistant.setText(text);
        tui.requestRender();
      }
    }

    if (event.type === 'message_end') {
      sessionManager.appendMessage(event.message as AppMessage);
      const currentAssistant = getCurrentAssistant();
      if (event.message.role === 'assistant' && currentAssistant) {
        currentAssistant.setText(renderMessage(event.message as Message));
        setCurrentAssistant(undefined);
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
      const fullOutput = getToolText(event.result);
      entry.data.fullOutput = fullOutput;
      const content = getToolOutputExpanded()
        ? renderToolWithExpand(entry.data.name, entry.data.args, fullOutput, true)
        : renderTool(entry.data.name, entry.data.args, event.result, event.isError, false);
      const bgColor = event.isError ? colors.toolError : colors.toolSuccess;
      entry.component.setCustomBgFn((text: string) => chalk.bgHex(bgColor)(text));
      entry.component.setText(content);
      tui.requestRender();
    }

    if (event.type === 'turn_end') {
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

      if (isRetryable && retryConfig.enabled && retryState.attempt < retryConfig.maxRetries) {
        retryState.attempt++;
        const delay = retryConfig.baseDelayMs * Math.pow(2, retryState.attempt - 1);
        footer.setRetryStatus(`Retrying (${retryState.attempt}/${retryConfig.maxRetries}) in ${Math.round(delay / 1000)}s... (esc to cancel)`);
        tui.requestRender();

        retryState.abortController = new AbortController();
        const signal = retryState.abortController.signal;

        const sleep = (ms: number) =>
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(resolve, ms);
            signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new Error('cancelled'));
            });
          });

        sleep(delay)
          .then(() => {
            if (signal.aborted) return;
            footer.setRetryStatus(null);
            retryState.abortController = null;
            agent.replaceMessages(agent.state.messages.slice(0, -1));
            footer.setActivity('thinking', () => tui.requestRender());
            tui.requestRender();
            void agent.continue().catch((err) => {
              footer.setActivity('idle');
              addMessage(new Text(chalk.hex(colors.accent)(String(err instanceof Error ? err.message : err))));
              setIsResponding(false);
              tui.requestRender();
            });
          })
          .catch(() => {
            setIsResponding(false);
            tui.requestRender();
          });
        return;
      }

      retryState.attempt = 0;
      setIsResponding(false);
      tui.requestRender();
    }
  };
}

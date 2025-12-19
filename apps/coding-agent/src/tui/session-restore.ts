import chalk from 'chalk';
import type { Agent, ThinkingLevel } from '@marvin-agents/agent-core';
import type { AssistantMessage, Message } from '@marvin-agents/ai';
import { Markdown, Text, type TUI, type Component } from '@marvin-agents/tui';
import type { Footer } from './footer.js';
import type { SessionManager, LoadedSession } from '../session-manager.js';
import { resolveProvider, resolveModel } from './command-handlers.js';
import { colors, markdownTheme, textFromBlocks, renderMessage } from './index.js';

export interface SessionRestoreContext {
  tui: TUI;
  agent: Agent;
  footer: Footer;
  sessionManager: SessionManager;
  setCurrentProvider: (p: string) => void;
  setCurrentModelId: (id: string) => void;
  setCurrentThinking: (t: ThinkingLevel) => void;
  addMessage: (component: Component) => void;
  setSessionStarted: (v: boolean) => void;
}

export function restoreSession(session: LoadedSession, ctx: SessionRestoreContext) {
  const { metadata, messages } = session;
  const {
    agent,
    footer,
    sessionManager,
    setCurrentProvider,
    setCurrentModelId,
    setCurrentThinking,
    addMessage,
    setSessionStarted,
  } = ctx;

  // Update provider/model/thinking if different
  const resolvedProvider = resolveProvider(metadata.provider);
  if (resolvedProvider) {
    const resolvedModel = resolveModel(resolvedProvider, metadata.modelId);
    if (resolvedModel) {
      setCurrentProvider(resolvedProvider);
      setCurrentModelId(resolvedModel.id);
      setCurrentThinking(metadata.thinkingLevel);
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
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : textFromBlocks(msg.content as Array<{ type: string }>);
      addMessage(new Markdown(chalk.hex(colors.dimmed)('› ') + text, 1, 1, markdownTheme));
    } else if (msg.role === 'assistant') {
      const text = renderMessage(msg as Message);
      if (text.trim()) {
        addMessage(new Markdown(text, 1, 1, markdownTheme));
      }
      const assistantMsg = msg as AssistantMessage;
      if (assistantMsg.usage) {
        footer.addUsage(assistantMsg);
      }
    }
  }

  // Continue the existing session file
  const sessionPath = sessionManager.listSessions().find((s) => s.id === metadata.id)?.path || '';
  sessionManager.continueSession(sessionPath, metadata.id);
  setSessionStarted(true);

  addMessage(new Text(chalk.hex(colors.dimmed)(`Session restored (${messages.length} messages)`)));
}

export function handleContinueSession(sessionManager: SessionManager, ctx: SessionRestoreContext) {
  const session = sessionManager.loadLatest();
  if (session) {
    restoreSession(session, ctx);
  } else {
    ctx.addMessage(new Text(chalk.hex(colors.dimmed)('No session found for this directory')));
  }
}

export function handleResumeSession(sessionManager: SessionManager, ctx: SessionRestoreContext) {
  const sessions = sessionManager.listSessions();
  if (sessions.length === 0) {
    ctx.addMessage(new Text(chalk.hex(colors.dimmed)('No sessions found for this directory')));
    return;
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (sessions.length === 1) {
    const session = sessionManager.loadSession(sessions[0]!.path);
    if (session) restoreSession(session, ctx);
    return;
  }

  // Show available sessions and load most recent
  ctx.addMessage(new Text(chalk.hex(colors.dimmed)(`Found ${sessions.length} sessions:`)));
  for (const s of sessions.slice(0, 5)) {
    ctx.addMessage(new Text(chalk.hex(colors.dimmed)(`  ${formatDate(s.timestamp)} · ${s.provider}/${s.modelId}`)));
  }
  if (sessions.length > 5) {
    ctx.addMessage(new Text(chalk.hex(colors.dimmed)(`  ... and ${sessions.length - 5} more`)));
  }
  ctx.addMessage(new Text(chalk.hex(colors.dimmed)('Loading most recent session...')));
  const session = sessionManager.loadSession(sessions[0]!.path);
  if (session) restoreSession(session, ctx);
}

import { ProcessTerminal, SelectList, Text, TUI, type SelectListTheme } from '@marvin-agents/tui';
import chalk from 'chalk';
import type { SessionManager } from '../session-manager.js';
import { colors } from './themes.js';

const pickerTheme: SelectListTheme = {
  selectedPrefix: (t) => chalk.cyan(t),
  selectedText: (t) => chalk.bold(t),
  description: (t) => chalk.dim(t),
  scrollInfo: (t) => chalk.dim(t),
  noMatch: (t) => chalk.dim(t),
};

export async function selectSession(sessionManager: SessionManager): Promise<string | null> {
  const sessions = sessionManager.loadAllSessions();
  if (sessions.length === 0) return null;
  if (sessions.length === 1) return sessions[0]!.path;

  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TUI(terminal);
    let resolved = false;

    const items = sessions.map((s) => ({
      value: s.path,
      label: formatFirstMessage(s.firstMessage),
      description: formatMeta(s.timestamp, s.messageCount, s.modelId),
    }));

    const header = new Text(chalk.hex(colors.dimmed)('Resume Session\n'), 1, 0);
    const list = new SelectList(items, 8, pickerTheme);

    list.onSelect = (item) => {
      if (!resolved) {
        resolved = true;
        tui.stop();
        resolve(item.value);
      }
    };

    list.onCancel = () => {
      if (!resolved) {
        resolved = true;
        tui.stop();
        resolve(null);
      }
    };

    tui.addChild(header);
    tui.addChild(list);
    tui.setFocus(list);
    tui.start();
  });
}

function formatFirstMessage(msg: string): string {
  return msg.replace(/\n/g, ' ').slice(0, 60);
}

function formatMeta(ts: number, count: number, model: string): string {
  const ago = formatRelativeTime(ts);
  return `${ago} · ${count} msgs · ${model}`;
}

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

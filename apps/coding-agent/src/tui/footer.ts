import chalk from 'chalk';
import { existsSync, readFileSync, watch, type FSWatcher } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import type { Component } from '@marvin-agents/tui';
import type { AssistantMessage } from '@marvin-agents/ai';
import type { ThinkingLevel } from '@marvin-agents/agent-core';
import { colors } from './themes.js';

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
    const result = spawnSync('git', ['diff', '--shortstat'], { cwd: process.cwd(), encoding: 'utf8' });
    const output = (result.stdout || '').trim();
    if (!output) return { files: 0, ins: 0, del: 0 };
    const files = output.match(/(\d+) files? changed/)?.[1] ?? '0';
    const ins = output.match(/(\d+) insertions?/)?.[1] ?? '0';
    const del = output.match(/(\d+) deletions?/)?.[1] ?? '0';
    return { files: +files, ins: +ins, del: +del };
  } catch {
    return null;
  }
}

export type ActivityState = 'idle' | 'thinking' | 'streaming' | 'tool' | 'waiting';

export class Footer implements Component {
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
  private activityState: ActivityState = 'idle';
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
  
  setActivity(state: ActivityState, onTick?: () => void) {
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

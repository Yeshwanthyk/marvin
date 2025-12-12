import type { AgentUsage } from '@mu-agents/types';
import * as path from 'node:path';
import type { RenderContext, RenderResult, Style, Widget } from '../core/types';
import { textSpan } from '../core/types';
import { truncateToWidth, visibleWidth } from '../core/width';
import { fillLine } from './format';

export interface FooterBarState {
  cwd: string;
  branch?: string;
  usage?: AgentUsage;
  selectedModel?: string;
  agentState?: string;
}

export class FooterBarModel {
  readonly state: FooterBarState;

  constructor(initial: { cwd: string; branch?: string; selectedModel?: string }) {
    this.state = { cwd: initial.cwd, branch: initial.branch, selectedModel: initial.selectedModel };
  }

  setCwd(cwd: string): void {
    this.state.cwd = cwd;
  }

  setBranch(branch: string | undefined): void {
    this.state.branch = branch;
  }

  setSelectedModel(model: string | undefined): void {
    this.state.selectedModel = model;
  }

  ingestEvent(event: unknown): void {
    if (
      typeof event === 'object' &&
      event !== null &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (event as any).type === 'provider' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (event as any).event?.type === 'usage'
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.state.usage = (event as any).event.usage as AgentUsage;
      return;
    }
    if (
      typeof event === 'object' &&
      event !== null &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (event as any).type === 'state'
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.state.agentState = (event as any).state as string;
    }
  }
}

export interface FooterBarProps {
  model: FooterBarModel;
  style?: Style;
  dimStyle?: Style;
}

const formatTokensCompact = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
};

const estimateContextWindowTokens = (model: string): number | undefined => {
  const m = model.toLowerCase();
  if (m.startsWith('claude-')) return 200_000;
  if (m.startsWith('gpt-4o')) return 128_000;
  if (m.startsWith('gpt-4.1')) return 128_000;
  if (m.startsWith('o1') || m.startsWith('o3')) return 200_000;
  if (m.startsWith('gpt-5')) return 200_000;
  if (m.includes('codex')) return 200_000;
  return undefined;
};

const formatCost = (usage?: AgentUsage): string => {
  if (!usage?.cost) return '';
  const { currency, value } = usage.cost;
  if (currency.toUpperCase() === 'USD') return `$${value.toFixed(3)}`;
  return `${currency.toUpperCase()} ${value.toFixed(3)}`;
};

const formatContextPercent = (usage?: AgentUsage, modelHint?: string): string => {
  const model = usage?.model ?? modelHint;
  if (!usage || !model) return 'ctx --';
  const window = estimateContextWindowTokens(model);
  if (!window) return 'ctx --';
  const pct = (usage.tokens.totalTokens / window) * 100;
  return `ctx ${pct.toFixed(1)}%`;
};

const formatPathWithTilde = (cwd: string): string => {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
  return cwd;
};

const truncateMiddle = (text: string, max: number): string => {
  if (max <= 0) return '';
  if (visibleWidth(text) <= max) return text;
  if (max <= 3) return '.'.repeat(max);
  const keep = Math.floor((max - 3) / 2);
  const start = text.slice(0, keep);
  const end = text.slice(text.length - keep);
  return `${start}...${end}`;
};

export class FooterBar implements Widget {
  private readonly props: FooterBarProps;
  constructor(props: FooterBarProps) {
    this.props = props;
  }

  render(ctx: RenderContext): RenderResult {
    const { cwd, branch, usage, selectedModel } = this.props.model.state;
    const base = this.props.style;
    const dim = { ...(base ?? {}), ...(this.props.dimStyle ?? {}), dim: true };

    const pwd = branch ? `${formatPathWithTilde(cwd)} (${branch})` : formatPathWithTilde(cwd);
    const pwdLine = fillLine(truncateMiddle(pwd, ctx.width), ctx.width, dim);

    const tokens = usage ? `tok ${formatTokensCompact(usage.tokens.totalTokens)}` : 'tok --';
    const cost = formatCost(usage);
    const tokensCost = cost ? `${tokens} ${cost}` : tokens;
    const ctxPct = formatContextPercent(usage, selectedModel);
    const modelName = selectedModel ?? usage?.model ?? '';
    const modelPart = modelName ? `model ${modelName}` : 'model --';

    const line2Text = `${tokensCost} | ${ctxPct} | ${modelPart}`;
    const clipped2 = truncateToWidth(line2Text, ctx.width);
    const line2: RenderResult['lines'][number] = [textSpan(clipped2, dim)];
    const line2Filled = visibleWidth(clipped2) < ctx.width ? fillLine(clipped2, ctx.width, dim) : line2;

    const lines = [pwdLine, line2Filled].slice(0, Math.max(0, ctx.height));
    while (lines.length < ctx.height) {
      lines.push(fillLine('', ctx.width, base));
    }

    return { lines };
  }
}


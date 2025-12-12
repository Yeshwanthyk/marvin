import type { AgentUsage } from '@mu-agents/types';
import * as path from 'node:path';
import type { RenderContext, RenderResult, Style, Widget } from '../core/types';
import { textSpan } from '../core/types';
import { truncateToWidth, visibleWidth } from '../core/width';
import { fillLine } from './format';

export interface StatusBarState {
  cwd: string;
  branch?: string;
  usage?: AgentUsage;
  agentState?: string;
}

export class StatusBarModel {
  readonly state: StatusBarState;

  constructor(initial: { cwd: string; branch?: string }) {
    this.state = { cwd: initial.cwd, branch: initial.branch };
  }

  setCwd(cwd: string): void {
    this.state.cwd = cwd;
  }

  setBranch(branch: string | undefined): void {
    this.state.branch = branch;
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

export interface StatusBarProps {
  model: StatusBarModel;
  style?: Style;
  leftStyle?: Style;
  rightStyle?: Style;
}

const formatCwd = (cwd: string): string => {
  const base = path.basename(cwd);
  return base.length ? base : cwd;
};

const formatUsage = (usage?: AgentUsage): string => {
  if (!usage) return '';
  const t = usage.tokens;
  const cost = usage.cost ? ` ${usage.cost.currency.toUpperCase()} ${usage.cost.value.toFixed(4)}` : '';
  return `tok ${t.totalTokens}${cost}`;
};

export class StatusBar implements Widget {
  private readonly props: StatusBarProps;
  constructor(props: StatusBarProps) {
    this.props = props;
  }

  render(ctx: RenderContext): RenderResult {
    const { cwd, branch, usage } = this.props.model.state;
    const leftText = branch ? `${formatCwd(cwd)} @ ${branch}` : formatCwd(cwd);
    const rightText = formatUsage(usage);

    const base = this.props.style;
    const leftStyle = { ...(base ?? {}), ...(this.props.leftStyle ?? {}) };
    const rightStyle = { ...(base ?? {}), ...(this.props.rightStyle ?? {}) };

    const sep = rightText ? '  ' : '';
    const rightW = visibleWidth(rightText);
    const leftMax = Math.max(0, ctx.width - rightW - visibleWidth(sep));
    const leftClipped = truncateToWidth(leftText, leftMax);
    const middleSpaces = Math.max(0, ctx.width - visibleWidth(leftClipped) - visibleWidth(sep) - rightW);

    const line: RenderResult['lines'][number] = [
      textSpan(leftClipped, leftStyle),
      textSpan(' '.repeat(middleSpaces) + sep, base),
      textSpan(rightText, rightStyle),
    ];

    // Ensure full-width fill even when empty.
    if (!rightText && visibleWidth(leftClipped) < ctx.width) {
      return { lines: [fillLine(leftClipped, ctx.width, base)] };
    }
    return { lines: [line] };
  }
}

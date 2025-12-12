import type { RenderContext, RenderResult, Style, Widget } from '../core/types';
import { textSpan } from '../core/types';
import { truncateToWidth, visibleWidth } from '../core/width';
import { fillLine } from './format';

export interface HeaderBarState {
  appName: string;
  version?: string;
  shortcuts?: string;
  contextFiles?: string[];
}

export class HeaderBarModel {
  readonly state: HeaderBarState;

  constructor(initial: HeaderBarState) {
    this.state = { ...initial };
  }

  setContextFiles(files: string[]): void {
    this.state.contextFiles = files;
  }

  setShortcuts(shortcuts: string): void {
    this.state.shortcuts = shortcuts;
  }
}

export interface HeaderBarProps {
  model: HeaderBarModel;
  style?: Style;
  titleStyle?: Style;
  metaStyle?: Style;
}

const formatTitle = (name: string, version?: string): string => (version ? `${name} v${version}` : name);

const formatContext = (files?: string[]): string => {
  const list = files?.filter(Boolean) ?? [];
  if (!list.length) return 'ctx: none';
  const joined = list.join(', ');
  return `ctx: ${joined}`;
};

export class HeaderBar implements Widget {
  private readonly props: HeaderBarProps;
  constructor(props: HeaderBarProps) {
    this.props = props;
  }

  render(ctx: RenderContext): RenderResult {
    const { appName, version, shortcuts, contextFiles } = this.props.model.state;
    const base = this.props.style;
    const titleStyle = { ...(base ?? {}), ...(this.props.titleStyle ?? {}) };
    const metaStyle = { ...(base ?? {}), ...(this.props.metaStyle ?? {}) };

    const title = formatTitle(appName, version);
    const right = shortcuts ?? '';
    const sep = right ? '  ' : '';
    const rightW = visibleWidth(right);
    const leftMax = Math.max(0, ctx.width - rightW - visibleWidth(sep));
    const leftClipped = truncateToWidth(title, leftMax);
    const middleSpaces = Math.max(0, ctx.width - visibleWidth(leftClipped) - visibleWidth(sep) - rightW);

    const line1: RenderResult['lines'][number] = [
      textSpan(leftClipped, titleStyle),
      textSpan(' '.repeat(middleSpaces) + sep, base),
      textSpan(right, metaStyle),
    ];

    const ctxText = truncateToWidth(formatContext(contextFiles), ctx.width);
    const line2 = fillLine(ctxText, ctx.width, metaStyle);

    const lines = [line1, line2].slice(0, Math.max(0, ctx.height));
    while (lines.length < ctx.height) {
      lines.push(fillLine('', ctx.width, base));
    }
    return { lines };
  }
}


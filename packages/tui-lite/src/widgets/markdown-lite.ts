import type { Line, RenderContext, RenderResult, Span, Style, Widget } from '../core/types';
import { textSpan } from '../core/types';
import { hardWrapSpans } from './format';

export interface MarkdownLiteProps {
  markdown: string;
  baseStyle?: Style;
}

const parseInline = (input: string, baseStyle?: Style): Span[] => {
  const spans: Span[] = [];
  let i = 0;

  const push = (text: string, style?: Style) => {
    if (!text) return;
    spans.push(textSpan(text, style ?? baseStyle));
  };

  while (i < input.length) {
    const rest = input.slice(i);
    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      push(code[1]!, { ...(baseStyle ?? {}), inverse: true });
      i += code[0].length;
      continue;
    }
    const bold = rest.match(/^\*\*([^*]+)\*\*/);
    if (bold) {
      push(bold[1]!, { ...(baseStyle ?? {}), bold: true });
      i += bold[0].length;
      continue;
    }
    const italicA = rest.match(/^\*([^*]+)\*/);
    if (italicA) {
      push(italicA[1]!, { ...(baseStyle ?? {}), italic: true });
      i += italicA[0].length;
      continue;
    }
    const italicB = rest.match(/^_([^_]+)_/);
    if (italicB) {
      push(italicB[1]!, { ...(baseStyle ?? {}), italic: true });
      i += italicB[0].length;
      continue;
    }
    push(rest[0]!, baseStyle);
    i += 1;
  }
  return spans;
};

export class MarkdownLite implements Widget {
  private readonly props: MarkdownLiteProps;
  constructor(props: MarkdownLiteProps) {
    this.props = props;
  }

  render(ctx: RenderContext): RenderResult {
    const lines: Line[] = [];
    for (const rawLine of this.props.markdown.split('\n')) {
      if (rawLine.startsWith('# ')) {
        lines.push(...hardWrapSpans(parseInline(rawLine.slice(2), { ...(this.props.baseStyle ?? {}), bold: true }), ctx.width));
        continue;
      }
      if (rawLine.startsWith('## ')) {
        lines.push(...hardWrapSpans(parseInline(rawLine.slice(3), { ...(this.props.baseStyle ?? {}), bold: true }), ctx.width));
        continue;
      }
      if (rawLine.startsWith('- ')) {
        const content = parseInline(rawLine.slice(2), this.props.baseStyle);
        lines.push(...hardWrapSpans([textSpan('• ', this.props.baseStyle), ...content], ctx.width));
        continue;
      }
      lines.push(...hardWrapSpans(parseInline(rawLine, this.props.baseStyle), ctx.width));
    }
    return { lines };
  }
}


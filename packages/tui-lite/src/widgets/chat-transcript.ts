import type { RenderContext, RenderResult, Style, Widget } from '../core/types';
import { textSpan } from '../core/types';
import { visibleWidth } from '../core/width';
import { MarkdownLite } from './markdown-lite';
import { fillLine, hardWrapSpans } from './format';

export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ChatTranscriptMessage {
  role: TranscriptRole;
  text: string;
  toolName?: string;
}

export interface ChatTranscriptProps {
  messages: ChatTranscriptMessage[];
  inFlightAssistantText?: string;
  userStyle?: Style;
  assistantStyle?: Style;
  toolStyle?: Style;
  systemStyle?: Style;
}

const wrapPlainText = (text: string, width: number, style?: Style): RenderResult['lines'] => {
  if (width <= 0) return [[]];
  const spans = [textSpan(text, style)];
  return hardWrapSpans(spans, width);
};

const blockWithBackground = (lines: string[], width: number, style: Style): RenderResult['lines'] => {
  const out: RenderResult['lines'] = [];
  for (const raw of lines) {
    const padded = raw.length ? ` ${raw}` : ' ';
    out.push(fillLine(padded, width, style));
  }
  return out;
};

export class ChatTranscript implements Widget {
  private readonly props: ChatTranscriptProps;
  constructor(props: ChatTranscriptProps) {
    this.props = props;
  }

  render(ctx: RenderContext): RenderResult {
    const userStyle: Style = this.props.userStyle ?? { bg: 'gray', fg: 'black' };
    const assistantStyle: Style | undefined = this.props.assistantStyle;
    const toolStyle: Style = this.props.toolStyle ?? { fg: 'gray', dim: true };
    const systemStyle: Style = this.props.systemStyle ?? { fg: 'gray', dim: true };

    const rendered: RenderResult['lines'] = [];

    const pushSpacer = () => {
      if (rendered.length) rendered.push([]);
    };

    for (const msg of this.props.messages) {
      if (!msg.text?.length && msg.role !== 'tool') continue;
      pushSpacer();

      if (msg.role === 'user') {
        const innerW = Math.max(1, ctx.width - 2);
        const wrapped = wrapPlainText(msg.text, innerW, userStyle);
        const strings = wrapped.map((l) => l.map((s) => s.text).join(''));
        const block = blockWithBackground(strings, ctx.width, userStyle);
        rendered.push(...block);
        continue;
      }

      if (msg.role === 'assistant') {
        const widget = new MarkdownLite({ markdown: msg.text, baseStyle: assistantStyle });
        rendered.push(...widget.render({ width: ctx.width, height: Number.MAX_SAFE_INTEGER }).lines);
        continue;
      }

      if (msg.role === 'tool') {
        const label = msg.toolName ? `tool: ${msg.toolName}` : 'tool';
        rendered.push([textSpan(label, toolStyle)]);
        if (msg.text?.trim().length) {
          rendered.push(...wrapPlainText(msg.text, ctx.width, toolStyle));
        }
        continue;
      }

      // system
      rendered.push(...wrapPlainText(msg.text, ctx.width, systemStyle));
    }

    if (this.props.inFlightAssistantText?.trim().length) {
      pushSpacer();
      const widget = new MarkdownLite({ markdown: this.props.inFlightAssistantText, baseStyle: assistantStyle });
      rendered.push(...widget.render({ width: ctx.width, height: Number.MAX_SAFE_INTEGER }).lines);
    }

    const clipped =
      rendered.length > ctx.height ? rendered.slice(rendered.length - ctx.height) : rendered;

    // Normalize single-span lines so they don't overflow width when background is used.
    // (fillLine already pads; this is just defensive for other lines).
    const normalized = clipped.map((line) => {
      const w = line.reduce((acc, span) => acc + visibleWidth(span.text), 0);
      if (w >= ctx.width || !ctx.width) return line;
      return [...line, textSpan(' '.repeat(ctx.width - w), undefined)];
    });

    return { lines: normalized };
  }
}


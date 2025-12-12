import type { Line, Span, Style } from '../core/types';
import { textSpan } from '../core/types';
import { truncateToWidth, visibleWidth } from '../core/width';

export const lineWidth = (line: Line): number => line.reduce((acc, span) => acc + visibleWidth(span.text), 0);

export const hardWrapSpans = (spans: Span[], width: number): Line[] => {
  if (width <= 0) return [[]];
  const lines: Line[] = [[]];
  let currentWidth = 0;

  const pushSpanText = (text: string, style?: Style) => {
    if (text.length === 0) return;
    const line = lines[lines.length - 1]!;
    const last = line[line.length - 1];
    if (last && JSON.stringify(last.style ?? {}) === JSON.stringify(style ?? {})) {
      last.text += text;
      return;
    }
    line.push({ text, style });
  };

  for (const span of spans) {
    const parts = span.text.split('\n');
    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi]!;
      for (const ch of part) {
        const cw = visibleWidth(ch);
        if (currentWidth + cw > width) {
          lines.push([]);
          currentWidth = 0;
        }
        pushSpanText(ch, span.style);
        currentWidth += cw;
      }
      if (pi < parts.length - 1) {
        lines.push([]);
        currentWidth = 0;
      }
    }
  }
  return lines;
};

export const fillLine = (text: string, width: number, style?: Style): Line => {
  const clipped = truncateToWidth(text, width, '');
  const pad = Math.max(0, width - visibleWidth(clipped));
  return [textSpan(clipped + ' '.repeat(pad), style)];
};


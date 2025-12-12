import type { ColorName, Line, Span, Style } from './types';

const ESC = '\u001b[';

const COLOR_FG: Record<ColorName, string | undefined> = {
  default: undefined,
  black: '30',
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  white: '37',
  gray: '90',
};

const COLOR_BG: Record<ColorName, string | undefined> = {
  default: undefined,
  black: '40',
  red: '41',
  green: '42',
  yellow: '43',
  blue: '44',
  magenta: '45',
  cyan: '46',
  white: '47',
  gray: '100',
};

export const ANSI = {
  ESC,
  reset: `${ESC}0m`,
  clearScreen: `${ESC}2J`,
  clearLine: `${ESC}2K`,
  hideCursor: `${ESC}?25l`,
  showCursor: `${ESC}?25h`,
  home: `${ESC}H`,
  moveTo(row1: number, col1: number) {
    return `${ESC}${row1};${col1}H`;
  },
} as const;

const styleKey = (style?: Style): string => {
  if (!style) return '';
  return [
    style.fg ?? '',
    style.bg ?? '',
    style.bold ? 'b' : '',
    style.dim ? 'd' : '',
    style.italic ? 'i' : '',
    style.underline ? 'u' : '',
    style.inverse ? 'x' : '',
  ].join('|');
};

const styleToCodes = (style?: Style): string => {
  if (!style) return '';
  const codes: string[] = [];
  if (style.bold) codes.push('1');
  if (style.dim) codes.push('2');
  if (style.italic) codes.push('3');
  if (style.underline) codes.push('4');
  if (style.inverse) codes.push('7');
  if (style.fg) {
    const fg = COLOR_FG[style.fg];
    if (fg) codes.push(fg);
  }
  if (style.bg) {
    const bg = COLOR_BG[style.bg];
    if (bg) codes.push(bg);
  }
  return codes.length ? `${ESC}${codes.join(';')}m` : '';
};

export const renderSpanToAnsi = (span: Span): string => {
  if (!span.style) return span.text;
  return `${styleToCodes(span.style)}${span.text}`;
};

export const renderLineToAnsi = (line: Line): string => {
  let out = '';
  let lastKey = '';
  for (const span of line) {
    const key = styleKey(span.style);
    if (key !== lastKey) {
      out += ANSI.reset;
      out += styleToCodes(span.style);
      lastKey = key;
    }
    out += span.text;
  }
  if (out.length) out += ANSI.reset;
  return out;
};


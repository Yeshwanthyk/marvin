const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

const ANSI_PREFIX_RE =
  // eslint-disable-next-line no-control-regex
  /^[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/;

export const stripAnsi = (input: string): string => input.replace(ANSI_RE, '');

const isCombiningMark = (codePoint: number): boolean => {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
};

// Based on the logic used by widely adopted CLIs (MIT-licensed implementations like sindresorhus/is-fullwidth-code-point).
const isFullWidthCodePoint = (codePoint: number): boolean => {
  if (codePoint < 0x1100) return false;
  return (
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
};

export const visibleWidth = (input: string): number => {
  const plain = stripAnsi(input);
  let width = 0;
  for (const char of plain) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint === 0) continue;
    if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) continue;
    if (isCombiningMark(codePoint)) continue;
    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }
  return width;
};

export const truncateToWidth = (input: string, maxWidth: number, ellipsis = '…'): string => {
  if (maxWidth <= 0) return '';
  if (visibleWidth(input) <= maxWidth) return input;
  const ellW = visibleWidth(ellipsis);
  if (ellW >= maxWidth) return ellipsis.slice(0, Math.max(0, maxWidth));
  const target = maxWidth - ellW;
  let out = '';
  let w = 0;
  for (const char of stripAnsi(input)) {
    const cw = visibleWidth(char);
    if (w + cw > target) break;
    out += char;
    w += cw;
  }
  return out + ellipsis;
};

export const truncateAnsiToWidth = (input: string, maxWidth: number): string => {
  if (maxWidth <= 0) return '';
  if (visibleWidth(input) <= maxWidth) return input;
  let out = '';
  let w = 0;
  for (let i = 0; i < input.length && w < maxWidth; i++) {
    const ch = input[i]!;
    if (ch === '\u001b' || ch === '\u009b') {
      // Consume an ANSI escape sequence.
      const slice = input.slice(i);
      const match = slice.match(ANSI_PREFIX_RE);
      if (match) {
        out += match[0]!;
        i += match[0]!.length - 1;
        continue;
      }
    }
    const cw = visibleWidth(ch);
    if (w + cw > maxWidth) break;
    out += ch;
    w += cw;
  }
  // Ensure we never leave the terminal in a styled state after truncation.
  return out + '\u001b[0m';
};

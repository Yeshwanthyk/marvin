import { ANSI } from './ansi';

export interface DiffOptions {
  fullRedraw?: boolean;
}

export const diffAnsiScreens = (prev: string[] | undefined, next: string[], options?: DiffOptions): string => {
  const fullRedraw = options?.fullRedraw ?? !prev;
  const prevLines = prev ?? [];
  let out = '';
  out += ANSI.hideCursor;
  if (fullRedraw) {
    out += ANSI.clearScreen;
    out += ANSI.home;
  }
  for (let i = 0; i < next.length; i++) {
    const before = prevLines[i] ?? '';
    const after = next[i];
    if (!fullRedraw && before === after) continue;
    out += ANSI.moveTo(i + 1, 1);
    out += ANSI.clearLine;
    out += after;
  }
  out += ANSI.showCursor;
  return out;
};


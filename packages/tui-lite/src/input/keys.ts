export type KeyName =
  | 'enter'
  | 'backspace'
  | 'delete'
  | 'escape'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'home'
  | 'end'
  | 'tab'
  | 'ctrl-c'
  | 'char';

export interface KeyEvent {
  name: KeyName;
  char?: string;
  sequence?: string;
}

const decode = (data: Uint8Array): string => new TextDecoder().decode(data);

export const parseKeys = (data: Uint8Array): KeyEvent[] => {
  const s = decode(data);
  const keys: KeyEvent[] = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    if (rest.startsWith('\u0003')) {
      keys.push({ name: 'ctrl-c', sequence: '\u0003' });
      i += 1;
      continue;
    }
    if (rest.startsWith('\r') || rest.startsWith('\n')) {
      keys.push({ name: 'enter', sequence: rest[0]! });
      i += 1;
      continue;
    }
    if (rest.startsWith('\t')) {
      keys.push({ name: 'tab', sequence: '\t' });
      i += 1;
      continue;
    }
    if (rest.startsWith('\u007f')) {
      keys.push({ name: 'backspace', sequence: '\u007f' });
      i += 1;
      continue;
    }
    if (rest.startsWith('\u001b')) {
      const seq = rest.slice(0, 6);
      const map: Record<string, KeyName> = {
        '\u001b[A': 'up',
        '\u001b[B': 'down',
        '\u001b[C': 'right',
        '\u001b[D': 'left',
        '\u001b[H': 'home',
        '\u001b[F': 'end',
        '\u001b[3~': 'delete',
      };
      const match = Object.keys(map).find((k) => seq.startsWith(k));
      if (match) {
        keys.push({ name: map[match]!, sequence: match });
        i += match.length;
        continue;
      }
      keys.push({ name: 'escape', sequence: '\u001b' });
      i += 1;
      continue;
    }
    const ch = rest[0]!;
    keys.push({ name: 'char', char: ch, sequence: ch });
    i += 1;
  }
  return keys;
};


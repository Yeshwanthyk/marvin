import type { Terminal } from '../terminal/terminal';
import type { KeyEvent } from './keys';
import { parseKeys } from './keys';

export class KeyReader {
  private readonly terminal: Terminal;
  private unsub?: () => void;

  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }

  start(onKey: (key: KeyEvent) => void): { stop: () => void } {
    this.unsub = this.terminal.onData((data) => {
      for (const key of parseKeys(data)) onKey(key);
    });
    return {
      stop: () => {
        this.unsub?.();
      },
    };
  }
}


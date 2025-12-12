export interface TerminalSize {
  columns: number;
  rows: number;
}

export type Unsubscribe = () => void;

export interface Terminal {
  size(): TerminalSize;
  write(data: string): void;
  onData(handler: (data: Uint8Array) => void): Unsubscribe;
  onResize(handler: () => void): Unsubscribe;
  setRawMode(enabled: boolean): void;
}


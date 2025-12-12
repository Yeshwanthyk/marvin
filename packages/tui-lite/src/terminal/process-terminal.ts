import type { Terminal, TerminalSize, Unsubscribe } from './terminal';

export interface ProcessTerminalOptions {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

export class ProcessTerminal implements Terminal {
  private readonly input: NodeJS.ReadStream;
  private readonly output: NodeJS.WriteStream;

  constructor(options?: ProcessTerminalOptions) {
    this.input = options?.input ?? process.stdin;
    this.output = options?.output ?? process.stdout;
  }

  size(): TerminalSize {
    return {
      columns: this.output.columns ?? 80,
      rows: this.output.rows ?? 24,
    };
  }

  write(data: string): void {
    this.output.write(data);
  }

  onData(handler: (data: Uint8Array) => void): Unsubscribe {
    const onData = (chunk: Buffer) => handler(new Uint8Array(chunk));
    this.input.on('data', onData);
    return () => this.input.off('data', onData);
  }

  onResize(handler: () => void): Unsubscribe {
    const onResize = () => handler();
    // Node + Bun both emit 'resize' on stdout for TTY.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.output as any).on?.('resize', onResize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => (this.output as any).off?.('resize', onResize);
  }

  setRawMode(enabled: boolean): void {
    if (!this.input.isTTY) return;
    this.input.setRawMode?.(enabled);
    if (enabled) this.input.resume();
  }
}


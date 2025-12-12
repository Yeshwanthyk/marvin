export type SseEventHandler = (data: string) => void;
export type SseErrorHandler = (error: Error) => void;

export interface SseParserOptions {
  onEvent: SseEventHandler;
  onError?: SseErrorHandler;
}

/**
 * Minimal SSE parser that handles Bun/WHATWG streams.
 * Buffers partial frames so we only emit fully parsed `data:` payloads.
 */
export class SseParser {
  private buffer = '';
  private readonly decoder = new TextDecoder();
  private readonly onEvent: SseEventHandler;
  private readonly onError?: SseErrorHandler;
  private readonly pendingData: string[] = [];

  constructor(options: SseParserOptions) {
    this.onEvent = options.onEvent;
    this.onError = options.onError;
  }

  push(chunk: Uint8Array): void {
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true });
      let lineBreakIndex = this.buffer.indexOf('\n');
      while (lineBreakIndex >= 0) {
        const rawLine = this.buffer.slice(0, lineBreakIndex);
        this.buffer = this.buffer.slice(lineBreakIndex + 1);
        this.handleLine(rawLine.replace(/\r$/, ''));
        lineBreakIndex = this.buffer.indexOf('\n');
      }
    } catch (error) {
      this.onError?.(error as Error);
    }
  }

  finish(): void {
    if (this.buffer) {
      this.handleLine(this.buffer.replace(/\r$/, ''));
      this.buffer = '';
    }
    this.flushEvent();
  }

  private handleLine(line: string): void {
    if (!line) {
      this.flushEvent();
      return;
    }
    if (!line.startsWith('data:')) {
      return;
    }
    this.pendingData.push(line.slice(5).trim());
  }

  private flushEvent(): void {
    if (this.pendingData.length === 0) {
      return;
    }
    const payload = this.pendingData.join('\n');
    this.pendingData.length = 0;
    if (payload) {
      this.onEvent(payload);
    }
  }
}

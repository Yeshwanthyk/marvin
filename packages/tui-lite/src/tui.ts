import { renderLineToAnsi } from './core/ansi';
import { diffAnsiScreens } from './core/diff';
import type { Cursor, RenderContext, RenderResult, Widget } from './core/types';
import { truncateAnsiToWidth, visibleWidth } from './core/width';
import type { Terminal } from './terminal/terminal';

export interface TuiLayout {
  main: Widget;
  status?: Widget;
}

export interface TuiFrame {
  lines: string[];
  cursor?: Cursor;
}

export type FrameRenderer = (result: RenderResult, ctx: RenderContext) => TuiFrame;

export const defaultFrameRenderer: FrameRenderer = (result, ctx) => {
  const lines = result.lines.map((l) => renderLineToAnsi(l));
  const normalized: string[] = [];
  for (let i = 0; i < ctx.height; i++) {
    const raw = lines[i] ?? '';
    let clipped = truncateAnsiToWidth(raw, ctx.width);
    const w = visibleWidth(clipped);
    if (w < ctx.width) clipped = clipped + ' '.repeat(ctx.width - w);
    normalized.push(clipped);
  }
  return { lines: normalized, cursor: result.cursor };
};

export class Tui {
  private prev?: string[];
  private readonly terminal: Terminal;
  private layout: TuiLayout;
  private readonly renderFrame: FrameRenderer;

  constructor(terminal: Terminal, layout: TuiLayout, renderFrame?: FrameRenderer) {
    this.terminal = terminal;
    this.layout = layout;
    this.renderFrame = renderFrame ?? defaultFrameRenderer;
  }

  setLayout(layout: TuiLayout): void {
    this.layout = layout;
  }

  render(): void {
    const size = this.terminal.size();
    const hasStatus = Boolean(this.layout.status);
    const mainHeight = Math.max(0, size.rows - (hasStatus ? 1 : 0));

    const mainCtx: RenderContext = { width: size.columns, height: mainHeight };
    const statusCtx: RenderContext = { width: size.columns, height: 1 };

    const mainResult = this.layout.main.render(mainCtx);
    const mainFrame = this.renderFrame(mainResult, mainCtx);

    const statusFrame = hasStatus
      ? this.renderFrame(this.layout.status!.render(statusCtx), statusCtx)
      : { lines: [] as string[] };

    const nextLines = [...mainFrame.lines, ...(hasStatus ? [statusFrame.lines[0] ?? ''] : [])];
    const patch = diffAnsiScreens(this.prev, nextLines, { fullRedraw: !this.prev });
    this.terminal.write(patch);
    this.prev = nextLines;
  }

  start(): { stop: () => void } {
    this.terminal.setRawMode(true);
    const unsubResize = this.terminal.onResize(() => this.render());
    this.render();
    return {
      stop: () => {
        unsubResize();
        this.terminal.setRawMode(false);
      },
    };
  }
}

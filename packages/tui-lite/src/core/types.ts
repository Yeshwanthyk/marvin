export type ColorName =
  | 'default'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray';

export interface Style {
  fg?: ColorName;
  bg?: ColorName;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface Span {
  text: string;
  style?: Style;
}

export type Line = Span[];

export interface Cursor {
  row: number; // 0-based
  col: number; // 0-based (visible columns)
}

export interface RenderContext {
  width: number;
  height: number;
}

export interface RenderResult {
  lines: Line[];
  cursor?: Cursor;
}

export interface Widget {
  render(ctx: RenderContext): RenderResult;
}

export const textSpan = (text: string, style?: Style): Span => ({ text, style });


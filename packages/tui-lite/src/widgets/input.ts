import type { Cursor, RenderContext, RenderResult, Style, Widget } from '../core/types';
import { textSpan } from '../core/types';
import { visibleWidth } from '../core/width';
import type { KeyEvent } from '../input/keys';

export interface InputProps {
  prompt?: string;
  placeholder?: string;
  promptStyle?: Style;
  valueStyle?: Style;
}

export class Input implements Widget {
  private readonly props: InputProps;
  value = '';
  cursorIndex = 0;

  constructor(props?: InputProps) {
    this.props = props ?? {};
  }

  setValue(next: string): void {
    this.value = next;
    this.cursorIndex = Math.min(this.cursorIndex, next.length);
  }

  handleKey(key: KeyEvent): { submitted?: string } {
    if (key.name === 'enter') return { submitted: this.value };
    if (key.name === 'left') {
      this.cursorIndex = Math.max(0, this.cursorIndex - 1);
      return {};
    }
    if (key.name === 'right') {
      this.cursorIndex = Math.min(this.value.length, this.cursorIndex + 1);
      return {};
    }
    if (key.name === 'home') {
      this.cursorIndex = 0;
      return {};
    }
    if (key.name === 'end') {
      this.cursorIndex = this.value.length;
      return {};
    }
    if (key.name === 'backspace') {
      if (this.cursorIndex <= 0) return {};
      this.value = this.value.slice(0, this.cursorIndex - 1) + this.value.slice(this.cursorIndex);
      this.cursorIndex -= 1;
      return {};
    }
    if (key.name === 'delete') {
      if (this.cursorIndex >= this.value.length) return {};
      this.value = this.value.slice(0, this.cursorIndex) + this.value.slice(this.cursorIndex + 1);
      return {};
    }
    if (key.name === 'char' && key.char) {
      this.value = this.value.slice(0, this.cursorIndex) + key.char + this.value.slice(this.cursorIndex);
      this.cursorIndex += key.char.length;
    }
    return {};
  }

  render(ctx: RenderContext): RenderResult {
    const prompt = this.props.prompt ?? '> ';
    const available = Math.max(0, ctx.width - visibleWidth(prompt));
    const valueToShow = this.value.length ? this.value : this.props.placeholder ?? '';
    const isPlaceholder = !this.value.length && Boolean(this.props.placeholder);

    // Keep cursor visible by windowing the input value.
    let windowStart = 0;
    const beforeCursor = this.value.slice(0, this.cursorIndex);
    let cursorCol = visibleWidth(prompt) + visibleWidth(beforeCursor);
    if (cursorCol > ctx.width - 1) {
      const overflow = cursorCol - (ctx.width - 1);
      // crude but effective: advance window start by overflow chars
      windowStart = Math.min(this.value.length, overflow);
    }
    const windowText = valueToShow.slice(windowStart);
    const clipped = windowText.slice(0, available);

    const cursor: Cursor | undefined = this.value.length
      ? { row: 0, col: Math.min(ctx.width - 1, visibleWidth(prompt) + visibleWidth(beforeCursor.slice(windowStart))) }
      : { row: 0, col: visibleWidth(prompt) };

    return {
      lines: [
        [
          textSpan(prompt, this.props.promptStyle),
          textSpan(clipped, isPlaceholder ? { ...(this.props.valueStyle ?? {}), dim: true } : this.props.valueStyle),
        ],
      ],
      cursor,
    };
  }
}


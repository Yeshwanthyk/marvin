import type { RenderContext, RenderResult, Style, Widget } from '../core/types';
import { textSpan } from '../core/types';
import { hardWrapSpans } from './format';

export interface TextProps {
  text: string;
  style?: Style;
}

export class Text implements Widget {
  private readonly props: TextProps;
  constructor(props: TextProps) {
    this.props = props;
  }

  render(ctx: RenderContext): RenderResult {
    const spans = [textSpan(this.props.text, this.props.style)];
    const lines = hardWrapSpans(spans, ctx.width);
    return { lines };
  }
}


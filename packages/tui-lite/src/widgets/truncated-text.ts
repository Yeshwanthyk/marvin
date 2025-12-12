import type { RenderContext, RenderResult, Style, Widget } from '../core/types';
import { textSpan } from '../core/types';
import { truncateToWidth } from '../core/width';

export interface TruncatedTextProps {
  text: string;
  style?: Style;
  ellipsis?: string;
}

export class TruncatedText implements Widget {
  private readonly props: TruncatedTextProps;
  constructor(props: TruncatedTextProps) {
    this.props = props;
  }

  render(ctx: RenderContext): RenderResult {
    return {
      lines: [[textSpan(truncateToWidth(this.props.text, ctx.width, this.props.ellipsis), this.props.style)]],
    };
  }
}


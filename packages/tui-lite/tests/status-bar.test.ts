import { describe, expect, test } from 'bun:test';
import type { AgentUsage } from '@mu-agents/types';
import { renderLineToAnsi } from '../src/core/ansi';
import { visibleWidth } from '../src/core/width';
import { StatusBar, StatusBarModel } from '../src/widgets/status-bar';

describe('StatusBar', () => {
  test('fits within width and right-aligns usage', () => {
    const model = new StatusBarModel({ cwd: '/Users/hsey/Documents/personal/mu', branch: 'main' });
    const usage: AgentUsage = {
      model: 'x',
      provider: 'y',
      tokens: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    };
    model.state.usage = usage;

    const bar = new StatusBar({ model });
    const out = bar.render({ width: 30, height: 1 });
    const line = renderLineToAnsi(out.lines[0]!);
    expect(visibleWidth(line)).toBeLessThanOrEqual(30);
  });
});

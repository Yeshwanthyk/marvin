import { describe, expect, test } from 'bun:test';
import { diffAnsiScreens } from '../src/core/diff';

describe('diffAnsiScreens', () => {
  test('first render includes full clear', () => {
    const next = ['one', 'two'];
    const out = diffAnsiScreens(undefined, next);
    expect(out).toContain('\u001b[2J');
    expect(out).toContain('\u001b[1;1H');
  });

  test('incremental render only touches changed lines', () => {
    const prev = ['one', 'two', 'three'];
    const next = ['one', 'TWO', 'three'];
    const out = diffAnsiScreens(prev, next, { fullRedraw: false });
    // Line 2 updated.
    expect(out).toContain('\u001b[2;1H');
    // Line 1 should not be targeted.
    expect(out).not.toContain('\u001b[1;1H\u001b[2Kone');
  });
});


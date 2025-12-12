import { describe, expect, test } from 'bun:test';
import { stripAnsi, truncateAnsiToWidth, visibleWidth } from '../src/core/width';

describe('visibleWidth', () => {
  test('ignores ANSI sequences', () => {
    expect(visibleWidth('\u001b[31mhello\u001b[0m')).toBe(5);
  });

  test('counts fullwidth characters as 2', () => {
    expect(visibleWidth('你')).toBe(2);
    expect(visibleWidth('a你b')).toBe(4);
  });
});

describe('truncateAnsiToWidth', () => {
  test('truncates by visible columns while preserving plain text', () => {
    const input = '\u001b[31mhello-world\u001b[0m';
    const out = truncateAnsiToWidth(input, 5);
    expect(stripAnsi(out)).toBe('hello');
    expect(visibleWidth(out)).toBe(5);
  });
});


import { describe, expect, it } from 'vitest';

import { nextCharIndex, prevCharIndex, stringWidth, truncateToWidth, wrappedRowCount } from './text-width.js';

describe('stringWidth', () => {
  it('counts CJK and emoji as two columns', () => {
    expect(stringWidth('abc')).toBe(3);
    expect(stringWidth('中文')).toBe(4);
    expect(stringWidth('修复 bug')).toBe(8);
    expect(stringWidth('🚀')).toBe(2);
  });

  it('ignores zero-width joiners and variation selectors', () => {
    expect(stringWidth('a‍b')).toBe(2);
    expect(stringWidth('️')).toBe(0);
  });

  it('counts BMP emoji-presentation glyphs as two columns', () => {
    // The everyday status set: undercounting these by one column each is what
    // let emoji-bearing lines slip past truncation and row budgets.
    expect(stringWidth('✅')).toBe(2);
    expect(stringWidth('❌')).toBe(2);
    expect(stringWidth('⭐')).toBe(2);
    expect(stringWidth('⏳')).toBe(2);
    // Their text-presentation siblings stay narrow.
    expect(stringWidth('✓')).toBe(1);
    expect(stringWidth('⚠')).toBe(1);
  });

  it('upgrades a narrow symbol to two columns when VS16 requests emoji form', () => {
    expect(stringWidth('⚠️')).toBe(2);
    expect(stringWidth('ℹ️')).toBe(2);
    // VS16 after ordinary text or an already-wide glyph changes nothing.
    expect(stringWidth('a️')).toBe(1);
    expect(stringWidth('✅️')).toBe(2);
  });
});

describe('truncateToWidth', () => {
  it('measures in display columns, not code units', () => {
    // 6 CJK chars = 12 columns; a length-based clamp would have kept 9 of them.
    expect(truncateToWidth('一二三四五六', 9)).toBe('一二三四…');
    expect(stringWidth(truncateToWidth('一二三四五六', 9))).toBeLessThanOrEqual(9);
  });

  it('returns the input untouched when it fits', () => {
    expect(truncateToWidth('short', 20)).toBe('short');
    expect(truncateToWidth('中文', 4)).toBe('中文');
  });

  it('never splits a surrogate pair', () => {
    const result = truncateToWidth('🚀🚀🚀', 5);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toContain('�');
    expect([...result].every(char => char === '🚀' || char === '…')).toBe(true);
  });

  it('is a no-op for degenerate budgets', () => {
    expect(truncateToWidth('abc', 0)).toBe('abc');
    expect(truncateToWidth('abc', 1)).toBe('abc');
  });
});

describe('wrappedRowCount', () => {
  it('counts one row while the line fits', () => {
    expect(wrappedRowCount('', 20)).toBe(1);
    expect(wrappedRowCount('exactly twenty chars', 20)).toBe(1);
    // Rendered markdown carries SGR escapes; measuring them as glyphs would
    // report a wrap that the terminal never performs.
    expect(wrappedRowCount('\x1b[1mexactly twenty chars\x1b[0m', 20)).toBe(1);
    expect(stringWidth('\x1b[1mexactly twenty chars\x1b[0m')).toBeGreaterThan(20);
  });

  it('counts the rows a greedy word wrap actually produces', () => {
    // Character math says 2 rows (20 columns / 10); word wrap needs 3.
    expect(wrappedRowCount('aaaaaa bbbbbb cccccc', 10)).toBe(3);
    expect(wrappedRowCount('one two three four', 10)).toBe(2);
  });

  it('hard-splits words wider than the terminal', () => {
    expect(wrappedRowCount('a'.repeat(25), 10)).toBe(3);
    // Unspaced CJK is one long word: 30 columns over a 10-column terminal.
    expect(wrappedRowCount('一二三四五六七八九十十九八七六', 10)).toBe(3);
  });

  it('degrades to one row for a degenerate width', () => {
    expect(wrappedRowCount('anything', 0)).toBe(1);
    expect(wrappedRowCount('anything', Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('expands tabs to 8-column stops before measuring', () => {
    // '\t' advances to column 8, so 'a\tb' is 9 columns — 2 rows at 8, not 1.
    expect(wrappedRowCount('a\tb', 8)).toBe(2);
    expect(wrappedRowCount('a\tb', 9)).toBe(1);
    // A tab-indented code line: 8 (tab) + 12 chars = 20 columns.
    expect(wrappedRowCount('\tconst a = 1;', 20)).toBe(1);
    expect(wrappedRowCount('\tconst a = 1;', 19)).toBe(2);
    // Mid-column tabs snap to the NEXT stop, not a fixed width.
    expect(wrappedRowCount('abcde\tx', 9)).toBe(1); // 5 → stop at 8, +1 = 9
  });
});

describe('prevCharIndex / nextCharIndex', () => {
  it('steps whole code points across surrogate pairs', () => {
    const value = 'a🚀b';
    expect(nextCharIndex(value, 0)).toBe(1);
    expect(nextCharIndex(value, 1)).toBe(3); // skips the whole emoji
    expect(prevCharIndex(value, 3)).toBe(1);
    expect(prevCharIndex(value, 4)).toBe(3);
  });

  it('steps one unit for BMP characters, including CJK', () => {
    expect(nextCharIndex('中文', 0)).toBe(1);
    expect(prevCharIndex('中文', 2)).toBe(1);
  });

  it('clamps at the boundaries', () => {
    expect(prevCharIndex('abc', 0)).toBe(0);
    expect(prevCharIndex('abc', 99)).toBe(2);
    expect(nextCharIndex('abc', 3)).toBe(3);
    expect(nextCharIndex('abc', -5)).toBe(1);
  });
});

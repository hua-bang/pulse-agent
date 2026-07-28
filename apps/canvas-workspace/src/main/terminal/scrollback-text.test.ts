import { describe, expect, it } from 'vitest';

import {
  NODE_SCROLLBACK_READ_MAX_CHARS,
  normalizeNodeScrollback,
  normalizeScrollback,
  stripTerminalControlSequences,
} from './scrollback-text';

const ESC = String.fromCharCode(27);

describe('stripTerminalControlSequences', () => {
  it('removes CSI colour/cursor sequences', () => {
    expect(stripTerminalControlSequences(`${ESC}[31mred${ESC}[0m`)).toBe('red');
    expect(stripTerminalControlSequences(`a${ESC}[2Kb${ESC}[1;1Hc`)).toBe('abc');
  });

  it('removes OSC title/hyperlink sequences', () => {
    const bel = String.fromCharCode(7);
    expect(stripTerminalControlSequences(`${ESC}]0;my title${bel}prompt$ `)).toBe('prompt$ ');
  });

  it('drops bare CRs but keeps CRLF line breaks', () => {
    expect(stripTerminalControlSequences('loading\rdone')).toBe('loadingdone');
    expect(stripTerminalControlSequences('one\r\ntwo')).toBe('one\r\ntwo');
  });

  it('drops other C0 control bytes but keeps tabs and newlines', () => {
    const raw = `a${String.fromCharCode(0)}b\tc\nd`;
    expect(stripTerminalControlSequences(raw)).toBe('ab\tc\nd');
  });
});

describe('normalizeScrollback', () => {
  it('strips the right-edge padding a TUI writes on every framed line', () => {
    const framed = ['╭────────╮', '│ hello' + ' '.repeat(40) + '│', '╰────────╯'].join('\n');
    expect(normalizeScrollback(framed)).toBe(
      ['╭────────╮', '│ hello' + ' '.repeat(40) + '│', '╰────────╯'].join('\n'),
    );
    // Padding AFTER the last glyph on a line is what gets dropped.
    expect(normalizeScrollback('│ hello │' + ' '.repeat(60) + '\nnext')).toBe('│ hello │\nnext');
  });

  it('turns whitespace-only lines into empty lines and collapses blank runs', () => {
    expect(normalizeScrollback('a\n   \n\t\n\n\nb')).toBe('a\n\nb');
  });

  it('trims trailing whitespace at the end of the buffer', () => {
    expect(normalizeScrollback('output\n\n   \n')).toBe('output');
  });

  it('returns the buffer untouched when it is within maxChars', () => {
    expect(normalizeScrollback('short output', { maxChars: 100 })).toBe('short output');
  });

  it('keeps the newest output when truncating', () => {
    const text = ['first', 'second', 'third'].join('\n');
    expect(normalizeScrollback(text, { maxChars: 6 })).toBe('third');
  });

  it('cuts at a line boundary so the tail never opens mid-line', () => {
    const text = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'].join('\n');
    // maxChars lands inside the "bbbb" line; the cut moves forward to "cccc".
    const out = normalizeScrollback(text, { maxChars: 15 });
    expect(out).toBe('cccccccccc');
    expect(out.startsWith('b')).toBe(false);
  });

  it('adds no omission notice by default', () => {
    const out = normalizeScrollback('x'.repeat(100), { maxChars: 10 });
    expect(out).toBe('x'.repeat(10));
  });

  it('reports the omitted head when the notice is enabled', () => {
    const text = ['old line', 'new line'].join('\n');
    const out = normalizeScrollback(text, { maxChars: 8, omissionNotice: true });
    expect(out).toBe('[… 9 chars of earlier scrollback omitted …]\nnew line');
  });
});

describe('normalizeNodeScrollback', () => {
  it('caps a stored 50k-char buffer at the node read budget', () => {
    // Worst case from the field: an agent node whose stored scrollback is full
    // of redrawn TUI frames. Reading it whole used to push ~50k chars into the
    // model's context (or trip the engine's 30k offload threshold).
    const frame = ['╭─ Claude Code ─╮', '│ Welcome back! │', '╰───────────────╯', ''].join('\n');
    const stored = frame.repeat(Math.ceil(50_000 / frame.length)).slice(0, 50_000);

    const out = normalizeNodeScrollback(stored);

    expect(stored.length).toBeGreaterThan(30_000); // would have been offloaded
    expect(out.length).toBeLessThan(NODE_SCROLLBACK_READ_MAX_CHARS + 200);
    expect(out.startsWith('[…')).toBe(true);
    expect(out).toContain('Welcome back!');
  });

  it('leaves a short session untouched and un-annotated', () => {
    expect(normalizeNodeScrollback('$ pnpm test\nAll tests passed')).toBe(
      '$ pnpm test\nAll tests passed',
    );
  });

  it('still strips control bytes from scrollback written outside the app', () => {
    // canvas-cli and older app versions can persist unparsed PTY output.
    expect(normalizeNodeScrollback(`${ESC}[32m$ ls${ESC}[0m\nREADME.md`)).toBe('$ ls\nREADME.md');
  });

  it('is a no-op on empty scrollback', () => {
    expect(normalizeNodeScrollback('')).toBe('');
  });
});

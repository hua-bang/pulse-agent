import { describe, expect, it } from 'vitest';
import { settledMarkdownEnd } from './settledEnd';

describe('settledMarkdownEnd', () => {
  it('ends after a paragraph once the next block has a full line', () => {
    const text = 'First paragraph.\n\nSecond\n';
    expect(settledMarkdownEnd(text)).toBe('First paragraph.\n\n'.length);
  });

  it('keeps an unfinished last line in the tail', () => {
    expect(settledMarkdownEnd('First paragraph.\n\n')).toBe(0);
    expect(settledMarkdownEnd('Only one line')).toBe(0);
    // `-` may still become a list marker, so the split waits for the line.
    expect(settledMarkdownEnd('First paragraph.\n\n-')).toBe(0);
  });

  it('does not split inside a code fence', () => {
    const text = 'Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n';
    expect(settledMarkdownEnd(text)).toBe('Intro\n\n'.length);

    const closed = `${text}\`\`\`\n\nAfter\n`;
    expect(settledMarkdownEnd(closed)).toBe(closed.length - 'After\n'.length);
  });

  it('does not split before a list item, quote, or indented line', () => {
    expect(settledMarkdownEnd('- one\n\n- two\n')).toBe(0);
    expect(settledMarkdownEnd('1. one\n\n2. two\n')).toBe(0);
    expect(settledMarkdownEnd('> one\n\n> two\n')).toBe(0);
    expect(settledMarkdownEnd('- one\n\n  more\n')).toBe(0);
  });

  it('continues from an earlier result as the text grows', () => {
    const first = 'A\n\nB\n';
    const from = settledMarkdownEnd(first);
    const grown = `${first}\nC\n`;
    expect(settledMarkdownEnd(grown, from)).toBe(settledMarkdownEnd(grown));
    expect(settledMarkdownEnd(grown, from)).toBe('A\n\nB\n\n'.length);
  });
});

describe('settledMarkdownEnd around code fences', () => {
  it('splits before a fence that interrupts a paragraph', () => {
    expect(settledMarkdownEnd('Intro\n```ts\nconst a = 1;\n')).toBe('Intro\n'.length);
  });

  it('splits after a closed fence once the next line is full', () => {
    const text = '```ts\nconst a = 1;\n```\nAfter\n';
    expect(settledMarkdownEnd(text)).toBe('```ts\nconst a = 1;\n```\n'.length);
  });
});

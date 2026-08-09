import { describe, expect, it } from 'vitest';

import { renderMarkdownAnsi } from './markdown.js';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

describe('renderMarkdownAnsi', () => {
  it('renders headings bold cyan without the hash prefix', () => {
    expect(renderMarkdownAnsi('# Title')).toBe(`${BOLD}${CYAN}Title${RESET}`);
    expect(renderMarkdownAnsi('### Sub')).toBe(`${BOLD}${CYAN}Sub${RESET}`);
  });

  it('normalizes bullets and keeps indentation', () => {
    expect(renderMarkdownAnsi('- item')).toBe('• item');
    expect(renderMarkdownAnsi('  * nested')).toBe('  • nested');
  });

  it('styles inline bold, code, and links', () => {
    expect(renderMarkdownAnsi('a **b** c')).toBe(`a ${BOLD}b${RESET} c`);
    expect(renderMarkdownAnsi('run `pnpm test`')).toBe(`run ${CYAN}pnpm test${RESET}`);
    expect(renderMarkdownAnsi('[docs](https://x.dev)')).toBe(`${CYAN}docs${RESET} ${DIM}(https://x.dev)${RESET}`);
  });

  it('leaves fenced code content untouched for copy/paste', () => {
    const source = '```ts\nconst a = **not bold**;\n- not a bullet\n```';
    const rendered = renderMarkdownAnsi(source);
    const lines = rendered.split('\n');
    expect(lines[0]).toBe(`${DIM}\`\`\`ts${RESET}`);
    expect(lines[1]).toBe('const a = **not bold**;');
    expect(lines[2]).toBe('- not a bullet');
    expect(lines[3]).toBe(`${DIM}\`\`\`${RESET}`);
  });

  it('renders horizontal rules and blockquotes', () => {
    expect(renderMarkdownAnsi('---')).toBe(`${DIM}${'─'.repeat(40)}${RESET}`);
    expect(renderMarkdownAnsi('> quoted')).toBe(`${DIM}▌ ${RESET}quoted`);
  });

  it('keeps markers inside inline code literal — code wins over bold and links', () => {
    // Regression: bold/link regexes used to run first, styling fragments of
    // the span and dropping its cyan for the remainder.
    expect(renderMarkdownAnsi('`options.**retries**Count`'))
      .toBe(`${CYAN}options.**retries**Count${RESET}`);
    expect(renderMarkdownAnsi('`see [docs](https://x.dev)`'))
      .toBe(`${CYAN}see [docs](https://x.dev)${RESET}`);
    // Styling outside code spans still applies on the same line.
    expect(renderMarkdownAnsi('use `a**b**` and **bold**'))
      .toBe(`use ${CYAN}a**b**${RESET} and ${BOLD}bold${RESET}`);
  });

  it('renders GFM tables aligned on display columns', () => {
    const strip = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');
    const rendered = renderMarkdownAnsi([
      '| 名称 | count |',
      '| --- | ---: |',
      '| 构建 | 3 |',
      '| 测试用例 | 12 |',
    ].join('\n'));

    // CJK cells are 2 columns per glyph — padEnd by code units would misalign.
    expect(rendered.split('\n').map(strip)).toEqual([
      '名称     │ count',
      '─────────┼──────',
      '构建     │     3',
      '测试用例 │    12',
    ]);
    // Header is bold; pipes are dim.
    expect(rendered.split('\n')[0]).toContain(`${BOLD}名称${RESET}`);
    expect(rendered).toContain(`${DIM} │ ${RESET}`);
  });

  it('leaves pipe lines alone when no separator row follows', () => {
    expect(renderMarkdownAnsi('a | b | c')).toBe('a | b | c');
  });

  it('squeezes blank-line runs outside fences and trims block edges', () => {
    // Prose: leading blanks dropped, 3-blank run collapsed to one, tail trimmed.
    expect(renderMarkdownAnsi('\n\nfirst\n\n\n\nsecond\n\n')).toBe('first\n\nsecond');
    // Whitespace-only lines count as blank.
    expect(renderMarkdownAnsi('a\n   \n\t\nb')).toBe('a\n\nb');
  });

  it('keeps blank lines inside fenced code intact', () => {
    const source = '```\nline1\n\n\n\nline2\n```';
    const rendered = renderMarkdownAnsi(source);
    expect(rendered.split('\n')).toEqual([
      `${DIM}\`\`\`${RESET}`,
      'line1',
      '',
      '',
      '',
      'line2',
      `${DIM}\`\`\`${RESET}`,
    ]);
  });
});

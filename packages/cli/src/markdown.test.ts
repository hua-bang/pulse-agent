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

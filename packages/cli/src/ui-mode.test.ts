import { describe, expect, it } from 'vitest';

import { parseCliArgs, resolveCliUiMode } from './ui-mode.js';

describe('resolveCliUiMode', () => {
  it('defaults to ink', () => {
    expect(resolveCliUiMode([], {}, true)).toBe('ink');
  });

  it('uses PULSE_CODER_UI=readline as an escape hatch', () => {
    expect(resolveCliUiMode([], { PULSE_CODER_UI: 'readline' }, true)).toBe('readline');
    expect(resolveCliUiMode([], { PULSE_CODER_UI: 'plain' }, true)).toBe('readline');
  });

  it('uses --ui ink flag', () => {
    expect(resolveCliUiMode(['--ui', 'ink'], {}, true)).toBe('ink');
    expect(resolveCliUiMode(['--ui=ink'], {}, true)).toBe('ink');
  });

  it('lets explicit readline flags override env', () => {
    expect(resolveCliUiMode(['--ui', 'readline'], { PULSE_CODER_UI: 'ink' }, true)).toBe('readline');
    expect(resolveCliUiMode(['--tui=plain'], { PULSE_CODER_UI: 'ink' }, true)).toBe('readline');
  });

  it('forces readline without a TTY, overriding every explicit request for ink', () => {
    expect(resolveCliUiMode([], {}, false)).toBe('readline');
    expect(resolveCliUiMode(['--ui', 'ink'], {}, false)).toBe('readline');
    expect(resolveCliUiMode(['--ui=ink'], { PULSE_CODER_UI: 'ink' }, false)).toBe('readline');
  });
});

describe('parseCliArgs', () => {
  it('parses defaults', () => {
    expect(parseCliArgs([], {}, true)).toEqual({ uiMode: 'ink', print: false, prompt: '', continueLast: false, verbose: false });
  });

  it('parses print mode with a prompt', () => {
    const parsed = parseCliArgs(['-p', 'fix', 'the', 'bug'], {}, true);
    expect(parsed.print).toBe(true);
    expect(parsed.prompt).toBe('fix the bug');
  });

  it('parses --continue and keeps ui flags out of the prompt', () => {
    const parsed = parseCliArgs(['--ui', 'readline', '--continue', '-p', 'hi'], {}, true);
    expect(parsed.uiMode).toBe('readline');
    expect(parsed.continueLast).toBe(true);
    expect(parsed.prompt).toBe('hi');
  });

  it('parses --verbose without leaking it into the prompt', () => {
    const parsed = parseCliArgs(['--verbose', '-p', 'hi'], {}, true);
    expect(parsed.verbose).toBe(true);
    expect(parsed.prompt).toBe('hi');
  });

  it('parses --model in both flag forms', () => {
    expect(parseCliArgs(['--model', 'claude:claude-opus-5'], {}, true).model).toBe('claude:claude-opus-5');
    expect(parseCliArgs(['--model=gpt-5.2', '-p', 'hi'], {}, true)).toMatchObject({ model: 'gpt-5.2', prompt: 'hi' });
  });
});

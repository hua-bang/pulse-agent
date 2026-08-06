import { describe, expect, it } from 'vitest';

import { parseCliArgs, resolveCliUiMode } from './ui-mode.js';

describe('resolveCliUiMode', () => {
  it('defaults to ink', () => {
    expect(resolveCliUiMode([], {})).toBe('ink');
  });

  it('uses PULSE_CODER_UI=readline as an escape hatch', () => {
    expect(resolveCliUiMode([], { PULSE_CODER_UI: 'readline' })).toBe('readline');
    expect(resolveCliUiMode([], { PULSE_CODER_UI: 'plain' })).toBe('readline');
  });

  it('uses --ui ink flag', () => {
    expect(resolveCliUiMode(['--ui', 'ink'], {})).toBe('ink');
    expect(resolveCliUiMode(['--ui=ink'], {})).toBe('ink');
  });

  it('lets explicit readline flags override env', () => {
    expect(resolveCliUiMode(['--ui', 'readline'], { PULSE_CODER_UI: 'ink' })).toBe('readline');
    expect(resolveCliUiMode(['--tui=plain'], { PULSE_CODER_UI: 'ink' })).toBe('readline');
  });
});

describe('parseCliArgs', () => {
  it('parses defaults', () => {
    expect(parseCliArgs([], {})).toEqual({ uiMode: 'ink', print: false, prompt: '', continueLast: false });
  });

  it('parses print mode with a prompt', () => {
    const parsed = parseCliArgs(['-p', 'fix', 'the', 'bug'], {});
    expect(parsed.print).toBe(true);
    expect(parsed.prompt).toBe('fix the bug');
  });

  it('parses --continue and keeps ui flags out of the prompt', () => {
    const parsed = parseCliArgs(['--ui', 'readline', '--continue', '-p', 'hi'], {});
    expect(parsed.uiMode).toBe('readline');
    expect(parsed.continueLast).toBe(true);
    expect(parsed.prompt).toBe('hi');
  });
});

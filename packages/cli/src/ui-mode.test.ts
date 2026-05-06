import { describe, expect, it } from 'vitest';

import { resolveCliUiMode } from './ui-mode.js';

describe('resolveCliUiMode', () => {
  it('defaults to readline', () => {
    expect(resolveCliUiMode([], {})).toBe('readline');
  });

  it('uses PULSE_CODER_UI=ink', () => {
    expect(resolveCliUiMode([], { PULSE_CODER_UI: 'ink' })).toBe('ink');
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

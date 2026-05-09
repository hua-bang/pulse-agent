import { describe, expect, it } from 'vitest';

import { resolveCliUiMode } from './ui-mode.js';

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

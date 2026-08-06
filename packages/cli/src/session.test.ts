import { describe, expect, it } from 'vitest';

import { extractMessageText } from './session.js';

describe('extractMessageText', () => {
  it('returns plain string content as-is', () => {
    expect(extractMessageText('hello')).toBe('hello');
  });

  it('joins text parts and skips tool parts in structured content', () => {
    expect(extractMessageText([
      { type: 'text', text: 'part one' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'bash', input: { command: 'ls' } },
      { type: 'text', text: 'part two' },
    ])).toBe('part one part two');
  });

  it('returns empty string for tool-only or unknown content', () => {
    expect(extractMessageText([{ type: 'tool-result', toolCallId: 'c1', output: 'x' }])).toBe('');
    expect(extractMessageText({ foo: 'bar' })).toBe('');
    expect(extractMessageText(null)).toBe('');
  });

  it('reads text-bearing object content', () => {
    expect(extractMessageText({ type: 'text', text: 'obj text' })).toBe('obj text');
  });
});

import { describe, expect, it } from 'vitest';
import type { CanvasAgentMessage } from '../../../../main/agent/types';
import { formatSessionExcerpt } from '../session-retrieval';

function msg(over: Partial<CanvasAgentMessage> & { role: 'user' | 'assistant'; content: string }): CanvasAgentMessage {
  return { timestamp: 0, ...over };
}

describe('formatSessionExcerpt', () => {
  it('returns role-prefixed lines for the tail, respecting maxMessages', () => {
    const messages = [
      msg({ role: 'user', content: 'first' }),
      msg({ role: 'assistant', content: 'second' }),
      msg({ role: 'user', content: 'third' }),
    ];
    expect(formatSessionExcerpt(messages, 2, false)).toEqual(['assistant: second', 'user: third']);
  });

  it('appends tool-call names only when requested', () => {
    const messages = [
      msg({
        role: 'assistant',
        content: 'done',
        toolCalls: [{ id: 1, name: 'canvas_read_node', status: 'done' }],
      }),
    ];
    expect(formatSessionExcerpt(messages, 10, false)).toEqual(['assistant: done']);
    expect(formatSessionExcerpt(messages, 10, true)).toEqual(['assistant: done\n  [tools: canvas_read_node]']);
  });

  it('normalizes empty and over-long content', () => {
    const long = 'x'.repeat(400);
    const [emptyLine] = formatSessionExcerpt([msg({ role: 'user', content: '   ' })], 1, false);
    const [longLine] = formatSessionExcerpt([msg({ role: 'user', content: long })], 1, false);
    expect(emptyLine).toBe('user: (empty)');
    expect(longLine.endsWith('...')).toBe(true);
    expect(longLine.length).toBeLessThan(long.length);
  });
});

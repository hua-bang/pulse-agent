import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { persistContinuedTurn, persistFailedContinuedTurn } from './continued-turn-persistence';

describe('persistContinuedTurn', () => {
  it('persists native steer/follow-up messages in conversational order', () => {
    const addMessage = vi.fn();
    const messages = [
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Change direction' },
      { role: 'assistant', content: 'Revised answer' },
      { role: 'user', content: 'Also summarize' },
      { role: 'assistant', content: 'Summary' },
    ] as ModelMessage[];

    const continued = persistContinuedTurn({ addMessage }, messages, {
      timestamp: 100,
      runId: 'trace-1',
    });

    expect(continued).toBe(true);
    expect(addMessage.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({ role: 'assistant', content: 'First answer', timestamp: 100 }),
      expect.objectContaining({ role: 'user', content: 'Change direction', timestamp: 101 }),
      expect.objectContaining({ role: 'assistant', content: 'Revised answer', timestamp: 102 }),
      expect.objectContaining({ role: 'user', content: 'Also summarize', timestamp: 103 }),
      expect.objectContaining({ role: 'assistant', content: 'Summary', timestamp: 104 }),
    ]);
  });

  it('leaves ordinary single-response turns on the existing persistence path', () => {
    const addMessage = vi.fn();
    expect(persistContinuedTurn(
      { addMessage },
      [{ role: 'assistant', content: 'Ordinary answer' }] as ModelMessage[],
      { timestamp: 100 },
    )).toBe(false);
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('keeps the stopped recovery marker on the final continued response', () => {
    const addMessage = vi.fn();
    persistContinuedTurn({ addMessage }, [
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Stop after this' },
      { role: 'assistant', content: 'Partial follow-up' },
    ] as ModelMessage[], {
      finalAssistant: { turnStatus: 'stopped', retryable: true },
    });

    expect(addMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      content: 'Partial follow-up',
      turnStatus: 'stopped',
      retryable: true,
    });
  });

  it('retains emitted continuation input before a terminal failure', () => {
    const addMessage = vi.fn();
    persistFailedContinuedTurn({ addMessage }, [
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Queued follow-up' },
    ] as ModelMessage[], {
      role: 'assistant', content: 'Provider failed', timestamp: 200, turnStatus: 'failed',
    });

    expect(addMessage.mock.calls.map(([message]) => message.content)).toEqual([
      'First answer',
      'Queued follow-up',
      'Provider failed',
    ]);
  });
});

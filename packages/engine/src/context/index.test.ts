import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '../shared/types';

const { summarizeMessagesMock } = vi.hoisted(() => ({
  summarizeMessagesMock: vi.fn(),
}));

vi.mock('../ai', () => ({
  summarizeMessages: summarizeMessagesMock,
}));

import { maybeCompactContext } from './index';

const longContext = (): Context => ({
  messages: Array.from({ length: 8 }, (_unused, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${index} ${'x'.repeat(400)}`,
  })) as Context['messages'],
});

describe('maybeCompactContext abort', () => {
  beforeEach(() => {
    summarizeMessagesMock.mockReset();
  });

  it('forwards the abort signal to the summarizer', async () => {
    const controller = new AbortController();
    summarizeMessagesMock.mockResolvedValue('short');

    await maybeCompactContext(longContext(), { force: true, abortSignal: controller.signal });

    expect(summarizeMessagesMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ abortSignal: controller.signal }),
    );
  });

  it('keeps history instead of the prune fallback when stopped mid-summary', async () => {
    const controller = new AbortController();
    summarizeMessagesMock.mockImplementation(async () => {
      controller.abort();
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    });

    const result = await maybeCompactContext(longContext(), {
      force: true,
      abortSignal: controller.signal,
    });

    expect(result).toEqual({ didCompact: false, reason: 'aborted' });
  });

  it('discards a summary that resolves after the stop', async () => {
    const controller = new AbortController();
    summarizeMessagesMock.mockImplementation(async () => {
      controller.abort();
      return 'short';
    });

    const result = await maybeCompactContext(longContext(), {
      force: true,
      abortSignal: controller.signal,
    });

    expect(result).toEqual({ didCompact: false, reason: 'aborted' });
  });

  it('skips summarization when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await maybeCompactContext(longContext(), {
      force: true,
      abortSignal: controller.signal,
    });

    expect(result.didCompact).toBe(false);
    expect(summarizeMessagesMock).not.toHaveBeenCalled();
  });
});

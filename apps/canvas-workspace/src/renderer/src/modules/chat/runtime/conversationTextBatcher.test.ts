// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationTextBatcher } from './conversationTextBatcher';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createConversationTextBatcher', () => {
  it('flushes a short reply once it reaches the size cap', () => {
    const flush = vi.fn();
    const batcher = createConversationTextBatcher(flush);

    batcher.push('a'.repeat(300));
    batcher.push('b'.repeat(300));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(`${'a'.repeat(300)}${'b'.repeat(300)}`);
  });

  it('flushes a short reply after the minimum wait', () => {
    const flush = vi.fn();
    const batcher = createConversationTextBatcher(flush);

    batcher.push('hello');
    vi.advanceTimersByTime(31);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledWith('hello');
  });

  it('widens the window as the reply grows, up to the maximum', () => {
    const flush = vi.fn();
    const batcher = createConversationTextBatcher(flush);
    batcher.push('x'.repeat(20_000));
    batcher.flush();
    flush.mockClear();

    batcher.push('y'.repeat(600));
    vi.advanceTimersByTime(199);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledWith('y'.repeat(600));
  });

  it('flushes buffered text immediately on demand', () => {
    const flush = vi.fn();
    const batcher = createConversationTextBatcher(flush);

    batcher.push('tail');
    batcher.flush();

    expect(flush).toHaveBeenCalledWith('tail');
    vi.advanceTimersByTime(500);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMessageDeltaBatcher } from './createMessageDeltaBatcher';

describe('createMessageDeltaBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports the first committed text batch once', () => {
    const onFirstCommit = vi.fn();
    let messages = [{ role: 'assistant' as const, content: '', timestamp: 1 }];
    const batcher = createMessageDeltaBatcher({
      segment: { msgIndex: 0, tools: [], finalized: 0 },
      isCurrent: () => true,
      setMessages: (update: any) => { messages = update(messages); },
      onFirstCommit,
    });

    batcher.push('hello');
    vi.runOnlyPendingTimers();
    batcher.push(' world');
    vi.runOnlyPendingTimers();

    expect(messages[0].content).toBe('hello world');
    expect(onFirstCommit).toHaveBeenCalledOnce();
  });
});

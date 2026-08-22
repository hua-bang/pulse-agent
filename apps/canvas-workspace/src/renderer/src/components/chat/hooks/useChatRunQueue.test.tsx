// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatRunQueue } from './useChatRunQueue';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: ReturnType<typeof useChatRunQueue> | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  vi.useRealTimers();
});

async function mount(options: {
  loading: boolean;
  sendMessage: (
    text: string,
    context?: { scope?: string },
  ) => Promise<'accepted' | 'blocked' | 'failed'>;
  scopeKey?: string;
  abort?: () => Promise<boolean>;
}) {
  const Probe = () => {
    latest = useChatRunQueue({
      scopeKey: options.scopeKey ?? 'persistent-scope',
      loading: options.loading,
      busyElsewhere: false,
      abort: options.abort ?? vi.fn(async () => true),
      getConversationSessionId: () => 'conversation-1',
      sendMessage: options.sendMessage as never,
    });
    return null;
  };
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root?.render(<Probe />));
}

describe('useChatRunQueue', () => {
  it('survives owner remount and retries until ordinary send accepts it', async () => {
    vi.useFakeTimers();
    await mount({ loading: true, sendMessage: vi.fn(async () => 'accepted') });
    await act(async () => {
      await latest?.submitRunInput('follow-up', 'next', { scope: 'selected_nodes' });
    });
    act(() => root?.unmount());
    root = null;
    host?.remove();

    const sendMessage = vi.fn()
      .mockResolvedValueOnce('blocked')
      .mockResolvedValueOnce('accepted');
    await mount({ loading: false, sendMessage });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('next', expect.objectContaining({
      scope: 'selected_nodes',
      expectedConversationSessionId: 'conversation-1',
    }));

    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('rejects steer without clearing the draft when Stop cannot be delivered', async () => {
    const sendMessage = vi.fn(async () => 'accepted' as const);
    await mount({
      scopeKey: 'abort-failure-scope',
      loading: true,
      sendMessage,
      abort: vi.fn(async () => false),
    });

    await expect(latest?.submitRunInput('steer', 'keep this draft')).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('consumes a terminally failed send instead of retrying it forever', async () => {
    vi.useFakeTimers();
    const scopeKey = 'terminal-failure-scope';
    await mount({ scopeKey, loading: true, sendMessage: vi.fn(async () => 'accepted') });
    await act(async () => { await latest?.submitRunInput('follow-up', 'fails once'); });
    act(() => root?.unmount());
    root = null;
    host?.remove();

    const sendMessage = vi.fn(async () => 'failed' as const);
    await mount({ scopeKey, loading: false, sendMessage });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('exposes queued rows that can be steered or removed', async () => {
    const abort = vi.fn(async () => true);
    await mount({
      scopeKey: 'queue-actions-scope',
      loading: true,
      sendMessage: vi.fn(async () => 'accepted'),
      abort,
    });
    await act(async () => {
      await latest?.submitRunInput('follow-up', 'first');
      await latest?.submitRunInput('follow-up', 'second');
    });
    const firstId = latest?.queuedInputs[0]?.id;
    const secondId = latest?.queuedInputs[1]?.id;
    expect(firstId).toBeTypeOf('number');
    expect(secondId).toBeTypeOf('number');

    await act(async () => { await latest?.steerQueuedInput(secondId!); });
    expect(abort).toHaveBeenCalledOnce();
    expect(latest?.queuedInputs.map(input => input.text)).toEqual(['second', 'first']);

    act(() => latest?.removeQueuedInput(firstId!));
    expect(latest?.queuedInputs.map(input => input.text)).toEqual(['second']);
  });
});

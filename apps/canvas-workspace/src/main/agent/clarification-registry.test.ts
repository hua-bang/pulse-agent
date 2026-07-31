import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClarificationRegistry } from './clarification-registry';

afterEach(() => {
  vi.useRealTimers();
});

describe('ClarificationRegistry', () => {
  it('uses the default answer on timeout and removes the pending resolver', async () => {
    vi.useFakeTimers();
    const registry = new ClarificationRegistry();
    const notify = vi.fn();
    const answer = registry.wait({
      id: 'approval-1',
      question: 'Allow write?',
      defaultAnswer: 'No',
      timeout: 300_000,
    }, notify);

    await vi.advanceTimersByTimeAsync(300_000);

    await expect(answer).resolves.toBe('No');
    expect(notify).toHaveBeenCalledOnce();
    expect(registry.answer('approval-1', 'Yes')).toBe(false);
  });

  it('clears the timeout after a user answer', async () => {
    vi.useFakeTimers();
    const registry = new ClarificationRegistry();
    const answer = registry.wait({
      id: 'approval-2',
      question: 'Allow write?',
      defaultAnswer: 'No',
      timeout: 100,
    }, () => undefined);

    expect(registry.answer('approval-2', 'Yes')).toBe(true);
    await vi.runAllTimersAsync();

    await expect(answer).resolves.toBe('Yes');
    expect(registry.answer('approval-2', 'No')).toBe(false);
  });

  it('exposes the full pending request for a reconnecting renderer', async () => {
    const registry = new ClarificationRegistry();
    const answer = registry.wait({
      id: 'approval-reconnect',
      kind: 'approval',
      question: 'Allow write?',
      context: 'write /tmp/result',
      defaultAnswer: 'No',
      timeout: 300_000,
    }, () => undefined);

    expect(registry.latest()).toEqual({
      id: 'approval-reconnect',
      kind: 'approval',
      question: 'Allow write?',
      context: 'write /tmp/result',
      defaultAnswer: 'No',
      timeout: 300_000,
    });
    registry.answer('approval-reconnect', 'No');
    await answer;
    expect(registry.latest()).toBeNull();
  });

  it('fails closed and cleans up when the run is aborted', async () => {
    const registry = new ClarificationRegistry();
    const controller = new AbortController();
    const answer = registry.wait({
      id: 'approval-3',
      question: 'Allow external role?',
      defaultAnswer: 'No',
      timeout: 300_000,
    }, () => undefined, controller.signal);

    controller.abort();

    await expect(answer).resolves.toBe('No');
    expect(registry.answer('approval-3', 'Yes')).toBe(false);
  });

  it('serializes concurrent approvals and reveals the next one after answering', async () => {
    const registry = new ClarificationRegistry();
    const notified: string[] = [];
    const first = registry.wait({
      id: 'approval-first',
      question: 'Allow first write?',
      defaultAnswer: 'No',
      timeout: 300_000,
    }, request => notified.push(request.id));
    const second = registry.wait({
      id: 'approval-second',
      question: 'Allow second write?',
      defaultAnswer: 'No',
      timeout: 300_000,
    }, request => notified.push(request.id));

    expect(notified).toEqual(['approval-first']);
    expect(registry.latest()?.id).toBe('approval-first');
    expect(registry.answer('approval-first', 'Yes')).toBe(true);
    await expect(first).resolves.toBe('Yes');
    expect(notified).toEqual(['approval-first', 'approval-second']);
    expect(registry.latest()?.id).toBe('approval-second');

    expect(registry.answer('approval-second', 'No')).toBe(true);
    await expect(second).resolves.toBe('No');
    expect(registry.latest()).toBeNull();
  });

  it('does not start queued approval timeouts until the request is visible', async () => {
    vi.useFakeTimers();
    const registry = new ClarificationRegistry();
    const first = registry.wait({
      id: 'approval-blocking',
      question: 'First?',
      defaultAnswer: 'No',
      timeout: 100,
    }, () => undefined);
    const second = registry.wait({
      id: 'approval-queued',
      question: 'Second?',
      defaultAnswer: 'No',
      timeout: 100,
    }, () => undefined);

    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBe('No');
    expect(registry.latest()?.id).toBe('approval-queued');
    expect(registry.answer('approval-queued', 'Yes')).toBe(true);
    await expect(second).resolves.toBe('Yes');
  });
});

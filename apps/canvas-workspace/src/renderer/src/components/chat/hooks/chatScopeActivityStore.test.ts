import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  claimChatScope,
  isChatScopeBusyElsewhere,
  releaseChatScope,
  resetChatScopeActivityForTests,
  subscribeChatScope,
  trackChatScopeRun,
} from './chatScopeActivityStore';

describe('chat scope activity store', () => {
  afterEach(() => {
    resetChatScopeActivityForTests();
    vi.useRealTimers();
  });

  it('allows one owner per scope and notifies other surfaces', () => {
    resetChatScopeActivityForTests();
    const dock = Symbol('dock');
    const page = Symbol('page');
    const listener = vi.fn();
    const unsubscribe = subscribeChatScope('workspace:one', listener);

    expect(claimChatScope('workspace:one', dock)).toBe(true);
    expect(claimChatScope('workspace:one', page)).toBe(false);
    expect(isChatScopeBusyElsewhere('workspace:one', page)).toBe(true);
    expect(isChatScopeBusyElsewhere('workspace:one', dock)).toBe(false);

    releaseChatScope('workspace:one', dock);
    expect(isChatScopeBusyElsewhere('workspace:one', page)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('keeps ownership after a surface unmount until main settles the run', async () => {
    vi.useFakeTimers();
    const dock = Symbol('dock');
    const page = Symbol('page');
    let active = true;
    expect(claimChatScope('workspace:one', dock)).toBe(true);

    trackChatScopeRun(
      'workspace:one',
      dock,
      async () => ({ ok: true, active }),
    );
    await Promise.resolve();
    expect(isChatScopeBusyElsewhere('workspace:one', page)).toBe(true);

    active = false;
    await vi.advanceTimersByTimeAsync(400);
    expect(isChatScopeBusyElsewhere('workspace:one', page)).toBe(false);
  });

  it('tracks concurrent runs for different scopes owned by one surface', async () => {
    vi.useFakeTimers();
    const page = Symbol('page');
    const observer = Symbol('observer');
    let firstActive = true;
    let secondActive = true;
    claimChatScope('workspace:one', page);
    trackChatScopeRun(
      'workspace:one',
      page,
      async () => ({ ok: true, active: firstActive }),
    );
    claimChatScope('workspace:two', page);
    trackChatScopeRun(
      'workspace:two',
      page,
      async () => ({ ok: true, active: secondActive }),
    );
    await Promise.resolve();

    firstActive = false;
    await vi.advanceTimersByTimeAsync(400);
    expect(isChatScopeBusyElsewhere('workspace:one', observer)).toBe(false);
    expect(isChatScopeBusyElsewhere('workspace:two', observer)).toBe(true);

    secondActive = false;
    await vi.advanceTimersByTimeAsync(400);
    expect(isChatScopeBusyElsewhere('workspace:two', observer)).toBe(false);
  });
});

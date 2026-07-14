import { afterEach, describe, it, expect, vi } from 'vitest';
import { ensureOperable } from '../ensure-operable';

/** A virtual clock so the poll loop runs without real timers. */
function virtualClock() {
  let t = 0;
  return {
    now: () => t,
    delay: async (ms: number) => {
      t += ms;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CANVAS_WEBVIEW_AUTO_ACTIVATE;
});

describe('ensureOperable', () => {
  it('read mode: activates an already-registered node to hold a renderer protection lease', async () => {
    const activate = vi.fn(async () => ({ ok: true }));
    const clock = virtualClock();
    const wc = await ensureOperable({
      lookup: () => 'WC' as string,
      activate,
      mode: 'read',
      ...clock,
    });
    expect(wc).toBe('WC');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBeGreaterThan(0);
  });

  it('read mode: activates when nothing is registered, then resolves once it appears', async () => {
    let registered: string | null = null;
    const activate = vi.fn(async () => {
      registered = 'WC';
      return { ok: true };
    });
    const wc = await ensureOperable({
      lookup: () => registered,
      activate,
      mode: 'read',
      ...virtualClock(),
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(wc).toBe('WC');
  });

  it('operate mode: always activates (to get a paint surface) even when registered', async () => {
    const activate = vi.fn(async () => ({ ok: true }));
    const clock = virtualClock();
    const wc = await ensureOperable({
      lookup: () => 'WC' as string,
      activate,
      mode: 'operate',
      ...clock,
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(wc).toBe('WC');
    // Settled for a paint frame after activation.
    expect(clock.now()).toBeGreaterThan(0);
  });

  it('operate mode: waits for the node to register after activation', async () => {
    const activate = vi.fn(async () => ({ ok: true }));
    // The renderer mounts + registers the webview a few poll intervals after
    // activation, so the first lookups return null then it appears.
    let registered: string | null = null;
    let polls = 0;
    const wc = await ensureOperable({
      lookup: () => {
        polls += 1;
        if (polls >= 3) registered = 'WC';
        return registered;
      },
      activate,
      mode: 'operate',
      ...virtualClock(),
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(wc).toBe('WC');
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it('returns the latest guest generation after activation settle', async () => {
    let registered = 'old';
    const clock = virtualClock();
    const wc = await ensureOperable({
      lookup: () => registered,
      activate: async () => ({ ok: true }),
      mode: 'operate',
      now: clock.now,
      delay: async (ms) => {
        await clock.delay(ms);
        registered = 'new';
      },
    });

    expect(wc).toBe('new');
  });

  it('returns null when the node never registers within the budget', async () => {
    const activate = vi.fn(async () => ({ ok: true }));
    const wc = await ensureOperable({
      lookup: () => null,
      activate,
      mode: 'operate',
      waitMs: 1_000,
      pollIntervalMs: 100,
      ...virtualClock(),
    });
    expect(wc).toBeNull();
  });

  it('still returns a usable node when activation throws', async () => {
    const activate = vi.fn(async () => {
      throw new Error('window unavailable');
    });
    const wc = await ensureOperable({
      lookup: () => 'WC' as string,
      activate,
      mode: 'operate',
      ...virtualClock(),
    });
    expect(wc).toBe('WC');
  });

  it('bounds an activation promise that never settles', async () => {
    vi.useFakeTimers();
    const result = ensureOperable({
      lookup: () => null,
      activate: () => new Promise<never>(() => undefined),
      mode: 'read',
      waitMs: 25,
      pollIntervalMs: 5,
    });

    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toBeNull();
  });

  it('opt-out env disables auto-activation entirely', async () => {
    process.env.CANVAS_WEBVIEW_AUTO_ACTIVATE = '0';
    const activate = vi.fn(async () => ({ ok: true }));
    const wc = await ensureOperable({
      lookup: () => null,
      activate,
      mode: 'operate',
      ...virtualClock(),
    });
    expect(activate).not.toHaveBeenCalled();
    expect(wc).toBeNull();
  });
});

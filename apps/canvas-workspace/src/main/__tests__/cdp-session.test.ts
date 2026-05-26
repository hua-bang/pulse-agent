import { describe, it, expect } from 'vitest';
import { withCdp, type CdpHost } from '../cdp-session';

function makeHost(opts: {
  alreadyAttached?: boolean;
  send?: (method: string, params?: unknown) => Promise<unknown>;
  attachThrows?: Error;
} = {}): CdpHost & {
  attachCalls: number;
  detachCalls: number;
  sendCalls: Array<{ method: string; params?: unknown }>;
} {
  let attached = !!opts.alreadyAttached;
  const attachCalls = { n: 0 };
  const detachCalls = { n: 0 };
  const sendCalls: Array<{ method: string; params?: unknown }> = [];
  const host = {
    debugger: {
      isAttached: () => attached,
      attach: (_v?: string) => {
        attachCalls.n += 1;
        if (opts.attachThrows) throw opts.attachThrows;
        attached = true;
      },
      detach: () => {
        detachCalls.n += 1;
        attached = false;
      },
      async sendCommand(method: string, params?: Record<string, unknown>) {
        sendCalls.push({ method, params });
        return opts.send ? opts.send(method, params) : { method };
      },
    },
    get attachCalls() {
      return attachCalls.n;
    },
    get detachCalls() {
      return detachCalls.n;
    },
    get sendCalls() {
      return sendCalls;
    },
  };
  return host as CdpHost & {
    attachCalls: number;
    detachCalls: number;
    sendCalls: Array<{ method: string; params?: unknown }>;
  };
}

describe('withCdp', () => {
  it('attaches before running, detaches after', async () => {
    const host = makeHost();
    const result = await withCdp(host, async (send) => {
      expect(host.attachCalls).toBe(1);
      expect(host.detachCalls).toBe(0);
      return await send('Test.command');
    });
    expect(result).toEqual({ method: 'Test.command' });
    expect(host.attachCalls).toBe(1);
    expect(host.detachCalls).toBe(1);
  });

  it('does not attach if something else already attached the debugger', async () => {
    const host = makeHost({ alreadyAttached: true });
    await withCdp(host, async () => {});
    expect(host.attachCalls).toBe(0);
    expect(host.detachCalls).toBe(0); // we shouldn't detach what we didn't attach
  });

  it('detaches even when the body throws', async () => {
    const host = makeHost();
    await expect(
      withCdp(host, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(host.detachCalls).toBe(1);
  });

  it('serialises overlapping callers on the same host', async () => {
    const order: string[] = [];
    let resolveA!: () => void;
    const aBody = new Promise<void>((r) => {
      resolveA = r;
    });
    const host = makeHost();
    const a = withCdp(host, async () => {
      order.push('A:start');
      await aBody;
      order.push('A:end');
    });
    const b = withCdp(host, async () => {
      order.push('B:start');
      order.push('B:end');
    });
    // B must not start until A resolves.
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['A:start']);
    resolveA();
    await Promise.all([a, b]);
    expect(order).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
    // Two separate attach/detach cycles — one per body.
    expect(host.attachCalls).toBe(2);
    expect(host.detachCalls).toBe(2);
  });

  it('advances the queue even after a predecessor rejects', async () => {
    const host = makeHost();
    const a = withCdp(host, async () => {
      throw new Error('A failed');
    });
    const b = withCdp(host, async () => 'B ok');
    await expect(a).rejects.toThrow('A failed');
    await expect(b).resolves.toBe('B ok');
  });

  it('isolates locks per host', async () => {
    const order: string[] = [];
    let resolveA!: () => void;
    const aBody = new Promise<void>((r) => {
      resolveA = r;
    });
    const hostA = makeHost();
    const hostB = makeHost();
    const a = withCdp(hostA, async () => {
      order.push('A:start');
      await aBody;
      order.push('A:end');
    });
    const b = withCdp(hostB, async () => {
      order.push('B');
    });
    // B should run independently on hostB without waiting for A.
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toContain('B');
    expect(order).not.toContain('A:end');
    resolveA();
    await Promise.all([a, b]);
  });
});
